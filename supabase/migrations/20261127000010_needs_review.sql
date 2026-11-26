-- "Needs review" flags: any partner can mark a record (expense, bill, contribution…) as needing review, with a note.
-- They reuse issue_reports with category 'needs_review', so they get the same history (no deletes, audit log) and
-- the same open → resolved flow ("Mark reviewed"). They show on their own Needs review page, not under Issues.
-- Never changes money.

alter table public.issue_reports drop constraint if exists issue_reports_category_check;
alter table public.issue_reports add constraint issue_reports_category_check
  check (category in ('wrong_amount', 'duplicate', 'wrong_details', 'missing', 'app_error', 'idea', 'other', 'needs_review'));

-- A review flag is always about a record.
alter table public.issue_reports drop constraint if exists issue_reports_review_has_record;
alter table public.issue_reports add constraint issue_reports_review_has_record
  check (category <> 'needs_review' or record_id is not null);

create index if not exists issue_reports_record on public.issue_reports (record_kind, record_id) where status = 'open';

-- Turn the text markers left by the Chamberlayne import ("[NEEDS REVIEW] " at the start of the description) into real
-- flags, once: one open flag per live expense that has the marker and no open flag yet. The note is taken from the
-- expense's "NEEDS REVIEW: …" note when there is one. The marker text itself stays on the record (posted money isn't edited).
insert into public.issue_reports (workspace_id, category, note, record_kind, record_id, page)
select e.workspace_id, 'needs_review',
       coalesce(nullif(trim(substring(e.notes from '(?i)NEEDS REVIEW:\s*([^\n]*)')), ''), 'Flagged as needs review during the import'),
       'expense', e.id, 'import'
  from public.expenses e
 where e.status <> 'void'
   and e.description ilike '[NEEDS REVIEW]%'
   and not exists (select 1 from public.issue_reports r
                    where r.record_kind = 'expense' and r.record_id = e.id and r.category = 'needs_review' and r.status = 'open');
