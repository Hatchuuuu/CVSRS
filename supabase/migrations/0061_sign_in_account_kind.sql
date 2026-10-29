-- Account entry is determined from governed staff records, never a browser persona selector.
create function public.get_sign_in_account_kind() returns text
language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.staff_memberships where profile_id=auth.uid())
   or exists(select 1 from public.staff_applications where profile_id=auth.uid()) then 'staff' else 'family' end
 where auth.uid() is not null;
$$;
revoke all on function public.get_sign_in_account_kind() from public,anon,authenticated;
grant execute on function public.get_sign_in_account_kind() to authenticated;
