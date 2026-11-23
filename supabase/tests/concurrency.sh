#!/usr/bin/env bash
# Two partners record a payment on the same $1,000 bill at the same moment ($600 each).
# Exactly one must succeed. Run after run_local_tests.sh.
DB=ledger_test
BILL=$(psql -d $DB -tAX -c "select id from bills where invoice_number = 'SF-102'")
WS=$(psql -d $DB -tAX -c "select workspace_id from bills where invoice_number = 'SF-102'")
pay() {
  psql -d $DB -tAX -v ON_ERROR_STOP=1 <<SQL 2>&1 | tail -1
set role authenticated;
select set_config('request.jwt.claim.sub', '$1', false);
begin;
insert into bill_payments (workspace_id, bill_id, amount_cents) values ('$WS', '$BILL', 60000);
select pg_sleep(1);
commit;
select 'committed';
SQL
}
pay 00000000-0000-0000-0000-00000000000b > /tmp/p1 & pay 00000000-0000-0000-0000-00000000000c > /tmp/p2 & wait
cat /tmp/p1 /tmp/p2
psql -d $DB -tAX -c "select 'outstanding after race: ' || outstanding_cents from v_bill_balances where bill_id = '$BILL'"
