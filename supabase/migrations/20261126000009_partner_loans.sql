-- Borrowed money: loans a partner took personally (from friends, family, a bank) to fund their part of a project.
-- For reference only: the money itself is already in the books as that partner's contribution or personal payment,
-- so nothing here changes any balance, split or payout. It records who borrowed, from whom, how much, at what rate,
-- since when, and what has been repaid, so the app can show the interest building up.
-- Rows can be edited and deleted (it's a reference list, not posted money); the audit log keeps who changed what.

create table if not exists public.partner_loans (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  partner_user_id  uuid not null,                       -- the partner who owes the lender
  project_id       uuid references public.projects(id), -- what the money went into; null = the LLC in general
  lender           text not null check (length(trim(lender)) > 0),
  principal_cents  bigint not null check (principal_cents > 0),
  rate_bps         integer not null default 0 check (rate_bps >= 0 and rate_bps <= 10000), -- 1000 = 10% a year, simple interest
  start_date       date not null,
  status           text not null default 'open' check (status in ('open', 'closed')),
  notes            text not null default '',
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists partner_loans_ws on public.partner_loans (workspace_id, project_id);

create table if not exists public.partner_loan_payments (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  loan_id          uuid not null references public.partner_loans(id) on delete cascade,
  paid_on          date not null,
  amount_cents     bigint not null check (amount_cents > 0),
  kind             text not null default 'interest' check (kind in ('interest', 'principal')),
  note             text not null default '',
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);
create index if not exists partner_loan_payments_loan on public.partner_loan_payments (loan_id);

-- A repayment must belong to a loan in the same workspace.
create or replace function public.tg_loan_payment_same_ws() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select workspace_id from public.partner_loans where id = new.loan_id) is distinct from new.workspace_id then
    raise exception 'loan_id does not belong to this workspace' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists a_same_ws on public.partner_loans;
drop trigger if exists b_touch on public.partner_loans;
drop trigger if exists z_audit on public.partner_loans;
drop trigger if exists a_same_ws on public.partner_loan_payments;
drop trigger if exists z_audit on public.partner_loan_payments;
create trigger a_same_ws before insert or update on public.partner_loans for each row execute function public.tg_same_workspace();
create trigger b_touch before update on public.partner_loans for each row execute function public.tg_touch_updated();
create trigger z_audit after insert or update or delete on public.partner_loans for each row execute function public.tg_audit();
create trigger a_same_ws before insert or update on public.partner_loan_payments for each row execute function public.tg_loan_payment_same_ws();
create trigger z_audit after insert or update or delete on public.partner_loan_payments for each row execute function public.tg_audit();

do $$
declare t text;
begin
  foreach t in array array['partner_loans', 'partner_loan_payments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists m_select on public.%I', t);
    execute format('drop policy if exists m_insert on public.%I', t);
    execute format('drop policy if exists m_update on public.%I', t);
    execute format('drop policy if exists m_delete on public.%I', t);
    execute format('create policy m_select on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy m_insert on public.%I for insert with check (public.is_member(workspace_id))', t);
    execute format('create policy m_update on public.%I for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
    execute format('create policy m_delete on public.%I for delete using (public.is_member(workspace_id))', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
