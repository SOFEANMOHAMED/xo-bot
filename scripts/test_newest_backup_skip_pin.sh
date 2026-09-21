#!/usr/bin/env bash
# Prove newest_backup skips dist.keep pins and refuses when only pins remain.
# Stubs only — does not touch live backend/dist.bak-*.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/deploy-lib.sh"

TMP="$(mktemp -d /tmp/xobot-newest-bak-XXXXXX)"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

BACKEND="$TMP"
DIST_KEEP_FILE="${TMP}/dist.keep"
mkdir -p "${TMP}/dist.bak-pinned" "${TMP}/dist.bak-20260921T120000Z"
echo "dist.bak-pinned" > "$DIST_KEEP_FILE"

newest_backup() {
  local -a candidates=()
  local p
  local saw_any=0
  local saw_pinned=0
  for p in "$BACKEND"/dist.bak-*; do
    [[ -e "$p" ]] || continue
    saw_any=1
    if backup_is_kept "$p" "$DIST_KEEP_FILE"; then
      saw_pinned=1
      continue
    fi
    candidates+=("$p")
  done
  if (( ${#candidates[@]} > 0 )); then
    printf '%s\n' "${candidates[@]}" | sort | tail -n 1
    return 0
  fi
  if (( saw_pinned )); then
    echo "FAIL: only pinned dist.bak-* listed in dist.keep remain — refuse auto-restore"
    return 1
  fi
  if (( saw_any )); then
    echo "FAIL: no restorable backend/dist.bak-* found"
    return 1
  fi
  echo "FAIL: no backend/dist.bak-* to restore"
  return 1
}

got="$(newest_backup)"
expected="${TMP}/dist.bak-20260921T120000Z"
if [[ "$got" != "$expected" ]]; then
  echo "FAIL: expected ${expected}, got ${got}"
  exit 1
fi
echo "skip pin → chose restorable OK"

rm -rf "${TMP}/dist.bak-20260921T120000Z"
if out="$(newest_backup 2>&1)"; then
  echo "FAIL: expected refuse when only pinned remain"
  exit 1
fi
echo "$out" | grep -q 'only pinned' || {
  echo "FAIL: missing refuse message: $out"
  exit 1
}
echo "NEWEST_BACKUP_SKIP_PIN_PROOF_OK"
