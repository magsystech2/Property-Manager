-- Notes on receipts and bills.
-- A free-text note that doesn't change any amounts (e.g. "rent deducted for renovation work"). Bulk upload fills it
-- from a "notes" / "review_note" column. Because it never changes money, a note can be edited after a record is
-- posted (on receipts, bills, contributions and sale proceeds); every change is still in the audit log.

alter table public.expenses add column if not exists notes text not null default '';
alter table public.bills    add column if not exists notes text not null default '';

-- Same function as in 20261123000002_rules.sql, with 'notes' added to the editable columns.
create or replace function public.tg_financial_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  review boolean;
  allowed text[] := array['status', 'approved_by', 'approved_at', 'voided_by', 'voided_at', 'void_reason', 'notes'];
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
