#!/usr/bin/env bash
# Runs the migrations and the workflow tests against a throwaway local Postgres database.
set -euo pipefail
cd "$(dirname "$0")"
DB=ledger_test
PSQL="psql -v ON_ERROR_STOP=1 -q -X -t -o /dev/null"
dropdb --if-exists "$DB" && createdb "$DB"
$PSQL -d "$DB" -f tests/00_local_stubs.sql
for f in migrations/*.sql; do $PSQL -d "$DB" -f "$f"; done
$PSQL -d "$DB" -f tests/01_grants.sql
$PSQL -d "$DB" -f seed.sql
$PSQL -d "$DB" -f tests/workflows.sql
echo "ALL WORKFLOW TESTS PASSED"
