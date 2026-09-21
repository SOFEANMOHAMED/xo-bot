#!/usr/bin/env bash
# Shared helpers for deploy.sh / rollback.sh (sourced, not executed alone).
# WHY one file: identical health retry logic must not drift between scripts.

# shellcheck disable=SC2034
: "${DEFAULT_PORT:=3001}"
: "${HEALTH_PATH:=/api/health}"
: "${HEALTH_RETRY_SECONDS:=5}"
: "${HEALTH_WAIT_SECONDS:=90}"
: "${PM2_APP:=xobot-backend}"

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
