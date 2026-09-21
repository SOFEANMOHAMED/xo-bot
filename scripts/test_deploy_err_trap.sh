#!/usr/bin/env bash
# Proves ERR trap + set -E fires in a later function after "swap" (stubs only).
# Not part of production deploy. Expected: prints rollback hint, exits non-zero.

set -euo pipefail

ROLLBACK_SH="/tmp/fake-rollback.sh"
HINT="DEPLOY FAILED after swap started — Rollback: ${ROLLBACK_SH}"

swap_stub() {
  echo "swap_stub ok"
}

# Fails after swap — must trigger the top-level ERR trap via errtrace.
post_swap_fail() {
  echo "post_swap_fail about to fail"
  false
}

# WHY set -E here (mirrors deploy.sh): without it, trap inside a function would
# not fire for failures in subsequent functions.
set -E
trap 'echo "'"$HINT"'"' ERR

swap_stub
post_swap_fail
echo "FAIL: expected post_swap_fail to abort"
exit 1
