#!/usr/bin/env bash
# Review before running. Isolated test DB via Docker Postgres.
# Does NOT ALTER/REVOKE/GRANT anything on xobot_db or PUBLIC.
# Schema-only copy (zero rows). The code guard is the protection against xobot_db.
#
# Postgres: container xobot-postgres, superuser postgres (no host psql/pg_dump).
#
# Usage (from repo root):
#   TEST_PASSWORD='...' ./scripts/setup-test-db.sh
# If TEST_PASSWORD is unset, a password is generated and written only to
# backend/.env.test (gitignored, chmod 600). It is never printed.
#
# WHY stdin \set + \gexec: psql -c / -v sends SQL to the server, which does not
# interpolate :'var'. A piped client script can \set then format(%L)/gexec so
# the password never appears in argv or `ps`.

set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-xobot-postgres}"
PROD_DB="${PROD_DB:-xobot_db}"
TEST_DB="${TEST_DB:-xobot_test}"
TEST_USER="${TEST_USER:-xobot_test}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT}/backend/.env.test}"

ident_ok='^[a-z][a-z0-9_]*$'
if [[ ! "$PROD_DB" =~ $ident_ok || ! "$TEST_DB" =~ $ident_ok || ! "$TEST_USER" =~ $ident_ok ]]; then
  echo "FAIL: PROD_DB, TEST_DB, and TEST_USER must match ${ident_ok}"
  exit 1
fi
if [[ "$TEST_DB" == "$PROD_DB" ]]; then
  echo "FAIL: TEST_DB must not equal PROD_DB (${PROD_DB})"
  exit 1
fi
if [[ ! "$TEST_DB" =~ _test$ ]]; then
  echo "FAIL: TEST_DB must end with _test"
  exit 1
fi

if ! docker inspect -f '{{.State.Running}}' "$PG_CONTAINER" 2>/dev/null | grep -qx true; then
  echo "FAIL: Docker container ${PG_CONTAINER} is not running"
  exit 1
fi

psql_super() {
  docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 "$@"
}

# Escape a value for psql \set '...' (double single-quotes).
psql_single_quote() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\'/\'\'}
  printf '%s' "$s"
}

if [[ -z "${TEST_PASSWORD:-}" ]]; then
  # hex: no quotes/spaces, still a secret — never printed.
  TEST_PASSWORD="$(openssl rand -hex 32)"
fi

echo "==> Ensure role ${TEST_USER} (login, no superuser, no createdb)"
{
  printf "\\set test_password '%s'\n" "$(psql_single_quote "$TEST_PASSWORD")"
  printf "\\set test_user '%s'\n" "$(psql_single_quote "$TEST_USER")"
  cat <<'PSQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'test_user', :'test_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'test_user')
\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :'test_user', :'test_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'test_user')
\gexec
PSQL
} | psql_super -d postgres >/dev/null

echo "==> Recreate ${TEST_DB} and restore schema-only dump of ${PROD_DB} (no rows)"
psql_super -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}' AND pid <> pg_backend_pid();" >/dev/null
docker exec "$PG_CONTAINER" dropdb -U postgres --if-exists "$TEST_DB"
docker exec "$PG_CONTAINER" createdb -U postgres "$TEST_DB"
docker exec "$PG_CONTAINER" pg_dump -U postgres --schema-only --no-owner --no-acl -d "$PROD_DB" \
  | docker exec -i "$PG_CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -d "$TEST_DB" >/dev/null

echo "==> Grant the test role on ${TEST_DB} only (not ${PROD_DB}, not PUBLIC on production)"
psql_super -d postgres -c "GRANT CONNECT ON DATABASE ${TEST_DB} TO ${TEST_USER};"
psql_super -d "$TEST_DB" <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO ${TEST_USER};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${TEST_USER};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${TEST_USER};
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ${TEST_USER};
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO ${TEST_USER};
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO ${TEST_USER};
SQL

echo "==> Write ${ENV_FILE} (chmod 600, password not printed)"
tmp_env="$(mktemp "${ENV_FILE}.XXXXXX")"
{
  printf 'NODE_ENV=test\n'
  printf 'DB_HOST=127.0.0.1\n'
  printf 'DB_PORT=5432\n'
  printf 'DB_NAME=%s\n' "$TEST_DB"
  printf 'DB_USER=%s\n' "$TEST_USER"
  printf 'DB_PASSWORD=%s\n' "$TEST_PASSWORD"
} >"$tmp_env"
chmod 600 "$tmp_env"
mv "$tmp_env" "$ENV_FILE"

table_count="$(
  psql_super -d "$TEST_DB" -tAc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'"
)"
table_count="${table_count//[[:space:]]/}"
if [[ -z "$table_count" || "$table_count" == "0" ]]; then
  echo "FAIL: ${TEST_DB} public schema has no tables after schema-only restore"
  exit 1
fi

echo "==> PASS/FAIL: test role must not SELECT ${PROD_DB} tables"
# Privilege probe as the role (no PGPASSWORD / no password on argv).
set +e
psql_super -d "$PROD_DB" -c "SET SESSION AUTHORIZATION ${TEST_USER}; SELECT 1 FROM merchants LIMIT 1;" >/dev/null 2>&1
select_status=$?
set -e

if [[ "$select_status" -eq 0 ]]; then
  echo "FAIL: role ${TEST_USER} can SELECT ${PROD_DB}.merchants"
  echo "This script will not REVOKE/GRANT/ALTER ${PROD_DB} or PUBLIC; the code guard remains the protection."
  exit 1
fi

echo "PASS: ${TEST_DB} has ${table_count} public tables; role ${TEST_USER} cannot SELECT ${PROD_DB} tables"
echo "Wrote ${ENV_FILE} (chmod 600). Password was not printed."
