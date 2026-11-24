-- Receipt inbox, card/bank statement matching, weekly review claims, cash planning and flip profit forecasts.
-- Nothing here changes how existing records post or add up; these tables sit beside the ledger.

-- ---------------------------------------------------------------------------
-- 1. Receipt and invoice inbox
-- A partner drops a receipt photo or contractor PDF in; any partner later files it as a receipt or bill.
-- The file lives in the private attachments bucket. When filed, the app adds an attachments row with the
-- same storage_path linked to the new record, and marks the inbox item filed.
-- ---------------------------------------------------------------------------
create table public.inbox_items (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  storage_path     text not null unique,
  filename         text not null,
  mime_type        text not null default 'application/octet-stream',
  size_bytes       bigint not null default 0,
  note             text not null default '',
  source           text not null default 'upload' check (source in ('upload', 'share', 'email')),
  -- What the app read from the file or the note; the partner confirms or changes it when filing.
  suggested_kind       text check (suggested_kind in ('receipt', 'bill')),
  suggested_project_id uuid references public.projects(id),
  suggested_vendor     text,
  suggested_date       date,
  suggested_total_cents bigint,
  status           text not null default 'new' check (status in ('new', 'filed', 'dismissed')),
  filed_expense_id uuid references public.expenses(id),
  filed_bill_id    uuid references public.bills(id),
  dismiss_reason   text,
  handled_by       uuid,
  handled_at       timestamptz,
  client_id        uuid unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  check (storage_path like workspace_id::text || '/%'),
  check (status <> 'filed' or filed_expense_id is not null or filed_bill_id is not null),
  check (status <> 'dismissed' or length(trim(coalesce(dismiss_reason, ''))) > 0)
);
create index on public.inbox_items (workspace_id, status);

-- ---------------------------------------------------------------------------
-- 2. Card and bank statements
-- Imported from the bank's CSV. fingerprint is built by the app from account, date, amount, description and
-- the occurrence number within the file, so importing the same statement twice skips rows already in.
-- amount_cents > 0 is money out (a charge or payment), < 0 is money in (refund, deposit).
-- ---------------------------------------------------------------------------
create table public.statement_lines (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  account        text not null check (length(trim(account)) > 0),   -- e.g. "Chase Ink 4421"
  account_owner  uuid,                                              -- partner whose personal card it is; null = LLC account
  posted_date    date not null,
  description    text not null default '',
  amount_cents   bigint not null check (amount_cents <> 0),
  fingerprint    text not null,
  import_batch   uuid not null,
  status         text not null default 'unmatched' check (status in ('unmatched', 'matched', 'ignored')),
  ignore_reason  text,
  handled_by     uuid,
  handled_at     timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  unique (workspace_id, fingerprint),
  check (status <> 'ignored' or length(trim(coalesce(ignore_reason, ''))) > 0)
);
create index on public.statement_lines (workspace_id, status, posted_date);

-- Which receipts or bill payments explain a statement line. Several rows = one store trip split across properties.
create table public.statement_matches (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  statement_line_id uuid not null references public.statement_lines(id) on delete cascade,
  expense_id        uuid references public.expenses(id),
  bill_payment_id   uuid references public.bill_payments(id),
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  check ((expense_id is not null) <> (bill_payment_id is not null))
);
create unique index statement_matches_expense_uq on public.statement_matches (expense_id) where expense_id is not null;
create unique index statement_matches_payment_uq on public.statement_matches (bill_payment_id) where bill_payment_id is not null;
create index on public.statement_matches (statement_line_id);

-- ---------------------------------------------------------------------------
-- 3. Weekly review: "I'll handle this", so two partners don't both pay the same bill.
-- One claim per item. Anyone can release a claim (people go on vacation); the audit log shows who.
-- ---------------------------------------------------------------------------
create table public.claims (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  item_kind    text not null check (item_kind in ('bill', 'reimbursement', 'change_order', 'inbox_item', 'statement_line', 'expense')),
  item_id      uuid not null,
  claimed_by   uuid not null default auth.uid(),
  claimed_at   timestamptz not null default now(),
  unique (workspace_id, item_kind, item_id)
);

-- ---------------------------------------------------------------------------
-- 4. Cash planning
-- Scheduled draws on a contractor agreement (expected, not yet billed), and the LLC's cash on hand.
-- ---------------------------------------------------------------------------
create table public.scheduled_draws (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  commitment_id uuid not null references public.commitments(id),
  due_date      date not null,
  amount_cents  bigint not null check (amount_cents > 0),
  description   text not null default '',
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index on public.scheduled_draws (workspace_id, due_date);

-- Latest row is the current balance; older rows are kept as history.
create table public.cash_balances (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  as_of        date not null,
  amount_cents bigint not null,
  note         text not null default '',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create index on public.cash_balances (workspace_id, as_of desc, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Profit forecast inputs per project (all optional).
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists expected_sale_cents   bigint check (expected_sale_cents is null or expected_sale_cents >= 0),
  add column if not exists selling_cost_bps      integer check (selling_cost_bps is null or selling_cost_bps between 0 and 5000),  -- 600 = 6%
  add column if not exists monthly_holding_cents bigint check (monthly_holding_cents is null or monthly_holding_cents >= 0),        -- taxes, insurance, utilities
  add column if not exists loan_balance_cents    bigint check (loan_balance_cents is null or loan_balance_cents >= 0),
  add column if not exists loan_rate_bps         integer check (loan_rate_bps is null or loan_rate_bps between 0 and 5000);       -- 1200 = 12%/yr

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------

-- Statement lines: the bank's facts don't change after import. Only status fields (and the card owner) may.
create or replace function public.tg_statement_line_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.account, new.posted_date, new.description, new.amount_cents, new.fingerprint, new.import_batch, new.workspace_id, new.created_by, new.created_at)
     is distinct from (old.account, old.posted_date, old.description, old.amount_cents, old.fingerprint, old.import_batch, old.workspace_id, old.created_by, old.created_at) then
    raise exception 'Imported statement lines can''t be edited. Ignore it with a reason instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  return new;
end $$;

-- Inbox items: the file can't be swapped; once filed or dismissed it stays that way (reopen = dismissed -> new only).
create or replace function public.tg_inbox_item_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.storage_path, new.filename, new.mime_type, new.size_bytes, new.workspace_id, new.created_by, new.created_at)
     is distinct from (old.storage_path, old.filename, old.mime_type, old.size_bytes, old.workspace_id, old.created_by, old.created_at) then
    raise exception 'The file on an inbox item can''t be changed.' using errcode = '42501';
  end if;
  if old.status = 'filed' and new.status is distinct from old.status then
    raise exception 'This inbox item was already filed.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    new.handled_by := auth.uid();
    new.handled_at := now();
  end if;
  return new;
end $$;

-- A match must point at a posted record of the same workspace, and the line's matched amounts can't exceed it.
create or replace function public.tg_statement_match_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  line_amount bigint;
  rec_status  text;
  total       bigint;
begin
  select amount_cents into line_amount from public.statement_lines where id = new.statement_line_id and workspace_id = new.workspace_id;
  if line_amount is null then raise exception 'statement_line_id does not belong to this workspace' using errcode = '42501'; end if;
  if new.expense_id is not null then
    select status into rec_status from public.expenses where id = new.expense_id;
  else
    select status into rec_status from public.bill_payments where id = new.bill_payment_id;
  end if;
  if rec_status is distinct from 'posted' then raise exception 'Only posted records can be matched to a statement line.'; end if;
  select coalesce(sum(case when m.expense_id is not null
                           then (select case when e.is_refund then -e.total_cents else e.total_cents end from public.expenses e where e.id = m.expense_id)
                           else (select case when p.kind = 'refund' then -p.amount_cents else p.amount_cents end from public.bill_payments p where p.id = m.bill_payment_id) end), 0)
    into total
    from public.statement_matches m
   where m.statement_line_id = new.statement_line_id and m.id <> new.id;
  total := total + coalesce((select case when e.is_refund then -e.total_cents else e.total_cents end from public.expenses e where e.id = new.expense_id),
                            (select case when p.kind = 'refund' then -p.amount_cents else p.amount_cents end from public.bill_payments p where p.id = new.bill_payment_id));
  if abs(total) > abs(line_amount) then
    raise exception 'Matched records add up to more than the statement line.';
  end if;
  return new;
end $$;

-- Claims: you can only claim for yourself.
create or replace function public.tg_claim_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.claimed_by is distinct from auth.uid() then
    raise exception 'You can only claim items for yourself.' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.tg_keep_history() returns trigger
language plpgsql as $$
begin
  raise exception 'This is kept for the record and can''t be changed or deleted.' using errcode = '42501';
end $$;

create trigger a_same_ws before insert or update on public.inbox_items for each row execute function public.tg_same_workspace();
create trigger a_same_ws before insert or update on public.statement_lines for each row execute function public.tg_same_workspace();
create trigger a_same_ws before insert or update on public.scheduled_draws for each row execute function public.tg_same_workspace();
create trigger b_update before update on public.inbox_items for each row execute function public.tg_inbox_item_update();
create trigger b_update before update on public.statement_lines for each row execute function public.tg_statement_line_update();
create trigger c_match_check before insert on public.statement_matches for each row execute function public.tg_statement_match_check();
create trigger c_claim_insert before insert on public.claims for each row execute function public.tg_claim_insert();
create trigger no_delete before delete on public.inbox_items for each row execute function public.tg_keep_history();
create trigger no_delete before delete on public.statement_lines for each row execute function public.tg_keep_history();
create trigger no_change before update on public.statement_matches for each row execute function public.tg_keep_history();
create trigger no_change before update or delete on public.cash_balances for each row execute function public.tg_keep_history();

-- The account owner on a statement line must be a partner of this LLC.
create or replace function public.tg_statement_owner_check() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.account_owner is not null and not public.is_member_user(new.workspace_id, new.account_owner) then
    raise exception 'account_owner is not a partner in this workspace' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger a_owner_check before insert or update on public.statement_lines for each row execute function public.tg_statement_owner_check();

do $$
declare t text;
begin
  foreach t in array array['inbox_items', 'statement_lines', 'statement_matches', 'claims', 'scheduled_draws', 'cash_balances'] loop
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy m_select on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy m_insert on public.%I for insert with check (public.is_member(workspace_id))', t);
  end loop;
  foreach t in array array['inbox_items', 'statement_lines', 'scheduled_draws'] loop
    execute format('create policy m_update on public.%I for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
  end loop;
  -- A wrong match is undone by deleting it (the line goes back to unmatched); claims are released by deleting them;
  -- a mistaken draw schedule is removed. The audit log keeps who did it.
  foreach t in array array['statement_matches', 'claims', 'scheduled_draws'] loop
    execute format('create policy m_delete on public.%I for delete using (public.is_member(workspace_id))', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['inbox_items', 'statement_lines', 'statement_matches', 'claims', 'scheduled_draws', 'cash_balances'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
