#!/usr/bin/env bash
# Shared helpers for deploy.sh / rollback.sh (sourced, not executed alone).
# WHY one file: health retry, lock, and DB assertions must not drift.

# shellcheck disable=SC2034
: "${DEFAULT_PORT:=3001}"
: "${HEALTH_PATH:=/api/health}"
: "${HEALTH_RETRY_SECONDS:=5}"
: "${HEALTH_WAIT_SECONDS:=90}"
: "${PM2_APP:=xobot-backend}"
: "${DEPLOY_LOCK_FILE:=/tmp/xobot-deploy.lock}"
: "${PG_CONTAINER:=xobot-postgres}"
: "${PRODUCTION_DB_NAME:=xobot_db}"
: "${TEST_DB_NAME:=xobot_test}"

# Exclusive lock shared by deploy + rollback (FD 9 held until process exit).
acquire_deploy_lock() {
  local lock_file=${1:-$DEPLOY_LOCK_FILE}
  exec 9>"$lock_file"
  if ! flock -n 9; then
    echo "FAIL: another deploy/rollback holds ${lock_file}"
    exit 1
  fi
  echo "==> lock acquired ${lock_file}"
}

dotenv_get() {
  local file=$1
  local want=$2
  local line key val
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    key="${line%%=*}"
    val="${line#*=}"
    if [[ "$key" == "$want" ]]; then
      if [[ "$val" == \"*\" && "$val" == *\" ]]; then
        val="${val:1:${#val}-2}"
      elif [[ "$val" == \'*\' && "$val" == *\' ]]; then
        val="${val:1:${#val}-2}"
      fi
      printf '%s' "$val"
      return 0
    fi
  done < "$file"
  return 1
}

resolve_health_port() {
  local backend_root=$1
  local port="${PORT:-}"
  if [[ -z "$port" && -f "${backend_root}/.env" ]]; then
    port="$(dotenv_get "${backend_root}/.env" PORT || true)"
  fi
  printf '%s' "${port:-$DEFAULT_PORT}"
}

# Retries GET /api/health until HTTP 200 or deadline. Prints result.
# Args: backend_root [on_fail_message]
wait_for_health() {
  local backend_root=$1
  local on_fail_message=${2:-}
  local port
  port="$(resolve_health_port "$backend_root")"
  local url="http://127.0.0.1:${port}${HEALTH_PATH}"
  local deadline=$((SECONDS + HEALTH_WAIT_SECONDS))
  local code=000
  echo "==> health ${url} every ${HEALTH_RETRY_SECONDS}s for up to ${HEALTH_WAIT_SECONDS}s"
  while (( SECONDS < deadline )); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "$url" || echo 000)"
    if [[ "$code" == "200" ]]; then
      echo "HEALTH OK ${url}"
      return 0
    fi
    sleep "$HEALTH_RETRY_SECONDS"
  done
  echo "HEALTH FAILED ${url} last_http=${code}"
  if [[ -n "$on_fail_message" ]]; then
    echo "$on_fail_message"
  fi
  return 1
}

# After HTTP 200: live must use production DB only — never the test DB.
# Args: [container] [prod_db] [test_db]
assert_live_db_connections() {
  local container=${1:-$PG_CONTAINER}
  local prod_db=${2:-$PRODUCTION_DB_NAME}
  local test_db=${3:-$TEST_DB_NAME}
  local prod_n test_n
  prod_n="$(docker exec "$container" psql -U postgres -d postgres -Atc \
    "SELECT count(*) FROM pg_stat_activity WHERE datname = '${prod_db}'")"
  test_n="$(docker exec "$container" psql -U postgres -d postgres -Atc \
    "SELECT count(*) FROM pg_stat_activity WHERE datname = '${test_db}'")"
  echo "==> pg_stat_activity ${prod_db}=${prod_n} ${test_db}=${test_n}"
  if [[ -z "$prod_n" || "$prod_n" -lt 1 ]]; then
    echo "ROLLBACK NOW — no connections on ${prod_db}"
    return 1
  fi
  if [[ -z "$test_n" || "$test_n" -ne 0 ]]; then
    echo "ROLLBACK NOW — unexpected connections on ${test_db}"
    return 1
  fi
  return 0
}

print_live_commit() {
  local backend_root=$1
  local commit_file="${backend_root}/dist.commit"
  if [[ -f "$commit_file" ]]; then
    echo "LIVE COMMIT $(tr -d '[:space:]' < "$commit_file")"
  else
    echo "LIVE COMMIT unknown"
  fi
}

# Run pm2 without inheriting the deploy lock FD.
# WHY 9>&-: a pm2 daemon spawned while FD 9 holds the flock would keep the
# lock forever after the parent exits.
pm2_unlocked() {
  pm2 "$@" 9>&-
}

# True if basename of bak path is listed in dist.keep (comments/blank ignored).
backup_is_kept() {
  local bak_path=$1
  local keep_file=$2
  local base
  base="$(basename "$bak_path")"
  [[ -f "$keep_file" ]] || return 1
  local line
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ''|\#*) continue ;;
    esac
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] || continue
    if [[ "$line" == "$base" || "$line" == "$bak_path" ]]; then
      return 0
    fi
  done < "$keep_file"
  return 1
}
