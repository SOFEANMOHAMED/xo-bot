#!/usr/bin/env bash
# Atomic backend deploy: test gate → dist.new → swap live dist → pm2 → health.
# Review before running. Not executed by the STEP D re-review commit itself.
#
# DRY_RUN=1 — run through pre-swap dump, then exit before any mv/pm2.
# WHY subshell NODE_ENV=test: a leaked NODE_ENV=test would make the live bot
# load .env.test / xobot_test. Live restart always `unset NODE_ENV` first.

set -euo pipefail

KEEP_DIST_BACKUPS=3
PM2_APP=xobot-backend
PG_CONTAINER="${PG_CONTAINER:-xobot-postgres}"
PRODUCTION_DB_NAME=xobot_db
TEST_DB_NAME=xobot_test
TEST_DB_SUFFIX=_test
BACKUP_DIR=/root/backups
MIN_DUMP_BYTES=$((100 * 1024))
DEPLOY_LOCK_FILE=/tmp/xobot-deploy.lock
DRY_RUN="${DRY_RUN:-0}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="${ROOT}/backend"
ENV_TEST="${BACKEND}/.env.test"
ROLLBACK_SH="${ROOT}/scripts/rollback.sh"
DIST_KEEP_FILE="${BACKEND}/dist.keep"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Dynamic path — shellcheck cannot resolve dirname "$0".
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/deploy-lib.sh"

acquire_deploy_lock "$DEPLOY_LOCK_FILE"

refuse_dirty_git() {
  cd "$ROOT"
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "FAIL: dirty git tree — commit or stash before deploy"
    exit 1
  fi
}

# WHY postgres superuser + no PGPASSWORD: docker exec -e is visible in `ps`.
refuse_unreachable_test_db() {
  if [[ ! -r "$ENV_TEST" ]]; then
    echo "FAIL: backend/.env.test missing or unreadable"
    exit 1
  fi
  local db_name
  db_name="$(dotenv_get "$ENV_TEST" DB_NAME || true)"
  if [[ -z "$db_name" || "$db_name" == "$PRODUCTION_DB_NAME" || "$db_name" != *"$TEST_DB_SUFFIX" ]]; then
    echo "FAIL: backend/.env.test DB_NAME is not a _test database"
    exit 1
  fi
  if ! docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -qx true; then
    echo "FAIL: ${PG_CONTAINER} is not running — ${TEST_DB_NAME} unreachable"
    exit 1
  fi
  if ! docker exec "$PG_CONTAINER" \
    psql -U postgres -d "$TEST_DB_NAME" -v ON_ERROR_STOP=1 -c 'SELECT 1' >/dev/null; then
    echo "FAIL: ${TEST_DB_NAME} database is unreachable"
    exit 1
  fi
}

# WHY typecheck && test-all && live gate: inside `if`, errexit is ignored — chain so
# typecheck failure cannot be masked by a later green test-all. Live gate catches
# brain regressions that unit stubs miss.
# Cost: test-live --gate adds ~\$0.10 USD per deploy (~220 LLM calls; see docs/BASELINE.md).
run_test_gate() {
  if ! (
    export NODE_ENV=test
    cd "$BACKEND"
    npm run typecheck && npm run test-all
  ); then
    echo "TEST GATE FAILED — live dist untouched, no rollback needed"
    exit 1
  fi
  echo "==> LIVE LLM GATE (LIVE_LLM=1 npm run test-live -- --gate)"
  echo "    Estimated extra cost ≈ \$0.10 USD per deploy (see docs/BASELINE.md LLM budget)"
  if ! (
    export NODE_ENV=test
    export LIVE_LLM=1
    cd "$BACKEND"
    npm run test-live -- --gate
  ); then
    echo "LIVE LLM GATE FAILED — live dist untouched, no rollback needed"
    echo "Fix brain regressions or lower thresholds only with an explicit baseline update."
    exit 1
  fi
}

build_dist_new() {
  cd "$BACKEND"
  rm -rf dist.new
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

# Refuse swap if live dist has non-compiled assets that dist.new does not ship.
# WHY: tsc only emits *.js/*.map/*.d.ts — stray uploads/config in live must not vanish.
refuse_missing_live_extras() {
  cd "$BACKEND"
  if [[ ! -d dist ]]; then
    return 0
  fi
  if [[ ! -d dist.new ]]; then
    echo "FAIL: dist.new missing before swap check"
    exit 1
  fi
  local -a missing=()
  local rel
  while IFS= read -r -d '' rel; do
    case "$rel" in
      *.js|*.map|*.d.ts) continue ;;
    esac
    if [[ ! -e "dist.new/${rel}" ]]; then
      missing+=("$rel")
    fi
  done < <(cd dist && find . -type f -print0)

  if (( ${#missing[@]} > 0 )); then
    echo "FAIL: live dist has non-compiled files absent from dist.new — refuse swap"
    printf '  %s\n' "${missing[@]}"
    exit 1
  fi
}

# Read-only dump of production DB before touching live dist.
dump_production_db() {
  mkdir -p "$BACKUP_DIR"
  local stamp
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  local dump_path="${BACKUP_DIR}/${PRODUCTION_DB_NAME}_${stamp}.dump"
  echo "==> pre-swap dump ${dump_path}"
  if ! docker exec "$PG_CONTAINER" \
    pg_dump -U postgres -Fc "$PRODUCTION_DB_NAME" > "$dump_path"; then
    echo "FAIL: pg_dump ${PRODUCTION_DB_NAME} failed — live dist untouched"
    rm -f "$dump_path"
    exit 1
  fi
  if [[ ! -r "$dump_path" ]]; then
    echo "FAIL: dump unreadable — live dist untouched"
    exit 1
  fi
  local size
  size="$(wc -c < "$dump_path" | tr -d ' ')"
  if (( size < MIN_DUMP_BYTES )); then
    echo "FAIL: dump too small (${size} bytes < ${MIN_DUMP_BYTES}) — live dist untouched"
    exit 1
  fi
  if ! docker exec -i "$PG_CONTAINER" \
    pg_restore --list < "$dump_path" >/dev/null; then
    echo "FAIL: pg_restore --list rejected dump — live dist untouched"
    exit 1
  fi
  echo "==> dump OK (${size} bytes)"
}

# Rotate oldest dist.bak-* except names listed in backend/dist.keep.
prune_dist_backups() {
  local -a candidates=()
  local p
  for p in "$BACKEND"/dist.bak-*; do
    [[ -e "$p" ]] || continue
    if backup_is_kept "$p" "$DIST_KEEP_FILE"; then
      echo "==> keep pinned backup $(basename "$p")"
      continue
    fi
    candidates+=("$p")
  done
  if (( ${#candidates[@]} <= KEEP_DIST_BACKUPS )); then
    return 0
  fi
  local drop=$(( ${#candidates[@]} - KEEP_DIST_BACKUPS ))
  local sorted
  sorted="$(printf '%s\n' "${candidates[@]}" | sort)"
  local i=0
  while IFS= read -r p; do
    [[ -n "$p" ]] || continue
    if (( i < drop )); then
      echo "==> prune backup $(basename "$p")"
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
  # WHY 9>&- via pm2_unlocked: daemon must not inherit /tmp/xobot-deploy.lock.
  pm2_unlocked restart "$PM2_APP" --update-env
  pm2_unlocked status
  local err_log="${HOME}/.pm2/logs/${PM2_APP}-error.log"
  if [[ -f "$err_log" ]]; then
    echo "==> last 100 lines of ${err_log} (error/warn)"
    tail -n 100 "$err_log" | grep -E 'error|Error|ERROR|FATAL|WARN' || true
  fi
  pm2_unlocked logs "$PM2_APP" --err --lines 100 --nostream || true
}

refuse_dirty_git
refuse_unreachable_test_db
run_test_gate
build_dist_new
refuse_missing_live_extras
dump_production_db

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY RUN OK — nothing swapped/restarted"
  exit 0
fi

# WHY set -E + top-level trap: a trap set inside a function does not fire in
# later functions unless errtrace is on. Install here so restart_pm2/health fail
# still print the rollback hint.
set -E
trap 'echo "DEPLOY FAILED after swap started — Rollback: '"${ROLLBACK_SH}"'"' ERR

swap_live_dist
restart_pm2
if ! wait_for_health "$BACKEND" "Rollback: ${ROLLBACK_SH}"; then
  exit 1
fi
if ! assert_live_db_connections "$PG_CONTAINER" "$PRODUCTION_DB_NAME" "$TEST_DB_NAME"; then
  exit 1
fi
print_live_commit "$BACKEND"
echo "DEPLOY OK $(git -C "$ROOT" rev-parse HEAD)"
