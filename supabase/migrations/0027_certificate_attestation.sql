-- Bind each stored PDF to the frozen snapshot and the latest render token. Provision
-- the matching application/DB secret outside migrations; an absent secret fails closed.
create table private.certificate_render_secrets (
  id boolean primary key default true check (id),
  secret text not null check (length(secret) >= 32)
);
revoke all on private.certificate_render_secrets from public, anon, authenticated, service_role;

create or replace function public.begin_certificate_render(p_certificate_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.certificates; v_token text; v_hash text;
begin
  select * into c from public.certificates where id = p_certificate_id for update;
  if c.id is null or not private.has_capability(c.clinic_id, 'certificate.issue') then return null; end if;
  if c.status <> 'pending' then raise exception 'this certificate has already been issued' using errcode = 'CV409'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_hash := encode(sha256(convert_to(v_token, 'UTF8')), 'hex');
  update public.certificates set verification_token_hash = v_hash where id = c.id;
  return jsonb_build_object('certificateId', c.id, 'certificateNo', c.certificate_no, 'token', v_token,
    'snapshot', c.snapshot, 'contentHash', c.content_hash, 'tokenHash', v_hash);
end $$;

drop function public.store_certificate_pdf(uuid, uuid, text, text);

create function public.store_certificate_pdf(
  p_operation_key uuid, p_certificate_id uuid, p_content_hash text, p_token_hash text,
  p_pdf_base64 text, p_sha256 text, p_attestation text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.certificates; v_prev jsonb; v_bytes bytea; old public.certificates;
  v_secret text; v_expected text; v_hash text := lower(p_sha256);
begin
  select * into c from public.certificates where id = p_certificate_id for update;
  if c.id is null or not private.has_capability(c.clinic_id, 'certificate.issue') then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(c.organization_id, p_operation_key, 'certificate.store',
    jsonb_build_object('c', p_certificate_id, 'content', p_content_hash, 'token', p_token_hash, 'pdf', v_hash));
  if v_prev is not null then return v_prev; end if;
  if c.status <> 'pending' then raise exception 'this certificate has already been issued' using errcode = 'CV409'; end if;
  if c.verification_token_hash is null then raise exception 'start rendering first' using errcode = 'CV409'; end if;
  if p_content_hash is distinct from c.content_hash or p_token_hash is distinct from c.verification_token_hash then
    raise exception 'this rendering was superseded' using errcode = 'CV409';
  end if;
  select secret into v_secret from private.certificate_render_secrets where id = true;
  if v_secret is null or length(v_secret) < 32 then raise exception 'certificate renderer is not configured' using errcode = 'CV503'; end if;
  if p_pdf_base64 is null or length(p_pdf_base64) > 2800000 then raise exception 'the document is too large' using errcode = 'CV422'; end if;
  begin v_bytes := decode(p_pdf_base64, 'base64'); exception when others then raise exception 'the document is not valid' using errcode = 'CV422'; end;
  if convert_from(substring(v_bytes from 1 for 5), 'SQL_ASCII') <> '%PDF-' then raise exception 'the document is not a PDF' using errcode = 'CV422'; end if;
  if encode(sha256(v_bytes), 'hex') <> coalesce(v_hash, '') then raise exception 'the document did not match its checksum' using errcode = 'CV422'; end if;
  v_expected := encode(extensions.hmac(convert_to(c.id::text || ':' || c.content_hash || ':' || c.verification_token_hash || ':' || v_hash, 'UTF8'),
    convert_to(v_secret, 'UTF8'), 'sha256'), 'hex');
  if p_attestation is null or p_attestation !~ '^[0-9a-f]{64}$' or p_attestation <> v_expected then
    raise exception 'certificate render attestation rejected' using errcode = 'CV403';
  end if;
  insert into private.certificate_documents (certificate_id, pdf, sha256) values (c.id, v_bytes, v_hash);
  update public.certificates set status = 'issued', issued_at = now() where id = c.id;
  if c.replaces_id is not null then
    select * into old from public.certificates where id = c.replaces_id for update;
    if old.status <> 'revoked' then
      update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(),
        revocation_reason = 'Replaced by ' || c.certificate_no, review_needed = false where id = old.id;
      perform private.enqueue(c.organization_id, 'certificate.revoked', 'certificate', old.id, 'cert-revoked:' || old.id,
        jsonb_build_object('replacedBy', c.certificate_no));
    end if;
  end if;
  perform private.enqueue(c.organization_id, 'certificate.issued', 'certificate', c.id, 'cert-issued:' || c.id, '{}'::jsonb);
  perform private.audit(c.organization_id, 'certificate.issue', 'certificate.issued', 'certificate', c.id,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'issued', 'sha256', v_hash), null);
  return private.finish_command(c.organization_id, p_operation_key,
    jsonb_build_object('certificateId', c.id, 'certificateNo', c.certificate_no, 'status', 'issued'));
end $$;
revoke all on function public.store_certificate_pdf(uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.store_certificate_pdf(uuid, uuid, text, text, text, text, text) to authenticated;
