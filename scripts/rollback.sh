#!/usr/bin/env bash
# Restore the newest backend/dist.bak-* (copy, keep backup) and restart pm2.
# Review before running. Not executed by the STEP D re-review commit itself.

set -euo pipefail

KEEP_FAILED_BUILDS=2
PM2_APP=xobot-backend
PG_CONTAINER="${PG_CONTAINER:-xobot-postgres}"
PRODUCTION_DB_NAME=xobot_db
TEST_DB_NAME=xobot_test
DEPLOY_LOCK_FILE=/tmp/xobot-deploy.lock

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${ROOT}/backend"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Dynamic path — shellcheck cannot resolve dirname "$0".
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/deploy-lib.sh"

acquire_deploy_lock "$DEPLOY_LOCK_FILE"

newest_backup() {
  local newest=""
  local p
  for p in "$BACKEND"/dist.bak-*; do
    [[ -e "$p" ]] || continue
    newest="$p"
  done
  if [[ -z "$newest" ]]; then
    echo "FAIL: no backend/dist.bak-* to restore"
    exit 1
  fi
  printf '%s\n' "$BACKEND"/dist.bak-* | sort | tail -n 1
}

prune_failed_builds() {
  local -a failed=()
  local p
  for p in "$BACKEND"/dist.failed-*; do
    [[ -e "$p" ]] || continue
    failed+=("$p")
  done
  if (( ${#failed[@]} <= KEEP_FAILED_BUILDS )); then
    return 0
  fi
  local drop=$(( ${#failed[@]} - KEEP_FAILED_BUILDS ))
  local sorted
  sorted="$(printf '%s\n' "${failed[@]}" | sort)"
  local i=0
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    if (( i < drop )); then
      rm -rf "$p"
    fi
    i=$((i + 1))
  done <<< "$sorted"
}

restore_newest_dist() {
  local bak
  bak="$(newest_backup)"
  echo "==> restoring from ${bak} (copy — backup kept)"
  cd "$BACKEND"
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  if [[ -d dist ]]; then
    mv dist "dist.failed-${stamp}"
    prune_failed_builds
  fi
  cp -a "$bak" dist
  if [[ -f dist/.deploy-commit ]]; then
    mv dist/.deploy-commit dist.commit
  else
    # WHY remove: leaving an old dist.commit would claim a wrong hash.
    rm -f dist.commit
  fi
}

restart_pm2() {
  unset NODE_ENV
  pm2 restart "$PM2_APP" --update-env
  pm2 status
}

restore_newest_dist
restart_pm2
if ! wait_for_health "$BACKEND" "ROLLBACK health check failed"; then
  exit 1
fi
if ! assert_live_db_connections "$PG_CONTAINER" "$PRODUCTION_DB_NAME" "$TEST_DB_NAME"; then
  exit 1
fi
print_live_commit "$BACKEND"
echo "ROLLBACK OK"
