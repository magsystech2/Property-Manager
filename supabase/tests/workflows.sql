-- Verifies the six workflows from the spec, plus the server-side safety rules.
\set A '00000000-0000-0000-0000-00000000000a'
\set B '00000000-0000-0000-0000-00000000000b'
\set C '00000000-0000-0000-0000-00000000000c'
\set D '00000000-0000-0000-0000-00000000000d'

create or replace function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', uid::text, false),
         set_config('request.jwt.claim.email', (select email from auth.users where id = uid), false);
$$;
-- Runs SQL and asserts it fails with a message containing `expect`.
create or replace function pg_temp.must_fail(sql text, expect text) returns void language plpgsql as $$
begin
  begin
    execute sql;
  exception when others then
    if position(lower(expect) in lower(sqlerrm)) = 0 then
      raise exception 'Expected error containing "%", got: %', expect, sqlerrm;
    end if;
    raise notice '  ok, refused: %', sqlerrm;
    return;
  end;
  raise exception 'Expected failure ("%") but it succeeded: %', expect, sql;
end $$;
create or replace function pg_temp.eq(label text, got numeric, want numeric) returns void language plpgsql as $$
begin
  if got is distinct from want then raise exception 'FAIL %: got %, want %', label, got, want; end if;
  raise notice '  ok, %: %', label, want;
end $$;

grant execute on all functions in schema pg_temp to authenticated;
set role authenticated;
select pg_temp.login(:'A');
create temp table t as
  select (select id from public.workspaces where name = 'Sample Flips LLC') as ws,
         (select c.id from public.budget_categories c join public.workspaces w on w.id = c.workspace_id
           where w.name = 'Sample Flips LLC' and c.name = 'Materials') as materials,
         (select c.id from public.budget_categories c join public.workspaces w on w.id = c.workspace_id
           where w.name = 'Sample Flips LLC' and c.name = 'Framing') as framing,
         '10000000-0000-0000-0000-000000000001'::uuid as oak,
         '10000000-0000-0000-0000-000000000002'::uuid as pine,
         '20000000-0000-0000-0000-000000000001'::uuid as home_depot,
         '20000000-0000-0000-0000-000000000002'::uuid as framer;
grant select on t to authenticated;

\echo '== Workflow 1: Partner A scans a $350 materials receipt paid with a personal card'
select public.post_with_allocations('expenses',
  jsonb_build_object('workspace_id', ws, 'project_id', oak, 'vendor_id', home_depot, 'expense_date', '2026-11-20',
                     'description', 'Drywall and screws', 'total_cents', 35000, 'tax_cents', 2300,
                     'paid_by_user_id', :'A', 'payment_method', 'card', 'client_id', '30000000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('category_id', materials, 'amount_cents', 35000))) as expense_id
from t \gset
select pg_temp.eq('Oak paid costs', (select sum(paid_cents) from public.v_project_category_summary where project_id = t.oak)::bigint, 35000) from t;
select pg_temp.eq('Owed to Partner A', (select owed_cents from public.v_partner_balances where user_id = :'A'), 35000);

\echo '   repeated submission (same client_id) does not double count'
select pg_temp.eq('same id returned', (public.post_with_allocations('expenses',
  jsonb_build_object('workspace_id', ws, 'project_id', oak, 'vendor_id', home_depot, 'total_cents', 35000,
                     'paid_by_user_id', :'A', 'client_id', '30000000-0000-0000-0000-000000000001'),
  jsonb_build_array(jsonb_build_object('category_id', materials, 'amount_cents', 35000))) = :'expense_id')::int, 1) from t;
select pg_temp.eq('Oak paid costs unchanged', (select sum(paid_cents) from public.v_project_category_summary where project_id = t.oak)::bigint, 35000) from t;

\echo '== Workflow 2: the LLC reimburses Partner A $200'
insert into public.reimbursements (id, workspace_id, partner_user_id, amount_cents, status, paid_date, payment_method)
select '40000000-0000-0000-0000-000000000001', ws, :'A', 20000, 'paid', '2026-11-22', 'zelle' from t;
insert into public.reimbursement_items (workspace_id, reimbursement_id, expense_id, amount_cents)
select ws, '40000000-0000-0000-0000-000000000001', :'expense_id', 20000 from t;
select pg_temp.eq('Oak paid costs still', (select sum(paid_cents) from public.v_project_category_summary where project_id = t.oak)::bigint, 35000) from t;
select pg_temp.eq('Partner A remaining balance', (select owed_cents from public.v_partner_balances where user_id = :'A'), 15000);
select pg_temp.eq('Partner A reimbursed', (select reimbursed_cents from public.v_partner_balances where user_id = :'A'), 20000);
select pg_temp.must_fail(format($q$insert into public.reimbursements (workspace_id, partner_user_id, amount_cents, status) values (%L, %L, 20000, 'paid')$q$, ws, :'A'), 'only owes') from t;

\echo '== Workflow 3: $10,000 commitment, $4,000 invoice, $1,500 partial payment'
insert into public.commitments (id, workspace_id, project_id, vendor_id, category_id, description, amount_cents)
select '50000000-0000-0000-0000-000000000001', ws, pine, framer, framing, 'Framing contract', 1000000 from t;
select pg_temp.eq('Projected before invoice', (select projected_cents from public.v_project_category_summary where project_id = t.pine and category_id = t.framing), 1000000) from t;
select public.post_with_allocations('bills',
  jsonb_build_object('workspace_id', ws, 'project_id', pine, 'vendor_id', framer, 'commitment_id', '50000000-0000-0000-0000-000000000001',
                     'invoice_number', 'SF-101', 'bill_date', '2026-11-15', 'due_date', '2026-12-01', 'total_cents', 400000),
  jsonb_build_array(jsonb_build_object('category_id', framing, 'amount_cents', 400000))) as bill_id
from t \gset
insert into public.bill_payments (id, workspace_id, bill_id, amount_cents, paid_by_user_id, payment_method, reference)
select '60000000-0000-0000-0000-000000000001', ws, :'bill_id', 150000, null, 'check', 'Check 1043' from t;
select pg_temp.eq('Pine framing paid', paid_cents, 150000),
       pg_temp.eq('Pine framing unpaid billed', unpaid_billed_cents, 250000),
       pg_temp.eq('Pine framing unbilled committed', unbilled_committed_cents, 600000),
       pg_temp.eq('Pine framing projected', projected_cents, 1000000),
       pg_temp.eq('Pine framing remaining vs $12,000 budget', remaining_cents, 200000)
from public.v_project_category_summary, t where project_id = t.pine and category_id = t.framing;
select pg_temp.must_fail(format($q$insert into public.bill_payments (workspace_id, bill_id, amount_cents) values (%L, %L, 300000)$q$, ws, :'bill_id'), 'more than') from t;
select pg_temp.must_fail(format($q$select public.post_with_allocations('bills', jsonb_build_object('workspace_id', %L, 'project_id', %L, 'vendor_id', %L, 'invoice_number', 'sf-101', 'total_cents', 100),
  jsonb_build_array(jsonb_build_object('category_id', %L, 'amount_cents', 100)))$q$, ws, pine, framer, framing), 'bills_invoice_uq') from t;

\echo '== Workflow 4: Partner B attaches a receipt to the existing payment'
select pg_temp.login(:'B');
insert into public.attachments (workspace_id, storage_path, filename, mime_type, bill_payment_id)
select ws, ws::text || '/7f6f-check-1043.jpg', 'check-1043.jpg', 'image/jpeg', '60000000-0000-0000-0000-000000000001' from t;
select pg_temp.eq('Attachment on payment', (select count(*) from public.attachments where bill_payment_id = '60000000-0000-0000-0000-000000000001'), 1);
select pg_temp.eq('Pine framing paid unchanged', (select paid_cents from public.v_project_category_summary, t where project_id = t.pine and category_id = t.framing), 150000);
select pg_temp.eq('Partner A owed unchanged', (select owed_cents from public.v_partner_balances where user_id = :'A'), 15000);

\echo '== Workflow 5: Partner B sees the same records; an outsider sees nothing'
select pg_temp.eq('B sees expenses', (select count(*) from public.expenses), 1);
select pg_temp.eq('B sees bills', (select count(*) from public.bills), 1);
select pg_temp.eq('B sees partner balances', (select count(*) from public.v_partner_balances), 3);
select pg_temp.login(:'D');
select pg_temp.eq('Outsider sees expenses', (select count(*) from public.expenses), 0);
select pg_temp.eq('Outsider sees attachments', (select count(*) from public.attachments), 0);
select pg_temp.eq('Outsider sees projects', (select count(*) from public.projects), 0);
select pg_temp.eq('Outsider sees audit log of the LLC', (select count(*) from public.audit_log a join t on a.workspace_id = t.ws), 0);
select pg_temp.must_fail(format($q$insert into public.expenses (workspace_id, project_id, vendor_id, total_cents) values (%L, %L, %L, 100)$q$, ws, oak, home_depot), 'row-level security') from t;
select pg_temp.must_fail(format($q$insert into storage.objects (bucket_id, name) values ('attachments', %L)$q$, ws::text || '/x.jpg'), 'row-level security') from t;
select pg_temp.must_fail(format($q$update public.workspaces set require_review = false where id = %L returning 1$q$, ws), '') from t
  where false; -- (update silently matches 0 rows under RLS; checked below)
update public.workspaces set name = 'hacked' where id = (select ws from t);
reset role;
select pg_temp.eq('Workspace name not changed by outsider', (select count(*) from public.workspaces where name = 'hacked'), 0);
set role authenticated;

\echo '== Records: no edits or deletes of posted history; voids need a reason and are audited'
select pg_temp.login(:'A');
select pg_temp.must_fail(format($q$update public.expenses set total_cents = 1 where id = %L$q$, :'expense_id'), 'can''t be edited');
delete from public.bill_payments where id = '60000000-0000-0000-0000-000000000001';  -- no delete policy: matches 0 rows
select pg_temp.eq('Payment still there after delete attempt', (select count(*) from public.bill_payments where id = '60000000-0000-0000-0000-000000000001'), 1);
select pg_temp.must_fail(format($q$update public.bills set status = 'void' where id = %L$q$, :'bill_id'), 'reason');
select pg_temp.must_fail(format($q$update public.bills set status = 'void', void_reason = 'dup' where id = %L$q$, :'bill_id'), 'payments first');
select pg_temp.must_fail(format($q$insert into public.allocations (workspace_id, expense_id, category_id, amount_cents) select ws, %L, materials, 5 from t$q$, :'expense_id'), 'can''t be changed');
select pg_temp.must_fail(format($q$select public.post_with_allocations('expenses', jsonb_build_object('workspace_id', %L, 'project_id', %L, 'vendor_id', %L, 'total_cents', 10000),
  jsonb_build_array(jsonb_build_object('category_id', %L, 'amount_cents', 9000)))$q$, ws, oak, home_depot, materials), 'add up') from t;
update public.bill_payments set status = 'void', void_reason = 'Check bounced' where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.eq('Pine framing paid after void', (select paid_cents from public.v_project_category_summary, t where project_id = t.pine and category_id = t.framing), 0);
select pg_temp.eq('Pine framing unpaid after void', (select unpaid_billed_cents from public.v_project_category_summary, t where project_id = t.pine and category_id = t.framing), 400000);
select pg_temp.eq('Void is audited with reason', (select count(*) from public.audit_log where action = 'void' and reason = 'Check bounced' and actor = :'A'), 1);
select pg_temp.must_fail($q$update public.bill_payments set status = 'posted' where id = '60000000-0000-0000-0000-000000000001'$q$, 'voided');

\echo '== Review mode: a second partner must approve bills and reimbursements'
update public.workspaces set require_review = true where id = (select ws from t);
select pg_temp.login(:'B');
select pg_temp.must_fail($q$update public.workspaces set require_review = false$q$, '') where false;
select public.post_with_allocations('bills',
  jsonb_build_object('workspace_id', ws, 'project_id', pine, 'vendor_id', framer, 'commitment_id', '50000000-0000-0000-0000-000000000001',
                     'invoice_number', 'SF-102', 'total_cents', 100000),
  jsonb_build_array(jsonb_build_object('category_id', framing, 'amount_cents', 100000))) as bill2
from t \gset
select pg_temp.eq('New bill waits for review', (select (status = 'pending_review')::int from public.bills where id = :'bill2')::bigint, 1);
select pg_temp.must_fail(format($q$insert into public.bill_payments (workspace_id, bill_id, amount_cents) select ws, %L, 100 from t$q$, :'bill2'), 'approved');
select pg_temp.must_fail(format($q$update public.bills set status = 'posted' where id = %L$q$, :'bill2'), 'another partner');
select pg_temp.login(:'C');
update public.bills set status = 'posted' where id = :'bill2';
select pg_temp.eq('Approved by C', (select (approved_by = :'C')::int from public.bills where id = :'bill2')::bigint, 1);
select pg_temp.eq('Projected still $10,000 (bill moved from unbilled to billed)', (select projected_cents from public.v_project_category_summary, t where project_id = t.pine and category_id = t.framing), 1000000);
select pg_temp.login(:'A');
insert into public.reimbursements (id, workspace_id, partner_user_id, amount_cents, status)
select '40000000-0000-0000-0000-000000000002', ws, :'A', 15000, 'paid' from t;
select pg_temp.eq('Reimbursement forced to requested', (select (status = 'requested')::int from public.reimbursements where id = '40000000-0000-0000-0000-000000000002')::bigint, 1);
select pg_temp.eq('Pending reimbursement shown', (select pending_reimbursement_cents from public.v_partner_balances where user_id = :'A'), 15000);
select pg_temp.must_fail($q$update public.reimbursements set status = 'approved' where id = '40000000-0000-0000-0000-000000000002'$q$, 'another partner');
select pg_temp.login(:'B');
update public.reimbursements set status = 'approved' where id = '40000000-0000-0000-0000-000000000002';
update public.reimbursements set status = 'paid', paid_date = '2026-11-23', reference = 'Zelle 8812' where id = '40000000-0000-0000-0000-000000000002';
select pg_temp.eq('Partner A fully reimbursed', (select owed_cents from public.v_partner_balances where user_id = :'A'), 0);

\echo '== Owner removes and restores a partner''s access; history and balances stay'
select pg_temp.login(:'B');
update public.workspace_members set access_revoked_at = now() where user_id = :'C';  -- RLS: matches no row for a non-owner
reset role;
select pg_temp.eq('Partner B can''t remove C''s access', (select count(*) from public.workspace_members where user_id = :'C' and access_revoked_at is not null), 0);
set role authenticated;
select pg_temp.login(:'A');
select pg_temp.must_fail(format($q$update public.workspace_members set access_revoked_at = now() where user_id = %L$q$, :'A'), 'change an owner');
update public.workspace_members set access_revoked_at = now() where user_id = :'C';
select pg_temp.eq('Revoked partner still listed with balances', (select count(*) from public.v_partner_balances), 3);
select pg_temp.login(:'C');
select pg_temp.eq('Revoked partner sees expenses', (select count(*) from public.expenses), 0);
select pg_temp.eq('Revoked partner sees bills', (select count(*) from public.bills), 0);
select pg_temp.eq('Revoked partner sees attachments', (select count(*) from public.attachments), 0);
select pg_temp.eq('Revoked partner sees workspace', (select count(*) from public.workspaces w join t on w.id = t.ws), 0);
select pg_temp.must_fail(format($q$insert into public.expenses (workspace_id, project_id, vendor_id, total_cents) values (%L, %L, %L, 100)$q$, ws, oak, home_depot), 'row-level security') from t;
select pg_temp.must_fail(format($q$insert into storage.objects (bucket_id, name) values ('attachments', %L)$q$, ws::text || '/y.jpg'), 'row-level security') from t;
do $$ begin  -- either refused or matches no visible row; both are fine
  update public.workspace_members set access_revoked_at = null where user_id = auth.uid();
exception when others then null; end $$;
select pg_temp.eq('Revoked partner can''t restore themselves', (select count(*) from public.expenses), 0);
select pg_temp.login(:'A');
delete from public.workspace_members where user_id = :'C';
select pg_temp.eq('Members can''t be deleted (no delete policy)', (select count(*) from public.workspace_members m join t on m.workspace_id = t.ws), 3);
update public.workspace_members set access_revoked_at = null where user_id = :'C';
select pg_temp.login(:'C');
select pg_temp.eq('Restored partner sees expenses again', (select (count(*) > 0)::int from public.expenses), 1);
select pg_temp.login(:'B');

\echo '== Only an owner can change roles'
select pg_temp.must_fail(format($q$update public.workspace_members set role = 'owner' where user_id = %L$q$, :'B'), 'owner');

\echo '== Receipt inbox: drop a file in, file it as a receipt, or dismiss with a reason'
select pg_temp.login(:'A');
insert into public.inbox_items (id, workspace_id, storage_path, filename, mime_type, suggested_project_id, suggested_vendor, suggested_total_cents)
select '50000000-0000-0000-0000-000000000001', ws, ws::text || '/inbox-receipt.jpg', 'receipt.jpg', 'image/jpeg', oak, 'Home Depot', 4210 from t;
insert into public.inbox_items (id, workspace_id, storage_path, filename) select '50000000-0000-0000-0000-000000000002', ws, ws::text || '/inbox-dup.pdf', 'dup.pdf' from t;
select pg_temp.login(:'B');
select pg_temp.eq('Partner B sees the shared inbox', (select count(*) from public.inbox_items), 2);
select pg_temp.must_fail($q$update public.inbox_items set status = 'filed' where id = '50000000-0000-0000-0000-000000000001'$q$, 'check');
select public.post_with_allocations('expenses',
  jsonb_build_object('workspace_id', ws, 'project_id', oak, 'vendor_id', home_depot, 'expense_date', '2026-11-22', 'total_cents', 4210,
                     'paid_by_user_id', :'B', 'payment_method', 'card', 'client_id', '50000000-0000-0000-0000-0000000000e1'),
  jsonb_build_array(jsonb_build_object('category_id', materials, 'amount_cents', 4210))) as inbox_expense
from t \gset
insert into public.attachments (workspace_id, storage_path, filename, mime_type, expense_id) select ws, ws::text || '/inbox-receipt.jpg', 'receipt.jpg', 'image/jpeg', :'inbox_expense' from t;
update public.inbox_items set status = 'filed', filed_expense_id = :'inbox_expense' where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.eq('Filed item records who filed it', (select (handled_by = :'B')::int from public.inbox_items where id = '50000000-0000-0000-0000-000000000001'), 1);
select pg_temp.must_fail($q$update public.inbox_items set status = 'new' where id = '50000000-0000-0000-0000-000000000001'$q$, 'already filed');
select pg_temp.must_fail($q$update public.inbox_items set storage_path = storage_path || 'x' where id = '50000000-0000-0000-0000-000000000002'$q$, 'can''t be changed');
select pg_temp.must_fail($q$update public.inbox_items set status = 'dismissed' where id = '50000000-0000-0000-0000-000000000002'$q$, 'check');
update public.inbox_items set status = 'dismissed', dismiss_reason = 'Duplicate of the Home Depot receipt' where id = '50000000-0000-0000-0000-000000000002';
delete from public.inbox_items where id = '50000000-0000-0000-0000-000000000002';
select pg_temp.eq('Inbox items can''t be deleted', (select count(*) from public.inbox_items), 2);

\echo '== Statement matching: import, skip re-imports, match a split trip, ignore with a reason'
select pg_temp.login(:'A');
insert into public.statement_lines (id, workspace_id, account, account_owner, posted_date, description, amount_cents, fingerprint, import_batch)
select '60000000-0000-0000-0000-000000000001', ws, 'Chase 4421', :'A', '2026-11-22', 'HOME DEPOT #123', 10000, 'chase4421|2026-11-22|10000|home depot #123|1', '60000000-0000-0000-0000-0000000000b1' from t;
insert into public.statement_lines (id, workspace_id, account, posted_date, description, amount_cents, fingerprint, import_batch)
select '60000000-0000-0000-0000-000000000002', ws, 'LLC checking', '2026-11-23', 'MONTHLY FEE', 1500, 'llc|2026-11-23|1500|monthly fee|1', '60000000-0000-0000-0000-0000000000b1' from t;
select pg_temp.must_fail(format($q$insert into public.statement_lines (workspace_id, account, posted_date, amount_cents, fingerprint, import_batch) values (%L, 'Chase 4421', '2026-11-22', 10000, 'chase4421|2026-11-22|10000|home depot #123|1', gen_random_uuid())$q$, ws), 'duplicate') from t;
select pg_temp.must_fail(format($q$insert into public.statement_lines (workspace_id, account, account_owner, posted_date, amount_cents, fingerprint, import_batch) values (%L, 'x', %L, '2026-11-22', 5, 'x', gen_random_uuid())$q$, ws, :'D'), 'not a partner') from t;
-- One $100 trip split across two properties: $60 Oak, $40 Pine.
select public.post_with_allocations('expenses',
  jsonb_build_object('workspace_id', ws, 'project_id', oak, 'vendor_id', home_depot, 'expense_date', '2026-11-22', 'total_cents', 6000,
                     'paid_by_user_id', :'A', 'payment_method', 'card', 'client_id', '60000000-0000-0000-0000-0000000000e1'),
  jsonb_build_array(jsonb_build_object('category_id', materials, 'amount_cents', 6000))) as split_oak from t \gset
select public.post_with_allocations('expenses',
  jsonb_build_object('workspace_id', ws, 'project_id', pine, 'vendor_id', home_depot, 'expense_date', '2026-11-22', 'total_cents', 4000,
                     'paid_by_user_id', :'A', 'payment_method', 'card', 'client_id', '60000000-0000-0000-0000-0000000000e2'),
  jsonb_build_array(jsonb_build_object('category_id', materials, 'amount_cents', 4000))) as split_pine from t \gset
insert into public.statement_matches (workspace_id, statement_line_id, expense_id) select ws, '60000000-0000-0000-0000-000000000001', :'split_oak' from t;
insert into public.statement_matches (workspace_id, statement_line_id, expense_id) select ws, '60000000-0000-0000-0000-000000000001', :'split_pine' from t;
insert into public.statement_lines (id, workspace_id, account, posted_date, amount_cents, fingerprint, import_batch)
select '60000000-0000-0000-0000-000000000003', ws, 'LLC checking', '2026-11-22', 50000, 'llc|2026-11-22|50000||1', '60000000-0000-0000-0000-0000000000b1' from t;
select pg_temp.must_fail(format($q$insert into public.statement_matches (workspace_id, statement_line_id, expense_id) values (%L, '60000000-0000-0000-0000-000000000003', %L)$q$, ws, :'split_oak'), 'duplicate') from t;
select pg_temp.must_fail(format($q$insert into public.statement_matches (workspace_id, statement_line_id, expense_id) values (%L, '60000000-0000-0000-0000-000000000002', %L)$q$, ws, :'inbox_expense'), 'more than the statement line') from t;
update public.statement_lines set status = 'matched' where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.must_fail($q$update public.statement_lines set amount_cents = 1 where id = '60000000-0000-0000-0000-000000000001'$q$, 'can''t be edited');
select pg_temp.must_fail($q$update public.statement_lines set status = 'ignored' where id = '60000000-0000-0000-0000-000000000002'$q$, 'check');
update public.statement_lines set status = 'ignored', ignore_reason = 'Bank fee, not a project cost' where id = '60000000-0000-0000-0000-000000000002';
select pg_temp.eq('Split line has two matches', (select count(*) from public.statement_matches where statement_line_id = '60000000-0000-0000-0000-000000000001'), 2);
delete from public.statement_lines where id = '60000000-0000-0000-0000-000000000002';
select pg_temp.eq('Statement lines can''t be deleted', (select count(*) from public.statement_lines), 3);

\echo '== Weekly review claims: claim for yourself only; one claim per item; anyone can release'
insert into public.claims (workspace_id, item_kind, item_id) select ws, 'statement_line', '60000000-0000-0000-0000-000000000002' from t;
select pg_temp.login(:'B');
select pg_temp.must_fail(format($q$insert into public.claims (workspace_id, item_kind, item_id) values (%L, 'statement_line', '60000000-0000-0000-0000-000000000002')$q$, ws), 'duplicate') from t;
select pg_temp.must_fail(format($q$insert into public.claims (workspace_id, item_kind, item_id, claimed_by) values (%L, 'bill', gen_random_uuid(), %L)$q$, ws, :'A'), 'for yourself') from t;
delete from public.claims where item_id = '60000000-0000-0000-0000-000000000002';
select pg_temp.eq('Claim released', (select count(*) from public.claims), 0);

\echo '== Cash planning and forecast inputs'
insert into public.cash_balances (workspace_id, as_of, amount_cents) select ws, '2026-11-23', 2500000 from t;
update public.cash_balances set amount_cents = 1;
select pg_temp.eq('Cash history can''t be edited', (select amount_cents from public.cash_balances), 2500000);
update public.projects set expected_sale_cents = 42000000, selling_cost_bps = 600, monthly_holding_cents = 150000, loan_balance_cents = 25000000, loan_rate_bps = 1100 where id = (select oak from t);
select pg_temp.must_fail(format($q$update public.projects set selling_cost_bps = 9000 where id = %L$q$, oak), 'check') from t;
select pg_temp.login(:'D');
select pg_temp.eq('Outsider sees no inbox', (select count(*) from public.inbox_items), 0);
select pg_temp.eq('Outsider sees no statements', (select count(*) from public.statement_lines), 0);
select pg_temp.eq('Outsider sees no cash', (select count(*) from public.cash_balances), 0);
select pg_temp.must_fail(format($q$insert into public.claims (workspace_id, item_kind, item_id) values (%L, 'bill', gen_random_uuid())$q$, ws), 'row-level security') from t;
select pg_temp.login(:'B');

\echo '== Sale details, profit shares and distributions'
select pg_temp.login(:'A');
select pg_temp.must_fail(format($q$insert into public.sale_proceeds (workspace_id, project_id, amount_cents, gross_price_cents, selling_costs_cents) values (%L, %L, 100, 1000, 50)$q$, ws, oak), 'sale_proceeds_net_check') from t;
insert into public.sale_proceeds (workspace_id, project_id, amount_cents, gross_price_cents, selling_costs_cents, loan_payoff_cents, sale_date)
select ws, oak, 39480000, 42000000, 2520000, 25000000, '2026-11-24' from t;
select pg_temp.must_fail(format($q$select public.set_profit_shares(%L, null, '[{"partner_user_id": "%s", "share_bps": 5000}, {"partner_user_id": "%s", "share_bps": 4000}]'::jsonb); set constraints all immediate$q$, ws, :'A', :'B'), 'add up to 100%') from t;
select public.set_profit_shares(ws, null, format('[{"partner_user_id": "%s", "share_bps": 5000}, {"partner_user_id": "%s", "share_bps": 2500}, {"partner_user_id": "%s", "share_bps": 2500}]', :'A', :'B', :'C')::jsonb) from t;
select pg_temp.eq('Default split saved', (select sum(share_bps) from public.profit_shares where project_id is null), 10000);
select public.set_profit_shares(ws, oak, format('[{"partner_user_id": "%s", "share_bps": 3334}, {"partner_user_id": "%s", "share_bps": 3333}, {"partner_user_id": "%s", "share_bps": 3333}]', :'A', :'B', :'C')::jsonb) from t;
select pg_temp.eq('Project override saved beside the default', (select count(*) from public.profit_shares), 6);
select pg_temp.must_fail(format($q$select public.set_profit_shares(%L, null, '[{"partner_user_id": "%s", "share_bps": 10000}]'::jsonb)$q$, ws, :'D'), 'not a partner') from t;
insert into public.distributions (workspace_id, partner_user_id, project_id, amount_cents, payment_method) select ws, :'B', oak, 5000000, 'wire' from t;
select pg_temp.must_fail($q$update public.distributions set amount_cents = 1$q$, 'can''t be edited');
select pg_temp.must_fail($q$update public.distributions set status = 'void'$q$, 'reason');
update public.distributions set status = 'void', void_reason = 'Wrong partner';
delete from public.distributions;
select pg_temp.eq('Distributions are voided, never deleted', (select count(*) from public.distributions), 1);
select pg_temp.must_fail(format($q$insert into public.distributions (workspace_id, partner_user_id, amount_cents) values (%L, %L, 100)$q$, ws, :'D'), 'not a partner') from t;

\echo '== Materials and templates'
insert into public.materials (id, workspace_id, project_id, name, unit, qty_bought, qty_used, unit_cost_cents)
select '70000000-0000-0000-0000-000000000001', ws, oak, 'LVP flooring', 'box', 40, 34, 5899 from t;
select pg_temp.must_fail($q$update public.materials set qty_used = 50 where id = '70000000-0000-0000-0000-000000000001'$q$, 'check');
select pg_temp.login(:'B');
update public.materials set qty_returned = 4, location = 'Pine Rd garage' where id = '70000000-0000-0000-0000-000000000001';
select pg_temp.eq('Partner B updated returns; creator kept', (select (qty_returned = 4 and created_by = :'A')::int from public.materials), 1);
insert into public.entry_templates (workspace_id, name, kind, project_id, vendor_id, category_id, amount_cents, repeat, next_due)
select ws, 'Builder''s risk insurance', 'bill', oak, home_depot, materials, 21000, 'monthly', '2026-12-01' from t;
select pg_temp.must_fail(format($q$insert into public.entry_templates (workspace_id, name, kind, repeat) values (%L, 'x', 'bill', 'monthly')$q$, ws), 'check') from t;
update public.entry_templates set next_due = '2027-01-01';
delete from public.materials;
select pg_temp.eq('Materials can be removed', (select count(*) from public.materials), 0);
select pg_temp.login(:'D');
select pg_temp.eq('Outsider sees no distributions', (select count(*) from public.distributions), 0);
select pg_temp.eq('Outsider sees no templates', (select count(*) from public.entry_templates), 0);
select pg_temp.eq('Outsider sees no profit shares', (select count(*) from public.profit_shares), 0);
select pg_temp.login(:'B');

reset role;
