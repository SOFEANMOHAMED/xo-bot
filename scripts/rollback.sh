#!/usr/bin/env bash
# Restore the newest backend/dist.bak-* and restart pm2.
# Review before running. This script is not executed by the STEP D commit itself.

set -euo pipefail

PM2_APP=xobot-backend
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${ROOT}/backend"

newest_backup() {
  local p newest=""
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

restore_newest_dist() {
  local bak
  bak="$(newest_backup)"
  echo "==> restoring ${bak}"
  cd "$BACKEND"
  rm -rf dist
  mv "$bak" dist
  if [[ -f dist/.deploy-commit ]]; then
    mv dist/.deploy-commit dist.commit
  fi
}

restart_pm2() {
  unset NODE_ENV
  pm2 restart "$PM2_APP" --update-env
  pm2 status
}

restore_newest_dist
restart_pm2
echo "ROLLBACK OK"
