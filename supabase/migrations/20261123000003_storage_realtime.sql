-- Private bucket for receipts, invoices and payment confirmations.
-- Object names are "<workspace_id>/<uuid>-<filename>"; only members of that workspace can read or upload.
insert into storage.buckets (id, name, public, file_size_limit)
values ('attachments', 'attachments', false, 20971520)
on conflict (id) do nothing;

create policy "attachments_member_read" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));

create policy "attachments_member_upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and public.is_member(((storage.foldername(name))[1])::uuid));

-- No update/delete policies: uploaded documents are kept for the record.

-- Live updates for the app.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['projects', 'project_budgets', 'vendors', 'commitments', 'change_orders', 'bills',
                             'expenses', 'allocations', 'bill_payments', 'reimbursements', 'contributions',
                             'sale_proceeds', 'attachments', 'workspace_members', 'budget_categories'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
