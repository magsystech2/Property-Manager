-- Sale details and profit distribution, materials tracking, and receipt/bill templates (recurring costs).
-- Nothing here changes how existing records post or add up.

-- ---------------------------------------------------------------------------
-- 1. Sale details on sale proceeds
-- amount_cents stays the net the LLC received (sale price minus selling costs). The new columns are optional
-- detail: when the sale price is given, the net must equal sale price - selling costs.
-- loan_payoff_cents is what went to the lender at closing; it isn't a cost (the loan already paid for costs
-- that are counted), it only shows how much cash is left to distribute.
-- ---------------------------------------------------------------------------
alter table public.sale_proceeds
  add column if not exists gross_price_cents   bigint check (gross_price_cents is null or gross_price_cents > 0),
  add column if not exists selling_costs_cents bigint check (selling_costs_cents is null or selling_costs_cents >= 0),
  add column if not exists loan_payoff_cents   bigint check (loan_payoff_cents is null or loan_payoff_cents >= 0);
alter table public.sale_proceeds
  add constraint sale_proceeds_net_check
  check (gross_price_cents is null or amount_cents = gross_price_cents - coalesce(selling_costs_cents, 0));

-- ---------------------------------------------------------------------------
-- 2. Profit shares
-- Rows with project_id null are the LLC's default split; rows with a project_id override it for that project.
-- No rows = equal split. When rows exist, they must add up to 100% (10000 bps), checked at commit so the
-- app can replace the whole split in one transaction.
-- ---------------------------------------------------------------------------
create table public.profit_shares (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  project_id      uuid references public.projects(id),
  partner_user_id uuid not null references auth.users(id),
  share_bps       integer not null check (share_bps between 0 and 10000),
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create unique index profit_shares_uq on public.profit_shares (workspace_id, coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), partner_user_id);

create or replace function public.tg_profit_share_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  total bigint;
  n int;
begin
  r := coalesce(new, old);
  select coalesce(sum(share_bps), 0), count(*) into total, n from public.profit_shares
   where workspace_id = r.workspace_id and project_id is not distinct from r.project_id;
  if n > 0 and total <> 10000 then
    raise exception 'Profit shares must add up to 100%%. These add up to %.', round(total / 100.0, 2) || '%';
  end if;
  return null;
end $$;
create constraint trigger c_share_total after insert or update or delete on public.profit_shares
  deferrable initially deferred for each row execute function public.tg_profit_share_total();

-- Replaces a split in one transaction (the app calls this; RLS still applies since it runs as the caller).
-- p_shares: [{"partner_user_id": "...", "share_bps": 3334}, ...]; an empty array goes back to the default.
create or replace function public.set_profit_shares(p_workspace uuid, p_project uuid, p_shares jsonb) returns void
language plpgsql security invoker set search_path = public as $$
begin
  if not public.is_member(p_workspace) then raise exception 'Not a member of this LLC' using errcode = '42501'; end if;
  delete from public.profit_shares where workspace_id = p_workspace and project_id is not distinct from p_project;
  insert into public.profit_shares (workspace_id, project_id, partner_user_id, share_bps)
  select p_workspace, p_project, (x ->> 'partner_user_id')::uuid, (x ->> 'share_bps')::int
    from jsonb_array_elements(coalesce(p_shares, '[]'::jsonb)) x;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Distributions: money the LLC pays out to a partner from a project (return of capital and profit).
-- Same lifecycle as contributions: posted, voided with a reason, never edited or deleted.
-- ---------------------------------------------------------------------------
create table public.distributions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  partner_user_id   uuid not null references auth.users(id),
  project_id        uuid references public.projects(id),
  amount_cents      bigint not null check (amount_cents > 0),
  distribution_date date not null default current_date,
  payment_method    text not null default 'ach' check (payment_method in ('card', 'check', 'cash', 'ach', 'zelle', 'wire', 'other')),
  reference         text not null default '',
  notes             text not null default '',
  status            text not null default 'posted' check (status in ('posted', 'void')),
  client_id         uuid unique,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  voided_by         uuid, voided_at timestamptz, void_reason text
);
create index on public.distributions (workspace_id, project_id);

-- ---------------------------------------------------------------------------
-- 4. Materials: lightweight tracking of what was bought, used, returned, and what's left over.
-- Not money (the receipt is the money record), so rows can be edited and deleted; the audit log keeps who.
-- ---------------------------------------------------------------------------
create table public.materials (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  project_id      uuid not null references public.projects(id),
  name            text not null check (length(trim(name)) > 0),
  unit            text not null default '',
  qty_bought      numeric(12, 2) not null default 0 check (qty_bought >= 0),
  qty_used        numeric(12, 2) not null default 0 check (qty_used >= 0),
  qty_returned    numeric(12, 2) not null default 0 check (qty_returned >= 0),
  unit_cost_cents bigint not null default 0 check (unit_cost_cents >= 0),
  expense_id      uuid references public.expenses(id),
  location        text not null default '',   -- where the leftovers are (garage, Pine Rd shed…)
  notes           text not null default '',
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (qty_used + qty_returned <= qty_bought)
);
create index on public.materials (workspace_id, project_id);

-- ---------------------------------------------------------------------------
-- 5. Templates: a saved receipt or bill to add again, optionally repeating (insurance, utilities, dumpster).
-- next_due moves forward when a partner adds the repeat. Templates never post anything on their own.
-- ---------------------------------------------------------------------------
create table public.entry_templates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null check (length(trim(name)) > 0),
  kind            text not null check (kind in ('receipt', 'bill')),
  project_id      uuid references public.projects(id),
  vendor_id       uuid references public.vendors(id),
  category_id     uuid references public.budget_categories(id),
  amount_cents    bigint check (amount_cents is null or amount_cents > 0),
  paid_by_user_id uuid,                        -- receipts: partner who usually pays; null = LLC account
  payment_method  text not null default 'card' check (payment_method in ('card', 'check', 'cash', 'ach', 'zelle', 'wire', 'other')),
  description     text not null default '',
  repeat          text not null default 'none' check (repeat in ('none', 'monthly', 'quarterly', 'yearly')),
  next_due        date,
  active          boolean not null default true,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  check (repeat = 'none' or next_due is not null)
);
create index on public.entry_templates (workspace_id, active, next_due);

create or replace function public.tg_touch_updated() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end $$;
create trigger b_touch before update on public.materials for each row execute function public.tg_touch_updated();

-- ---------------------------------------------------------------------------
-- Rules, audit, row-level security, live updates
-- ---------------------------------------------------------------------------
create trigger a_same_ws before insert or update on public.distributions for each row execute function public.tg_same_workspace();
create trigger b_insert before insert on public.distributions for each row execute function public.tg_financial_insert();
create trigger b_update before update on public.distributions for each row execute function public.tg_financial_update();
create trigger no_delete before delete on public.distributions for each row execute function public.tg_no_delete();
create trigger a_same_ws before insert or update on public.profit_shares for each row execute function public.tg_same_workspace();
create trigger a_same_ws before insert or update on public.materials for each row execute function public.tg_same_workspace();
create trigger a_same_ws before insert or update on public.entry_templates for each row execute function public.tg_same_workspace();

do $$
declare t text;
begin
  foreach t in array array['profit_shares', 'distributions', 'materials', 'entry_templates'] loop
    execute format('create trigger z_audit after insert or update or delete on public.%I for each row execute function public.tg_audit()', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy m_select on public.%I for select using (public.is_member(workspace_id))', t);
    execute format('create policy m_insert on public.%I for insert with check (public.is_member(workspace_id))', t);
    execute format('create policy m_update on public.%I for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id))', t);
  end loop;
  foreach t in array array['profit_shares', 'materials', 'entry_templates'] loop
    execute format('create policy m_delete on public.%I for delete using (public.is_member(workspace_id))', t);
  end loop;
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['profit_shares', 'distributions', 'materials', 'entry_templates'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
