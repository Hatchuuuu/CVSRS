-- CVSRS Migration 0031: Batch Pending Privacy Notices (Eliminates N+1 query loop on guardian dashboard)
create or replace function public.get_pending_privacy_notices() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_res jsonb := '[]'::jsonb;
  v_n jsonb;
  v_ver text;
  v_text text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  for r in (
    select id, name, organization_id, operational_policy -> 'privacyNotice' as pn
    from public.clinics
    where status = 'active'
    order by name asc
  ) loop
    v_n := r.pn;
    if v_n is not null and (v_n ->> 'version') is not null and (v_n ->> 'text') is not null then
      v_ver := v_n ->> 'version';
      v_text := v_n ->> 'text';
      if not private.guardian_ack_version(r.organization_id, v_ver) then
        v_res := v_res || jsonb_build_object(
          'clinicId', r.id,
          'clinicName', r.name,
          'version', v_ver,
          'text', v_text
        );
      end if;
    end if;
  end loop;
  return v_res;
end $$;

revoke all on function public.get_pending_privacy_notices() from public, anon, authenticated;
grant execute on function public.get_pending_privacy_notices() to authenticated;
