-- Sample data for LOCAL testing: 3 partners, 1 outsider, 2 properties.
-- (On a hosted Supabase project, partners sign up in the app instead; demo mode in the app has its own sample data.)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'madhan@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'partner.b@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'partner.c@example.com'),
  ('00000000-0000-0000-0000-00000000000d', 'outsider@example.com');

set role authenticated;

-- Partner A creates the LLC workspace and invites B and C.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false),
       set_config('request.jwt.claim.email', 'madhan@example.com', false);
create temp table ctx as select public.create_workspace('Sample Flips LLC', 'Madhan') as ws;
insert into public.invites (workspace_id, email) select ws, 'partner.b@example.com' from ctx;
insert into public.invites (workspace_id, email) select ws, 'partner.c@example.com' from ctx;

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false),
       set_config('request.jwt.claim.email', 'partner.b@example.com', false);
select public.accept_invites('Partner B');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', false),
       set_config('request.jwt.claim.email', 'partner.c@example.com', false);
select public.accept_invites('Partner C');

-- The outsider has their own, separate workspace.
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000d', false),
       set_config('request.jwt.claim.email', 'outsider@example.com', false);
select public.create_workspace('Someone Else LLC', 'Outsider');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false),
       set_config('request.jwt.claim.email', 'madhan@example.com', false);

insert into public.projects (id, workspace_id, nickname, address, project_type, status, start_date, target_sale_date)
select '10000000-0000-0000-0000-000000000001', ws, 'Oak St Flip', '123 Oak St', 'flip', 'active', '2026-09-01', '2027-02-15' from ctx;
insert into public.projects (id, workspace_id, nickname, address, project_type, status, start_date, target_complete_date)
select '10000000-0000-0000-0000-000000000002', ws, 'Pine Rd New Build', 'Lot 14 Pine Rd', 'new_construction', 'active', '2026-10-01', '2027-06-30' from ctx;

insert into public.vendors (id, workspace_id, name, kind)
select '20000000-0000-0000-0000-000000000001', ws, 'Home Depot', 'supplier' from ctx;
insert into public.vendors (id, workspace_id, name, kind, contact_name, phone)
select '20000000-0000-0000-0000-000000000002', ws, 'Solid Framing LLC', 'contractor', 'Mike', '555-0100' from ctx;

insert into public.project_budgets (workspace_id, project_id, category_id, amount_cents)
select ws, '10000000-0000-0000-0000-000000000001', c.id, v.amt
from ctx, public.budget_categories c
join (values ('Materials', 2500000), ('Plumbing', 800000), ('Labor', 1500000)) v(name, amt) on v.name = c.name
where c.workspace_id = ctx.ws;
insert into public.project_budgets (workspace_id, project_id, category_id, amount_cents)
select ws, '10000000-0000-0000-0000-000000000002', c.id, v.amt
from ctx, public.budget_categories c
join (values ('Framing', 1200000), ('Materials', 6000000), ('Permits', 900000)) v(name, amt) on v.name = c.name
where c.workspace_id = ctx.ws;

reset role;
