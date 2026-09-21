#!/usr/bin/env bash
# Prove a child started with 9>&- does not keep the deploy flock.
# Not part of production deploy.

set -euo pipefail

LOCK="$(mktemp /tmp/xobot-lock-proof.XXXXXX)"
cleanup() {
  rm -f "$LOCK"
}
trap cleanup EXIT

# --- Case A: child inherits FD 9 → lock stays held after parent closes ---
exec 9>"$LOCK"
flock -n 9
bash -c 'sleep 3' &
inherit_pid=$!
exec 9>&-
sleep 0.15
exec 8>"$LOCK"
if flock -n 8; then
  echo "FAIL: expected inheriting child to keep the lock"
  kill "$inherit_pid" 2>/dev/null || true
  exit 1
fi
exec 8>&-
kill "$inherit_pid" 2>/dev/null || true
wait "$inherit_pid" 2>/dev/null || true
echo "inherit holds lock (expected)"

# --- Case B: child started with 9>&- → lock free after parent closes ---
exec 9>"$LOCK"
flock -n 9
bash -c 'sleep 3' 9>&- &
closed_pid=$!
exec 9>&-
sleep 0.15
exec 8>"$LOCK"
if ! flock -n 8; then
  echo "FAIL: child with 9>&- still held the lock"
  kill "$closed_pid" 2>/dev/null || true
  exit 1
fi
exec 8>&-
kill "$closed_pid" 2>/dev/null || true
wait "$closed_pid" 2>/dev/null || true
echo "LOCK_FD_CLOSE_PROOF_OK"
