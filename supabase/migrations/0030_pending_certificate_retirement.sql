-- A failed render leaves an immutable pending snapshot. Authorized staff can retire
-- that unpublished artifact, correct the source record, then prepare a fresh one.
create or replace function public.revoke_certificate(p_operation_key uuid, p_clinic_id uuid, p_certificate_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; c public.certificates;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'certificate.issue');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'certificate.revoke', jsonb_build_object('c', p_clinic_id, 'cert', p_certificate_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into c from public.certificates where id = p_certificate_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if c.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if c.status = 'revoked' then raise exception 'already revoked' using errcode = 'CV409'; end if;
  if c.status = 'pending' then
    -- Clear even a rotated render token. No pending certificate was ever public or issued.
    update public.certificates set status = 'revoked', verification_token_hash = null,
      revoked_at = now(), revoked_by = auth.uid(), revocation_reason = left(btrim(p_reason), 300), review_needed = false
      where id = c.id;
    perform private.audit(v_org, 'certificate.issue', 'certificate.retired_pending', 'certificate', c.id,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'revoked'), p_reason);
    return private.finish_command(v_org, p_operation_key,
      jsonb_build_object('certificateId', c.id, 'status', 'revoked', 'retiredPending', true));
  end if;
  update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = left(btrim(p_reason), 300), review_needed = false where id = c.id;
  perform private.enqueue(v_org, 'certificate.revoked', 'certificate', c.id, 'cert-revoked:' || c.id, '{}'::jsonb);
  perform private.audit(v_org, 'certificate.issue', 'certificate.revoked', 'certificate', c.id, jsonb_build_object('status', c.status), jsonb_build_object('status', 'revoked'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('certificateId', c.id, 'status', 'revoked'));
end $$;

-- A retired draft has no issued document and must never appear in the family list.
create or replace function public.guardian_list_certificates(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  return (select coalesce(jsonb_agg(private.certificate_json(c, false) order by c.created_at desc), '[]'::jsonb)
    from public.certificates c
    where c.child_id in (select private.child_ids_with_aliases(v_canon))
      and c.status in ('issued','revoked') and c.issued_at is not null);
end $$;
