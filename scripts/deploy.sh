#!/usr/bin/env bash
# Atomic backend deploy: test gate → dist.new → swap live dist → pm2 → health.
# Review before running. This script is not executed by the STEP D commit itself.
#
# WHY subshell NODE_ENV=test: a leaked NODE_ENV=test would make the live bot
# load .env.test / xobot_test. Live restart always `unset NODE_ENV` first.

set -euo pipefail

DEFAULT_PORT=3001
HEALTH_PATH=/api/health
HEALTH_RETRY_SECONDS=5
HEALTH_WAIT_SECONDS=90
KEEP_DIST_BACKUPS=3
PM2_APP=xobot-backend
PG_CONTAINER="${PG_CONTAINER:-xobot-postgres}"
PRODUCTION_DB_NAME=xobot_db
TEST_DB_SUFFIX=_test

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${ROOT}/backend"
ENV_TEST="${BACKEND}/.env.test"
ROLLBACK_SH="${ROOT}/scripts/rollback.sh"

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

refuse_dirty_git() {
  cd "$ROOT"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "FAIL: dirty git tree — commit or stash before deploy"
    exit 1
  fi
}

refuse_unreachable_test_db() {
  if [[ ! -r "$ENV_TEST" ]]; then
    echo "FAIL: backend/.env.test missing or unreadable"
    exit 1
  fi
  local db_name db_user db_password
  db_name="$(dotenv_get "$ENV_TEST" DB_NAME || true)"
  db_user="$(dotenv_get "$ENV_TEST" DB_USER || true)"
  db_password="$(dotenv_get "$ENV_TEST" DB_PASSWORD || true)"
  if [[ -z "$db_name" || "$db_name" == "$PRODUCTION_DB_NAME" || "$db_name" != *"$TEST_DB_SUFFIX" ]]; then
    echo "FAIL: backend/.env.test DB_NAME is not a _test database"
    exit 1
  fi
  if [[ -z "$db_user" ]]; then
    echo "FAIL: backend/.env.test DB_USER missing"
    exit 1
  fi
  if ! docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -qx true; then
    echo "FAIL: ${PG_CONTAINER} is not running — xobot_test unreachable"
    exit 1
  fi
  if ! docker exec -e PGPASSWORD="$db_password" "$PG_CONTAINER" \
    psql -U "$db_user" -d "$db_name" -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null; then
    echo "FAIL: xobot_test database is unreachable"
    exit 1
  fi
}

run_test_gate() {
  if ! (
    export NODE_ENV=test
    cd "$BACKEND"
    npm run typecheck
    npm run test-all
  ); then
    echo "TEST GATE FAILED — live dist untouched, no rollback needed"
    exit 1
  fi
}

build_dist_new() {
  cd "$BACKEND"
  if ! npx tsc --outDir dist.new; then
    echo "BUILD FAILED — live dist untouched"
    rm -rf dist.new
    exit 1
  fi
  if [[ ! -f dist.new/index.js ]]; then
    echo "BUILD FAILED — live dist untouched (dist.new/index.js missing)"
    rm -rf dist.new
    exit 1
  fi
}

prune_dist_backups() {
  local -a baks=()
  local p
  for p in "$BACKEND"/dist.bak-*; do
    [[ -e "$p" ]] || continue
    baks+=("$p")
  done
  if (( ${#baks[@]} <= KEEP_DIST_BACKUPS )); then
    return 0
  fi
  local drop=$(( ${#baks[@]} - KEEP_DIST_BACKUPS ))
  local sorted
  sorted="$(printf '%s\n' "${baks[@]}" | sort)"
  local i=0
  while IFS= read -r p; do
    if (( i < drop )); then
      rm -rf "$p"
    fi
    i=$((i + 1))
  done <<< "$sorted"
}

swap_live_dist() {
  cd "$BACKEND"
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ -d dist ]]; then
    mv dist "dist.bak-${stamp}"
    if [[ -f dist.commit ]]; then
      cp dist.commit "dist.bak-${stamp}/.deploy-commit"
    fi
  fi
  prune_dist_backups
  mv dist.new dist
  git -C "$ROOT" rev-parse HEAD > dist.commit
}

restart_pm2() {
  unset NODE_ENV
  pm2 restart "$PM2_APP" --update-env
  pm2 status
  local err_log="${HOME}/.pm2/logs/${PM2_APP}-error.log"
  if [[ -f "$err_log" ]]; then
    echo "==> last 100 lines of ${err_log} (error/warn)"
    tail -n 100 "$err_log" | grep -E 'error|Error|ERROR|FATAL|WARN' || true
  fi
  pm2 logs "$PM2_APP" --err --lines 100 --nostream || true
}

resolve_health_port() {
  local port="${PORT:-}"
  if [[ -z "$port" && -f "${BACKEND}/.env" ]]; then
    port="$(dotenv_get "${BACKEND}/.env" PORT || true)"
  fi
  printf '%s' "${port:-$DEFAULT_PORT}"
}

wait_for_health() {
  local port
  port="$(resolve_health_port)"
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
  echo "Rollback: ${ROLLBACK_SH}"
  exit 1
}

refuse_dirty_git
refuse_unreachable_test_db
run_test_gate
build_dist_new
swap_live_dist
restart_pm2
wait_for_health
echo "DEPLOY OK $(git -C "$ROOT" rev-parse HEAD)"
