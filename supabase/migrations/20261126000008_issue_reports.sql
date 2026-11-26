-- Issue reports: any partner can flag a problem with a record (wrong amount, duplicate, wrong property…) or with the
-- app itself (an error message, something that didn't work), with a note and an optional screenshot. Reports collect
-- in one shared list, where any partner marks them resolved (with what was done) or reopens them.
-- Reports never change money. The screenshot lives in the private attachments bucket under the workspace's folder.

create table if not exists public.issue_reports (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  category         text not null default 'other'
                   check (category in ('wrong_amount', 'duplicate', 'wrong_details', 'missing', 'app_error', 'idea', 'other')),
  note             text not null check (length(trim(note)) > 0),
  -- The record it's about, if any (kind is one of the app's record kinds: expense, bill, payment…).
  record_kind      text check (record_kind in ('expense', 'bill', 'payment', 'reimbursement', 'contribution', 'proceeds', 'distribution', 'commitment', 'changeOrder')),
  record_id        uuid,
  -- Where the partner was and the last error the app showed, filled in by the app.
  page             text not null default '',
  error_text       text not null default '',
  user_agent       text not null default '',
  screenshot_path  text,
  screenshot_name  text,
  status           text not null default 'open' check (status in ('open', 'resolved')),
  resolution       text,
  resolved_by      uuid,
  resolved_at      timestamptz,
  client_id        uuid unique,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  check ((record_kind is null) = (record_id is null)),
  check (screenshot_path is null or screenshot_path like workspace_id::text || '/%')
);
create index if not exists issue_reports_ws_status on public.issue_reports (workspace_id, status);

-- Only the status and resolution note change after a report is made; who resolved it and when is set here.
create or replace function public.tg_issue_report_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if (new.workspace_id, new.category, new.note, new.record_kind, new.record_id, new.page, new.error_text, new.user_agent,
      new.screenshot_path, new.screenshot_name, new.created_by, new.created_at)
     is distinct from (old.workspace_id, old.category, old.note, old.record_kind, old.record_id, old.page, old.error_text, old.user_agent,
      old.screenshot_path, old.screenshot_name, old.created_by, old.created_at) then
    raise exception 'A report can''t be edited after it''s sent. Add a new report instead.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.status = 'resolved' then
      new.resolved_by := auth.uid();
      new.resolved_at := now();
    else
      new.resolved_by := null;
      new.resolved_at := null;
      new.resolution := null;
    end if;
  elsif new.resolved_by is distinct from old.resolved_by or new.resolved_at is distinct from old.resolved_at then
    raise exception 'Invalid change' using errcode = '42501';
  end if;
  return new;
end $$;

-- A report is made by the person signed in.
create or replace function public.tg_issue_report_insert() returns trigger
language plpgsql set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.status := 'open';
  new.resolution := null;
  new.resolved_by := null;
  new.resolved_at := null;
  return new;
end $$;

drop trigger if exists a_same_ws on public.issue_reports;
drop trigger if exists b_insert on public.issue_reports;
drop trigger if exists b_update on public.issue_reports;
drop trigger if exists no_delete on public.issue_reports;
drop trigger if exists z_audit on public.issue_reports;
create trigger a_same_ws before insert or update on public.issue_reports for each row execute function public.tg_same_workspace();
create trigger b_insert before insert on public.issue_reports for each row execute function public.tg_issue_report_insert();
create trigger b_update before update on public.issue_reports for each row execute function public.tg_issue_report_update();
create trigger no_delete before delete on public.issue_reports for each row execute function public.tg_keep_history();
create trigger z_audit after insert or update or delete on public.issue_reports for each row execute function public.tg_audit();

alter table public.issue_reports enable row level security;
drop policy if exists m_select on public.issue_reports;
drop policy if exists m_insert on public.issue_reports;
drop policy if exists m_update on public.issue_reports;
create policy m_select on public.issue_reports for select using (public.is_member(workspace_id));
create policy m_insert on public.issue_reports for insert with check (public.is_member(workspace_id));
create policy m_update on public.issue_reports for update using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'issue_reports') then
    alter publication supabase_realtime add table public.issue_reports;
  end if;
end $$;
