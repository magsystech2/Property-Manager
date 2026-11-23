-- Project Ledger: server-side rules.
--  * helper functions (membership, balances)
--  * triggers: workspace consistency, posting/approval/void lifecycle, allocation totals,
--    payment balance checks, reimbursement limits, audit trail
--  * RPCs used by the app
--  * reporting views (security_invoker, so RLS applies)

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid());
$$;

create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid() and role = 'owner');
$$;

create or replace function public.is_member_user(ws uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select uid is null or exists (select 1 from public.workspace_members where workspace_id = ws and user_id = uid);
$$;

-- Balance of one bill, ignoring voided payments.
create or replace function public.bill_balance(p_bill uuid,
  out total_cents bigint, out credits_cents bigint, out paid_cents bigint, out outstanding_cents bigint)
language sql stable security definer set search_path = public as $$
  select b.total_cents,
         coalesce(sum(p.amount_cents) filter (where p.kind = 'credit'), 0),
         coalesce(sum(p.amount_cents) filter (where p.kind = 'payment'), 0)
           - coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0),
         b.total_cents
           - coalesce(sum(p.amount_cents) filter (where p.kind in ('credit', 'payment')), 0)
           + coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0)
  from public.bills b
  left join public.bill_payments p on p.bill_id = b.id and p.status = 'posted'
  where b.id = p_bill
  group by b.id;
$$;

-- What a partner has paid personally for project costs (net of vendor refunds they received).
create or replace function public.partner_out_of_pocket(ws uuid, uid uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(case when is_refund then -total_cents else total_cents end)
                   from public.expenses
                   where workspace_id = ws and paid_by_user_id = uid and status = 'posted'), 0)
       + coalesce((select sum(case kind when 'payment' then amount_cents when 'refund' then -amount_cents else 0 end)
                   from public.bill_payments
                   where workspace_id = ws and paid_by_user_id = uid and status = 'posted'), 0);
$$;

-- What the LLC still owes a partner: out-of-pocket minus reimbursements paid.
create or replace function public.partner_owed(ws uuid, uid uuid, exclude_reimbursement uuid default null) returns bigint
language sql stable security definer set search_path = public as $$
  select public.partner_out_of_pocket(ws, uid)
       - coalesce((select sum(amount_cents) from public.reimbursements
                   where workspace_id = ws and partner_user_id = uid and status = 'paid'
                     and id is distinct from exclude_reimbursement), 0);
$$;

-- ---------------------------------------------------------------------------
-- Same-workspace checks (ids from another workspace can't be referenced)
-- ---------------------------------------------------------------------------
create or replace function public.tg_same_workspace() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  j jsonb := to_jsonb(new);
  pair text[];
  checks text[][] := array[
    ['project_id', 'projects'], ['vendor_id', 'vendors'], ['category_id', 'budget_categories'],
    ['commitment_id', 'commitments'], ['bill_id', 'bills'], ['expense_id', 'expenses'],
    ['bill_payment_id', 'bill_payments'], ['reimbursement_id', 'reimbursements'],
    ['contribution_id', 'contributions']];
  ws uuid;
begin
  foreach pair slice 1 in array checks loop
    if j ? pair[1] and j ->> pair[1] is not null then
      execute format('select workspace_id from public.%I where id = $1', pair[2]) into ws using (j ->> pair[1])::uuid;
      if ws is distinct from new.workspace_id then
        raise exception '% does not belong to this workspace', pair[1] using errcode = '42501';
      end if;
    end if;
  end loop;
  foreach pair slice 1 in array array[['paid_by_user_id', ''], ['partner_user_id', '']] loop
    if j ? pair[1] and j ->> pair[1] is not null
       and not public.is_member_user(new.workspace_id, (j ->> pair[1])::uuid) then
      raise exception '% is not a partner in this workspace', pair[1] using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Lifecycle: insert defaults, approvals, voids, no edits/deletes of posted history
-- ---------------------------------------------------------------------------
create or replace function public.tg_financial_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  review boolean;
begin
  select require_review into review from public.workspaces where id = new.workspace_id;
  new.created_by := auth.uid();
  new.created_at := now();
  new.voided_by := null; new.voided_at := null; new.void_reason := null;

  if tg_table_name in ('bills', 'change_orders') then
    new.approved_by := null; new.approved_at := null;
    new.status := case when review then 'pending_review' else 'posted' end;
  elsif tg_table_name = 'reimbursements' then
    new.approved_by := null; new.approved_at := null;
    if review then
      new.status := 'requested';          -- must be approved by another partner before it's paid
      new.paid_date := null;
    elsif new.status not in ('requested', 'paid') then
      raise exception 'A new reimbursement must be requested or paid';
    end if;
    if new.status = 'paid' and new.paid_date is null then new.paid_date := current_date; end if;
  else
    new.status := 'posted';
  end if;
  return new;
end $$;

create or replace function public.tg_financial_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  review boolean;
  allowed text[] := array['status', 'approved_by', 'approved_at', 'voided_by', 'voided_at', 'void_reason'];
  changed text[];
begin
  if old.status = 'void' then
    raise exception 'Voided records cannot be changed' using errcode = '42501';
  end if;
  if tg_table_name = 'reimbursements' then
    allowed := allowed || array['paid_date', 'payment_method', 'reference'];
  end if;

  select array_agg(key) into changed
  from jsonb_each(to_jsonb(new)) n
  where n.value is distinct from (to_jsonb(old) -> n.key) and not (n.key = any(allowed));
  if changed is not null then
    raise exception 'Posted records can''t be edited (%). Void it with a reason and enter a correction.', array_to_string(changed, ', ')
      using errcode = '42501';
  end if;

  if new.status = old.status then
    if (to_jsonb(new) ->> 'approved_by') is distinct from (to_jsonb(old) ->> 'approved_by')
       or new.void_reason is distinct from old.void_reason then
      raise exception 'Invalid change' using errcode = '42501';
    end if;
    return new;
  end if;

  select require_review into review from public.workspaces where id = new.workspace_id;

  if new.status = 'void' then
    if coalesce(trim(new.void_reason), '') = '' then
      raise exception 'A reason is required to void a record';
    end if;
    new.voided_by := auth.uid();
    new.voided_at := now();
    if tg_table_name = 'bills' and exists (
         select 1 from public.bill_payments where bill_id = new.id and status = 'posted') then
      raise exception 'Void this bill''s payments first';
    end if;
    if tg_table_name = 'commitments' and exists (
         select 1 from public.bills where commitment_id = new.id and status <> 'void') then
      raise exception 'Void the bills linked to this commitment first';
    end if;
    return new;
  end if;

  -- Approvals
  if tg_table_name in ('bills', 'change_orders') and old.status = 'pending_review' and new.status = 'posted' then
    if auth.uid() = old.created_by then
      raise exception 'Another partner must approve this' using errcode = '42501';
    end if;
    new.approved_by := auth.uid(); new.approved_at := now();
    return new;
  end if;

  if tg_table_name = 'reimbursements' then
    if old.status = 'requested' and new.status = 'approved' then
      if auth.uid() = old.created_by or auth.uid() = old.partner_user_id then
        raise exception 'Another partner must approve this' using errcode = '42501';
      end if;
      new.approved_by := auth.uid(); new.approved_at := now();
      return new;
    end if;
    if new.status = 'paid' and (old.status = 'approved' or (old.status = 'requested' and not review)) then
      if new.paid_date is null then new.paid_date := current_date; end if;
      return new;
    end if;
  end if;

  raise exception 'Status can''t change from % to %', old.status, new.status using errcode = '42501';
end $$;

create or replace function public.tg_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'Posted financial records can''t be deleted. Void them with a reason instead.' using errcode = '42501';
end $$;

-- ---------------------------------------------------------------------------
-- Allocations must add up to the bill / expense total (checked at commit)
-- ---------------------------------------------------------------------------
create or replace function public.tg_allocation_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  parent_created timestamptz;
  r record := coalesce(new, old);
begin
  if r.bill_id is not null then
    select created_at into parent_created from public.bills where id = r.bill_id;
  else
    select created_at into parent_created from public.expenses where id = r.expense_id;
  end if;
  -- Only while the parent is being created in this same transaction.
  if parent_created is distinct from now() then
    raise exception 'Allocations of a posted record can''t be changed. Void and re-enter it.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.tg_check_allocation_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  bid uuid; eid uuid; total bigint; allocated bigint;
begin
  if tg_table_name = 'allocations' then
    bid := coalesce(new.bill_id, old.bill_id); eid := coalesce(new.expense_id, old.expense_id);
  elsif tg_table_name = 'bills' then bid := new.id;
  else eid := new.id;
  end if;
  if bid is not null then
    select total_cents into total from public.bills where id = bid;
    select coalesce(sum(amount_cents), 0) into allocated from public.allocations where bill_id = bid;
  else
    select total_cents into total from public.expenses where id = eid;
    select coalesce(sum(amount_cents), 0) into allocated from public.allocations where expense_id = eid;
  end if;
  if total is not null and allocated <> total then
    raise exception 'Category amounts (%) must add up to the total (%)', allocated, total using errcode = '23514';
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Bills, payments, reimbursements: balance checks
-- ---------------------------------------------------------------------------
create or replace function public.tg_bill_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if new.commitment_id is not null then
    select * into c from public.commitments where id = new.commitment_id;
    if c.status = 'void' then raise exception 'That commitment is void'; end if;
    if c.project_id <> new.project_id or c.vendor_id <> new.vendor_id then
      raise exception 'A bill must be for the same project and vendor as its commitment';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_payment_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  b record; bal record; delta_out bigint; delta_paid bigint; sign int;
begin
  -- Lock the bill so two partners recording payments at once can't both overpay.
  select * into b from public.bills where id = new.bill_id for update;
  if tg_op = 'INSERT' then
    if b.status <> 'posted' then
      raise exception 'This bill isn''t approved yet (status: %)', b.status;
    end if;
    sign := 1;
  elsif old.status = 'posted' and new.status = 'void' then
    sign := -1;
  else
    return new;
  end if;

  select * into bal from public.bill_balance(new.bill_id);
  delta_out  := case new.kind when 'refund' then new.amount_cents else -new.amount_cents end * sign;
  delta_paid := case new.kind when 'payment' then new.amount_cents when 'refund' then -new.amount_cents else 0 end * sign;

  if bal.outstanding_cents + delta_out < 0 then
    raise exception 'That is more than the % still owed on this bill', to_char(bal.outstanding_cents / 100.0, 'FM$999,999,990.00')
      using errcode = '23514';
  end if;
  if bal.paid_cents + delta_paid < 0 then
    raise exception 'A refund can''t be more than what was paid' using errcode = '23514';
  end if;
  if bal.outstanding_cents + delta_out > bal.total_cents then
    raise exception 'That would leave more owed than the bill total' using errcode = '23514';
  end if;
  return new;
end $$;

create or replace function public.tg_reimbursement_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare owed bigint;
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    -- Serialize reimbursements for this partner.
    perform pg_advisory_xact_lock(hashtextextended(new.workspace_id::text || new.partner_user_id::text, 0));
    owed := public.partner_owed(new.workspace_id, new.partner_user_id, new.id);
    if new.amount_cents > owed then
      raise exception 'The LLC only owes this partner %', to_char(owed / 100.0, 'FM$999,999,990.00')
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

create or replace function public.tg_reimbursement_item_checks() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; payer uuid; covered bigint;
begin
  select * into r from public.reimbursements where id = new.reimbursement_id;
  if new.expense_id is not null then
    select paid_by_user_id into payer from public.expenses where id = new.expense_id;
  else
    select paid_by_user_id into payer from public.bill_payments where id = new.bill_payment_id;
  end if;
  if payer is distinct from r.partner_user_id then
    raise exception 'That item wasn''t paid by this partner';
  end if;
  select coalesce(sum(amount_cents), 0) + new.amount_cents into covered
  from public.reimbursement_items where reimbursement_id = new.reimbursement_id;
  if covered > r.amount_cents then
    raise exception 'Items add up to more than the reimbursement';
  end if;
  return new;
end $$;

create or replace function public.tg_member_role_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.role <> old.role and not public.is_owner(new.workspace_id) then
    raise exception 'Only an owner can change roles' using errcode = '42501';
  end if;
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner'
     and not exists (select 1 from public.workspace_members
                     where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id) then
    raise exception 'A workspace needs at least one owner';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
-- Audit trail
-- ---------------------------------------------------------------------------
create or replace function public.tg_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  n jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  act text := lower(tg_op);
  ws uuid;
begin
  ws := coalesce((n ->> 'workspace_id'), (o ->> 'workspace_id'), (n ->> 'id'), (o ->> 'id'))::uuid;
  if tg_op = 'UPDATE' and (n ->> 'status') is distinct from (o ->> 'status') then
    act := case n ->> 'status'
             when 'void' then 'void'
             when 'paid' then 'paid'
             when 'approved' then 'approve'
             when 'posted' then 'approve'
             else 'update' end;
  end if;
  insert into public.audit_log (workspace_id, table_name, record_id, action, actor, reason, old_row, new_row)
  values (ws, tg_table_name, coalesce(n ->> 'id', o ->> 'id')::uuid, act, auth.uid(), n ->> 'void_reason', o, n);
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Wire up triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['commitments', 'change_orders', 'bills', 'expenses', 'bill_payments',
                           'reimbursements', 'contributions', 'sale_proceeds'] loop
    execute format('create trigger a_same_ws before insert or update on public.%I for each row execute function public.tg_same_workspace()', t);
    execute format('create trigger b_insert before insert on public.%I for each row execute function public.tg_financial_insert()', t);
    execute format('create trigger b_update before update on public.%I for each row execute function public.tg_financial_update()', t);
    execute format('create trigger no_delete before delete on public.%I for each row execute function public.tg_no_delete()', t);
  end loop;

  foreach t in array array['allocations', 'reimbursement_items', 'attachments', 'project_budgets'] loop
    execute format('create trigger a_same_ws before insert or update on public.%I for each row execute function public.tg_same_workspace()', t);
  end loop;

  foreach t in array array['workspaces', 'workspace_members', 'invites', 'projects', 'project_budgets', 'vendors',
                           'budget_categories', 'commitments', 'change_orders', 'bills', 'expenses', 'allocations',
                           'bill_payments', 'reimbursements', 'reimbursement_items', 'contributions',
                           'sale_proceeds', 'attachments'] loop
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
  end loop;
end $$;

create trigger c_allocation_guard before insert or update or delete on public.allocations
  for each row execute function public.tg_allocation_guard();
create constraint trigger d_allocation_total after insert or update or delete on public.allocations
  deferrable initially deferred for each row execute function public.tg_check_allocation_total();
create constraint trigger d_allocation_total after insert on public.bills
  deferrable initially deferred for each row execute function public.tg_check_allocation_total();
create constraint trigger d_allocation_total after insert on public.expenses
  deferrable initially deferred for each row execute function public.tg_check_allocation_total();

create trigger c_bill_checks before insert on public.bills
  for each row execute function public.tg_bill_checks();
create trigger c_payment_checks before insert or update on public.bill_payments
  for each row execute function public.tg_payment_checks();
create trigger c_reimbursement_checks before insert or update on public.reimbursements
  for each row execute function public.tg_reimbursement_checks();
create trigger c_item_checks before insert on public.reimbursement_items
  for each row execute function public.tg_reimbursement_item_checks();
create trigger c_role_guard before update or delete on public.workspace_members
  for each row execute function public.tg_member_role_guard();

-- Attachments are kept for the record: no edits or deletes.
create trigger no_change before update or delete on public.attachments
  for each row execute function public.tg_no_delete();

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------
create or replace function public.create_workspace(p_name text, p_display_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ws uuid; i int := 0; c text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.workspaces (name, created_by) values (p_name, auth.uid()) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role, display_name, email)
  values (ws, auth.uid(), 'owner', p_display_name, lower(auth.jwt() ->> 'email'));
  foreach c in array array['Acquisition', 'Permits', 'Demolition', 'Framing', 'Plumbing', 'Electrical', 'HVAC',
                           'Labor', 'Materials', 'Equipment Rentals', 'Utilities', 'Financing', 'Insurance',
                           'Closing Costs'] loop
    i := i + 1;
    insert into public.budget_categories (workspace_id, name, sort_order) values (ws, c, i);
  end loop;
  return ws;
end $$;

-- Joins every workspace that invited the signed-in user's email.
create or replace function public.accept_invites(p_display_name text) returns setof uuid
language plpgsql security definer set search_path = public as $$
declare inv record; em text := lower(auth.jwt() ->> 'email');
begin
  if auth.uid() is null or em is null then raise exception 'Sign in first'; end if;
  for inv in select * from public.invites where email = em and accepted_at is null loop
    insert into public.workspace_members (workspace_id, user_id, role, display_name, email)
    values (inv.workspace_id, auth.uid(), inv.role, p_display_name, em)
    on conflict (workspace_id, user_id) do nothing;
    update public.invites set accepted_at = now() where id = inv.id;
    return next inv.workspace_id;
  end loop;
end $$;

-- Creates a bill or expense together with its category split, in one transaction.
-- Idempotent: resubmitting the same client_id returns the existing record.
create or replace function public.post_with_allocations(p_table text, p_record jsonb, p_allocations jsonb) returns uuid
language plpgsql security invoker set search_path = public as $$
declare rid uuid; a jsonb; cols text; ws uuid := (p_record ->> 'workspace_id')::uuid;
begin
  if p_table not in ('bills', 'expenses') then raise exception 'Unsupported record type'; end if;
  if p_record ? 'client_id' then
    execute format('select id from public.%I where client_id = $1', p_table) into rid using (p_record ->> 'client_id')::uuid;
    if rid is not null then return rid; end if;
  end if;
  p_record := p_record || jsonb_build_object('id', coalesce(p_record ->> 'id', gen_random_uuid()::text));
  -- Insert only the columns the caller sent, so column defaults still apply.
  select string_agg(quote_ident(column_name), ', ') into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = p_table and p_record ? column_name;
  execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning id',
                 p_table, cols, cols, p_table)
    into rid using p_record;
  for a in select * from jsonb_array_elements(p_allocations) loop
    insert into public.allocations (workspace_id, bill_id, expense_id, category_id, amount_cents)
    values (ws,
            case when p_table = 'bills' then rid end,
            case when p_table = 'expenses' then rid end,
            (a ->> 'category_id')::uuid, (a ->> 'amount_cents')::bigint);
  end loop;
  set constraints all immediate;   -- surface an allocation mismatch as this call's error
  return rid;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting views (RLS of the underlying tables applies)
-- ---------------------------------------------------------------------------
create or replace view public.v_bill_balances with (security_invoker = true) as
select b.id as bill_id, b.workspace_id, b.project_id, b.vendor_id, b.status, b.due_date,
       b.total_cents,
       coalesce(sum(p.amount_cents) filter (where p.kind = 'credit'), 0) as credits_cents,
       coalesce(sum(p.amount_cents) filter (where p.kind = 'payment'), 0)
         - coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0) as paid_cents,
       b.total_cents
         - coalesce(sum(p.amount_cents) filter (where p.kind in ('credit', 'payment')), 0)
         + coalesce(sum(p.amount_cents) filter (where p.kind = 'refund'), 0) as outstanding_cents
from public.bills b
left join public.bill_payments p on p.bill_id = b.id and p.status = 'posted'
group by b.id;

create or replace view public.v_partner_balances with (security_invoker = true) as
select m.workspace_id, m.user_id, m.display_name,
       public.partner_out_of_pocket(m.workspace_id, m.user_id) as out_of_pocket_cents,
       coalesce((select sum(amount_cents) from public.contributions c
                 where c.workspace_id = m.workspace_id and c.partner_user_id = m.user_id and c.status = 'posted'), 0) as contributions_cents,
       coalesce((select sum(amount_cents) from public.reimbursements r
                 where r.workspace_id = m.workspace_id and r.partner_user_id = m.user_id and r.status = 'paid'), 0) as reimbursed_cents,
       coalesce((select sum(amount_cents) from public.reimbursements r
                 where r.workspace_id = m.workspace_id and r.partner_user_id = m.user_id and r.status in ('requested', 'approved')), 0) as pending_reimbursement_cents,
       public.partner_owed(m.workspace_id, m.user_id) as owed_cents
from public.workspace_members m;

-- Per project and category: budget, paid, unpaid billed, unbilled commitments, projected, remaining.
-- Bill payments are spread across a bill's categories in proportion to its allocations.
create or replace view public.v_project_category_summary with (security_invoker = true) as
with
exp as (
  select e.project_id, a.category_id,
         sum(case when e.is_refund then -a.amount_cents else a.amount_cents end) as paid
  from public.expenses e join public.allocations a on a.expense_id = e.id
  where e.status = 'posted' group by 1, 2),
bil as (
  select bb.project_id, a.category_id,
         sum(round(bb.paid_cents::numeric * a.amount_cents / bb.total_cents)) as paid,
         sum(round(bb.outstanding_cents::numeric * a.amount_cents / bb.total_cents)) as unpaid
  from public.v_bill_balances bb join public.allocations a on a.bill_id = bb.bill_id
  where bb.status <> 'void' group by 1, 2),
com as (
  select c.project_id, c.category_id,
         sum(greatest(c.amount_cents
                      + coalesce((select sum(co.amount_cents) from public.change_orders co
                                  where co.commitment_id = c.id and co.status = 'posted'), 0)
                      - coalesce((select sum(bb.total_cents - bb.credits_cents) from public.v_bill_balances bb
                                  join public.bills b2 on b2.id = bb.bill_id
                                  where b2.commitment_id = c.id and bb.status <> 'void'), 0), 0)) as unbilled
  from public.commitments c where c.status = 'posted' group by 1, 2),
keys as (
  select project_id, category_id from public.project_budgets
  union select project_id, category_id from exp
  union select project_id, category_id from bil
  union select project_id, category_id from com)
select k.project_id, k.category_id, cat.name as category,
       coalesce(pb.amount_cents, 0) as budget_cents,
       coalesce(exp.paid, 0) + coalesce(bil.paid, 0) as paid_cents,
       coalesce(bil.unpaid, 0) as unpaid_billed_cents,
       coalesce(com.unbilled, 0) as unbilled_committed_cents,
       coalesce(exp.paid, 0) + coalesce(bil.paid, 0) + coalesce(bil.unpaid, 0) + coalesce(com.unbilled, 0) as projected_cents,
       coalesce(pb.amount_cents, 0)
         - (coalesce(exp.paid, 0) + coalesce(bil.paid, 0) + coalesce(bil.unpaid, 0) + coalesce(com.unbilled, 0)) as remaining_cents
from keys k
join public.budget_categories cat on cat.id = k.category_id
left join public.project_budgets pb on pb.project_id = k.project_id and pb.category_id = k.category_id
left join exp on exp.project_id = k.project_id and exp.category_id = k.category_id
left join bil on bil.project_id = k.project_id and bil.category_id = k.category_id
left join com on com.project_id = k.project_id and com.category_id = k.category_id;

-- ---------------------------------------------------------------------------
-- Row-level security: everything is visible only to members of its workspace.
-- Financial tables have no delete policy (and a trigger blocks deletes anyway).
-- ---------------------------------------------------------------------------
alter table public.workspaces enable row level security;
create policy ws_select on public.workspaces for select using (public.is_member(id));
create policy ws_update on public.workspaces for update using (public.is_owner(id)) with check (public.is_owner(id));

alter table public.workspace_members enable row level security;
create policy wm_select on public.workspace_members for select using (public.is_member(workspace_id));
create policy wm_update on public.workspace_members for update
  using (user_id = auth.uid() or public.is_owner(workspace_id))
  with check (user_id = auth.uid() or public.is_owner(workspace_id));
create policy wm_delete on public.workspace_members for delete using (public.is_owner(workspace_id));

alter table public.invites enable row level security;
create policy inv_select on public.invites for select
  using (public.is_owner(workspace_id) or email = lower(auth.jwt() ->> 'email'));
create policy inv_insert on public.invites for insert with check (public.is_owner(workspace_id));
create policy inv_delete on public.invites for delete using (public.is_owner(workspace_id));

alter table public.audit_log enable row level security;
create policy audit_select on public.audit_log for select using (public.is_member(workspace_id));

do $$
declare t text;
begin
  foreach t in array array['budget_categories', 'projects', 'project_budgets', 'vendors', 'commitments', 'change_orders',
                           'bills', 'expenses', 'allocations', 'bill_payments', 'reimbursements',
                           'reimbursement_items', 'contributions', 'sale_proceeds', 'attachments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy m_select on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy m_insert on public.%I for insert with check (public.is_member(workspace_id))', t);
    execute format('create policy m_update on public.%I for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
  end loop;
  execute 'create policy m_delete on public.project_budgets for delete using (public.is_member(workspace_id))';
end $$;

-- Owner-only workspace settings (e.g. require_review) are covered by ws_update above.
