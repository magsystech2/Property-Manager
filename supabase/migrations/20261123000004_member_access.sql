-- Owner can remove a partner's access without deleting them.
-- A partner with revoked access keeps their name and balances in the books (the LLC may still owe them),
-- but row-level security stops them reading or writing any record or file of that LLC.
-- Only an owner can revoke or restore access, and only for partners (an owner must be changed to partner first).

alter table public.workspace_members add column if not exists access_revoked_at timestamptz;

-- Membership checks used by every RLS policy and the storage bucket now ignore revoked members.
create or replace function public.is_member(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = ws and user_id = auth.uid() and access_revoked_at is null);
$$;

create or replace function public.is_owner(ws uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = ws and user_id = auth.uid() and role = 'owner' and access_revoked_at is null);
$$;

create or replace function public.tg_member_role_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.role <> old.role and not public.is_owner(new.workspace_id) then
    raise exception 'Only an owner can change roles' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.access_revoked_at is distinct from old.access_revoked_at then
    if not public.is_owner(new.workspace_id) then
      raise exception 'Only an owner can change who has access' using errcode = '42501';
    end if;
    if new.access_revoked_at is not null and (new.role = 'owner' or new.user_id = auth.uid()) then
      raise exception 'Change an owner to partner before removing their access' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.role = 'owner' and new.access_revoked_at is not null then
    raise exception 'Restore access before making this member an owner' using errcode = '42501';
  end if;
  if (tg_op = 'DELETE' or new.role <> 'owner') and old.role = 'owner'
     and not exists (select 1 from public.workspace_members
                     where workspace_id = old.workspace_id and role = 'owner' and user_id <> old.user_id
                       and access_revoked_at is null) then
    raise exception 'A workspace needs at least one owner';
  end if;
  return coalesce(new, old);
end $$;

-- Deleting a member would orphan their name and balances, so the app revokes access instead.
drop policy if exists wm_delete on public.workspace_members;

-- An invitation accepted again by a revoked partner does not restore access; the owner restores it.
