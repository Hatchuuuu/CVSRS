-- The app acknowledges the exact notice it displayed. Keep the two-argument command for existing database callers.
create function public.acknowledge_clinic_privacy_notice(
  p_operation_key uuid, p_clinic_id uuid, p_notice_version text, p_notice_text text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.clinics; v_prev jsonb; v_sha text; v_g uuid;
begin
  if auth.uid() is null or not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  -- Serialize with the clinic UPDATE in set_privacy_notice, including a publisher already holding this row.
  select * into c from public.clinics where id = p_clinic_id and status = 'active' for update;
  if c.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  -- A lost acknowledgement response must still replay after the clinic publishes
  -- another notice. Replaying v1 never records acceptance of the current v2.
  v_sha := private.notice_digest(p_notice_text);
  v_prev := private.begin_command(c.organization_id, p_operation_key, 'privacy.acknowledge_viewed',
    jsonb_build_object('c', p_clinic_id, 'v', p_notice_version, 'sha256', v_sha));
  if v_prev is not null then return v_prev; end if;
  if p_notice_version is null or p_notice_text is null
     or p_notice_version is distinct from c.operational_policy -> 'privacyNotice' ->> 'version'
     or p_notice_text is distinct from c.operational_policy -> 'privacyNotice' ->> 'text' then
    raise exception 'The privacy notice changed. Refresh and read the current notice before accepting it.' using errcode = 'CV409';
  end if;
  if not private.notice_acknowledged(c.id) then
    select id into v_g from public.guardians where organization_id = c.organization_id and profile_id = auth.uid();
    insert into public.privacy_records (organization_id, guardian_id, clinic_id, profile_id, purpose, record_type, notice_version, notice_sha256, decision, created_by)
    values (c.organization_id, v_g, c.id, auth.uid(), 'care_records', 'notice_acknowledgement', p_notice_version, v_sha, 'acknowledged', auth.uid());
    perform private.audit(c.organization_id, 'guardian', 'privacy.acknowledged', 'clinic', p_clinic_id, null,
      jsonb_build_object('version', p_notice_version, 'sha256', v_sha), null);
  end if;
  return private.finish_command(c.organization_id, p_operation_key, jsonb_build_object('version', p_notice_version, 'acknowledged', true));
end $$;
revoke all on function public.acknowledge_clinic_privacy_notice(uuid, uuid, text, text) from public, anon;
grant execute on function public.acknowledge_clinic_privacy_notice(uuid, uuid, text, text) to authenticated;
