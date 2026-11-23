-- Project Ledger: core schema.
-- Money is stored as integer cents (bigint). Dates without time are `date`.
-- Every row belongs to a workspace (the LLC); access is enforced by RLS (next migration).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Workspace, members, invites
-- ---------------------------------------------------------------------------
create table public.workspaces (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  require_review boolean not null default false,  -- bills & reimbursements need a 2nd partner's approval
  created_at     timestamptz not null default now(),
  created_by     uuid default auth.uid()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'partner' check (role in ('owner', 'partner')),
  display_name text not null check (length(trim(display_name)) > 0),
  email        text,
  joined_at    timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on public.workspace_members (user_id);

create table public.invites (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  email        text not null check (email = lower(trim(email)) and position('@' in email) > 1),
  role         text not null default 'partner' check (role in ('owner', 'partner')),
  invited_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  unique (workspace_id, email)
);

-- ---------------------------------------------------------------------------
-- Reference data: budget categories, projects, budgets, vendors
-- ---------------------------------------------------------------------------
create table public.budget_categories (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  sort_order   int not null default 0,
  archived     boolean not null default false
);
create unique index budget_categories_name_uq on public.budget_categories (workspace_id, lower(name));

create table public.projects (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  nickname             text not null check (length(trim(nickname)) > 0),
  address              text not null default '',
  project_type         text not null default 'flip' check (project_type in ('flip', 'new_construction')),
  status               text not null default 'active' check (status in ('planning', 'active', 'listed', 'sold', 'on_hold')),
  start_date           date,
  target_complete_date date,
  target_sale_date     date,
  notes                text not null default '',
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_by           uuid,
  updated_at           timestamptz
);
create index on public.projects (workspace_id);

create table public.project_budgets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id   uuid not null references public.projects(id) on delete cascade,
  category_id  uuid not null references public.budget_categories(id),
  amount_cents bigint not null check (amount_cents >= 0),
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  primary key (project_id, category_id)
);

create table public.vendors (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  kind         text not null default 'supplier' check (kind in ('contractor', 'supplier', 'utility', 'government', 'other')),
  contact_name text not null default '',
  phone        text not null default '',
  email        text not null default '',
  address      text not null default '',
  notes        text not null default '',
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now()
);
create unique index vendors_name_uq on public.vendors (workspace_id, lower(name));

-- ---------------------------------------------------------------------------
-- Financial records. Shared status lifecycle:
--   pending_review -> posted -> void      (posted history is never edited, only voided with a reason)
-- Drafts live on the device until posted.
-- client_id: generated on the device once per record; makes repeated submission idempotent.
-- ---------------------------------------------------------------------------

-- Contractor / supplier commitment (agreed contract amount).
create table public.commitments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id   uuid not null references public.projects(id),
  vendor_id    uuid not null references public.vendors(id),
  category_id  uuid not null references public.budget_categories(id),
  description  text not null default '',
  amount_cents bigint not null check (amount_cents > 0),
  status       text not null default 'posted' check (status in ('posted', 'void')),
  client_id    uuid unique,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  voided_by    uuid, voided_at timestamptz, void_reason text
);

create table public.change_orders (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  commitment_id uuid not null references public.commitments(id),
  description   text not null default '',
  amount_cents  bigint not null check (amount_cents <> 0),   -- negative = deduction
  status        text not null default 'pending_review' check (status in ('pending_review', 'posted', 'void')),
  client_id     uuid unique,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  approved_by   uuid, approved_at timestamptz,
  voided_by     uuid, voided_at timestamptz, void_reason text
);

-- Bill = an amount owed to a vendor (invoice).
create table public.bills (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  project_id     uuid not null references public.projects(id),
  vendor_id      uuid not null references public.vendors(id),
  commitment_id  uuid references public.commitments(id),
  invoice_number text not null default '',
  bill_date      date not null default current_date,
  due_date       date,
  description    text not null default '',
  total_cents    bigint not null check (total_cents > 0),
  tax_cents      bigint not null default 0 check (tax_cents >= 0),
  status         text not null default 'posted' check (status in ('pending_review', 'posted', 'void')),
  client_id      uuid unique,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  approved_by    uuid, approved_at timestamptz,
  voided_by      uuid, voided_at timestamptz, void_reason text,
  check (tax_cents <= total_cents)
);
-- The same vendor invoice number can't be entered twice (unless the first was voided).
create unique index bills_invoice_uq on public.bills (vendor_id, lower(invoice_number))
  where status <> 'void' and invoice_number <> '';
create index on public.bills (workspace_id, project_id);

-- Expense (receipt) = a purchase that was already paid, by a partner personally or by the LLC.
create table public.expenses (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  project_id      uuid not null references public.projects(id),
  vendor_id       uuid not null references public.vendors(id),
  expense_date    date not null default current_date,
  description     text not null default '',
  total_cents     bigint not null check (total_cents > 0),
  tax_cents       bigint not null default 0 check (tax_cents >= 0),
  is_refund       boolean not null default false,       -- money back from a vendor: reduces costs
  paid_by_user_id uuid references auth.users(id),      -- null = paid from the LLC account
  payment_method  text not null default 'card' check (payment_method in ('card', 'check', 'cash', 'ach', 'zelle', 'wire', 'other')),
  reference       text not null default '',
  status          text not null default 'posted' check (status in ('posted', 'void')),
  client_id       uuid unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  voided_by       uuid, voided_at timestamptz, void_reason text,
  check (tax_cents <= total_cents)
);
create index on public.expenses (workspace_id, project_id);

-- Split of a bill or expense across budget categories. Must add up to the total.
create table public.allocations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  bill_id      uuid references public.bills(id) on delete cascade,
  expense_id   uuid references public.expenses(id) on delete cascade,
  category_id  uuid not null references public.budget_categories(id),
  amount_cents bigint not null check (amount_cents > 0),
  check (num_nonnulls(bill_id, expense_id) = 1)
);
create index on public.allocations (bill_id);
create index on public.allocations (expense_id);

-- Money applied to a bill.
--   payment: cash paid to the vendor (reduces balance, counts as paid cost)
--   credit:  vendor credit memo (reduces balance and the billed cost, no cash)
--   refund:  vendor returned cash previously paid (raises balance back, reduces paid cost)
create table public.bill_payments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  bill_id         uuid not null references public.bills(id),
  kind            text not null default 'payment' check (kind in ('payment', 'credit', 'refund')),
  payment_date    date not null default current_date,
  amount_cents    bigint not null check (amount_cents > 0),
  paid_by_user_id uuid references auth.users(id),      -- null = LLC account (or the vendor, for credits)
  payment_method  text not null default 'check' check (payment_method in ('card', 'check', 'cash', 'ach', 'zelle', 'wire', 'other')),
  reference       text not null default '',
  status          text not null default 'posted' check (status in ('posted', 'void')),
  client_id       uuid unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  voided_by       uuid, voided_at timestamptz, void_reason text,
  check (kind <> 'credit' or paid_by_user_id is null)
);
create index on public.bill_payments (bill_id);

-- LLC paying a partner back for money they spent personally. Never a project cost.
create table public.reimbursements (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  partner_user_id uuid not null references auth.users(id),
  amount_cents    bigint not null check (amount_cents > 0),
  request_date    date not null default current_date,
  paid_date       date,
  status          text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'void')),
  payment_method  text not null default 'ach' check (payment_method in ('card', 'check', 'cash', 'ach', 'zelle', 'wire', 'other')),
  reference       text not null default '',
  notes           text not null default '',
  client_id       uuid unique,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  approved_by     uuid, approved_at timestamptz,
  voided_by       uuid, voided_at timestamptz, void_reason text,
  check (status <> 'paid' or paid_date is not null)
);

-- Optional link from a reimbursement to the expenses / payments it covers.
create table public.reimbursement_items (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  reimbursement_id uuid not null references public.reimbursements(id) on delete cascade,
  expense_id       uuid references public.expenses(id),
  bill_payment_id  uuid references public.bill_payments(id),
  amount_cents     bigint not null check (amount_cents > 0),
  check (num_nonnulls(expense_id, bill_payment_id) = 1)
);

-- Capital put into the LLC by a partner. Separate from reimbursements and from project costs.
create table public.contributions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  partner_user_id   uuid not null references auth.users(id),
  project_id        uuid references public.projects(id),
  amount_cents      bigint not null check (amount_cents > 0),
  contribution_date date not null default current_date,
  payment_method    text not null default 'ach' check (payment_method in ('card', 'check', 'cash', 'ach', 'zelle', 'wire', 'other')),
  reference         text not null default '',
  notes             text not null default '',
  status            text not null default 'posted' check (status in ('posted', 'void')),
  client_id         uuid unique,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  voided_by         uuid, voided_at timestamptz, void_reason text
);

-- Net proceeds from selling a property. Separate from contributions.
create table public.sale_proceeds (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id   uuid not null references public.projects(id),
  amount_cents bigint not null check (amount_cents > 0),
  sale_date    date not null default current_date,
  notes        text not null default '',
  status       text not null default 'posted' check (status in ('posted', 'void')),
  client_id    uuid unique,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  voided_by    uuid, voided_at timestamptz, void_reason text
);

-- Files (receipts, invoices, payment confirmations). Bytes live in the private
-- Storage bucket `attachments` under "<workspace_id>/<uuid>-<filename>".
create table public.attachments (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  storage_path     text not null unique,
  filename         text not null,
  mime_type        text not null default 'application/octet-stream',
  size_bytes       bigint not null default 0,
  expense_id       uuid references public.expenses(id),
  bill_id          uuid references public.bills(id),
  bill_payment_id  uuid references public.bill_payments(id),
  reimbursement_id uuid references public.reimbursements(id),
  contribution_id  uuid references public.contributions(id),
  commitment_id    uuid references public.commitments(id),
  vendor_id        uuid references public.vendors(id),
  project_id       uuid references public.projects(id),
  client_id        uuid unique,
  uploaded_by      uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  check (storage_path like workspace_id::text || '/%')
);

-- Who created, edited, approved or voided what, and when.
create table public.audit_log (
  id           bigserial primary key,
  workspace_id uuid not null,
  table_name   text not null,
  record_id    uuid,
  action       text not null,   -- insert, update, approve, void, delete
  actor        uuid,
  at           timestamptz not null default now(),
  reason       text,
  old_row      jsonb,
  new_row      jsonb
);
create index on public.audit_log (workspace_id, table_name, record_id);
