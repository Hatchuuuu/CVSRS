-- 0017 Guardian certificates, in-app messages and the bounded outbox worker. Blueprint refs: BP20, BP22, F16, T23, T24.
--  * A certificate freezes an immutable snapshot of VERIFIED, ACTIVE clinical revisions; it is a separate lifecycle from the vaccination history.
--  * The document (PDF) is stored privately in the database (private.certificate_documents); reprints return the same bytes.
--  * The public verification token is random, only its hash is stored, and the public answer contains no name, birth date or dose list.
--  * A later correction of a fact the certificate shows flags it "under review"; the old snapshot is never rewritten.
--  * The outbox worker delivers in-app messages only. No SMS/e-mail provider is called anywhere (M09).

-- ---------------------------------------------------------------------------------------------
-- Certificates
-- ---------------------------------------------------------------------------------------------
create table private.certificate_counters (organization_id uuid primary key, next_value bigint not null default 1);

create function private.next_certificate_no(p_org uuid) returns text language plpgsql security definer set search_path = '' as $$
declare v bigint;
begin
  insert into private.certificate_counters (organization_id) values (p_org) on conflict (organization_id) do nothing;
  update private.certificate_counters set next_value = next_value + 1 where organization_id = p_org returning next_value - 1 into v;
  return 'CERT-' || lpad(v::text, 6, '0');
end $$;

create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  child_id uuid not null,
  certificate_no text not null,
  snapshot jsonb not null,
  content_hash text not null,
  verification_token_hash text,
  status text not null default 'pending' check (status in ('pending','issued','revoked')),
  review_needed boolean not null default false,
  issued_at timestamptz,
  issuer_id uuid not null references public.profiles (id),
  replaces_id uuid references public.certificates (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  revocation_reason text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  unique (organization_id, certificate_no),
  unique (verification_token_hash),
  unique (organization_id, id),
  check (status <> 'issued' or (issued_at is not null and verification_token_hash is not null)),
  check (status <> 'revoked' or (revoked_at is not null and revocation_reason is not null))
);
create index certificates_child_idx on public.certificates (child_id, status);
create unique index certificates_one_replacement_uq on public.certificates (replaces_id) where replaces_id is not null and status <> 'revoked';

create table public.certificate_items (
  certificate_id uuid not null references public.certificates (id),
  vaccination_revision_id uuid not null references public.vaccination_revisions (id),
  primary key (certificate_id, vaccination_revision_id)
);
create index certificate_items_revision_idx on public.certificate_items (vaccination_revision_id);

create table private.certificate_documents (
  certificate_id uuid primary key references public.certificates (id),
  pdf bytea not null check (length(pdf) between 100 and 2097152),
  sha256 text not null,
  stored_at timestamptz not null default now()
);

create function private.certificates_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'certificates cannot be deleted' using errcode = 'CV403'; end if;
  if new.snapshot is distinct from old.snapshot or new.content_hash is distinct from old.content_hash or new.child_id is distinct from old.child_id
     or new.clinic_id is distinct from old.clinic_id or new.certificate_no is distinct from old.certificate_no or new.issuer_id is distinct from old.issuer_id
     or new.replaces_id is distinct from old.replaces_id then
    raise exception 'an issued certificate snapshot is immutable' using errcode = 'CV403';
  end if;
  if old.status = 'revoked' and new.status <> 'revoked' then raise exception 'a revoked certificate stays revoked' using errcode = 'CV403'; end if;
  if old.status = 'issued' and new.status = 'pending' then raise exception 'an issued certificate cannot return to pending' using errcode = 'CV403'; end if;
  if old.status <> 'pending' and new.verification_token_hash is distinct from old.verification_token_hash then raise exception 'the verification token cannot change after issue' using errcode = 'CV403'; end if;
  return new;
end $$;
create trigger certificates_guard before update or delete on public.certificates for each row execute function private.certificates_guard();
create trigger certificates_no_truncate before truncate on public.certificates for each statement execute function private.forbid_change();
create trigger certificate_items_immutable before update or delete on public.certificate_items for each row execute function private.forbid_change();
create trigger certificate_items_no_truncate before truncate on public.certificate_items for each statement execute function private.forbid_change();
create trigger certificate_documents_immutable before update or delete on private.certificate_documents for each row execute function private.forbid_change();
create trigger certificate_documents_no_truncate before truncate on private.certificate_documents for each statement execute function private.forbid_change();

alter table public.certificates enable row level security;
alter table public.certificate_items enable row level security;
revoke all on public.certificates, public.certificate_items from anon, authenticated;

-- A correction to a fact the certificate shows (date, product, lot, child, voided) flags it for review; the snapshot is preserved (T23).
create function private.flag_certificates_for_review() returns trigger language plpgsql security definer set search_path = '' as $$
declare prev public.vaccination_revisions;
begin
  if new.revision_no < 2 then return new; end if;
  select * into prev from public.vaccination_revisions where event_id = new.event_id and revision_no = new.revision_no - 1;
  if prev.id is null then return new; end if;
  if prev.administered_on is distinct from new.administered_on or prev.product_id is distinct from new.product_id or prev.lot_id is distinct from new.lot_id
     or prev.child_id is distinct from new.child_id or prev.event_status is distinct from new.event_status or prev.verification_status is distinct from new.verification_status then
    update public.certificates c set review_needed = true
     where c.status = 'issued' and c.id in (select ci.certificate_id from public.certificate_items ci join public.vaccination_revisions r on r.id = ci.vaccination_revision_id where r.event_id = new.event_id);
  end if;
  return new;
end $$;
create trigger vaccination_revisions_flag_certificates after insert on public.vaccination_revisions for each row execute function private.flag_certificates_for_review();

create function private.certificate_json(c public.certificates, p_staff boolean) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', c.id, 'certificateNo', c.certificate_no, 'status', c.status, 'reviewNeeded', c.review_needed, 'issuedAt', c.issued_at,
           'replacesNo', (select r.certificate_no from public.certificates r where r.id = c.replaces_id),
           'entryCount', jsonb_array_length(c.snapshot -> 'entries'),
           'hasDocument', exists (select 1 from private.certificate_documents d where d.certificate_id = c.id))
         || case when p_staff then jsonb_build_object('revokedAt', c.revoked_at, 'revocationReason', c.revocation_reason, 'childId', c.child_id) else '{}'::jsonb end
$$;

-- ---------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------
create function public.issue_certificate(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_replaces_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; v_canon uuid; v_child public.children; v_clinic public.clinics; v_entries jsonb; v_snap jsonb; v_id uuid := gen_random_uuid(); v_no text; v_issuer text; old public.certificates;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'certificate.issue');
  v_prev := private.begin_command(v_org, p_operation_key, 'certificate.issue', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'rp', p_replaces_id));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then
    perform private.audit(v_org, 'certificate.issue', 'certificate.issue', 'child', p_child_id, null, null, null, 'denied');
    return null;
  end if;
  if p_replaces_id is not null then
    select * into old from public.certificates where id = p_replaces_id and organization_id = v_org and child_id in (select private.child_ids_with_aliases(v_canon)) for update;
    if old.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
    if old.status = 'pending' then raise exception 'a certificate that is still pending cannot be replaced' using errcode = 'CV409'; end if;
    if exists (select 1 from public.certificates x where x.replaces_id = old.id and x.status <> 'revoked') then raise exception 'a replacement for this certificate is already in progress' using errcode = 'CV409'; end if;
  end if;
  select * into v_child from public.children where id = v_canon;
  select * into v_clinic from public.clinics where id = p_clinic_id;
  select coalesce(jsonb_agg(jsonb_build_object(
           'eventId', cr.event_id, 'revisionId', cr.id, 'revisionNo', cr.revision_no, 'administeredOn', cr.administered_on, 'datePrecision', cr.date_precision,
           'product', coalesce(p.name, cr.reported_product_text),
           'source', case when cr.source = 'clinic_administered' then 'clinic' else 'recorded_elsewhere' end,
           'lot', case when cr.source = 'clinic_administered' then coalesce(l.manufacturer_lot, cr.reported_lot) else null end,
           'provider', case when cr.source = 'clinic_administered' then null else cr.external_vaccinator end)
         order by cr.administered_on, cr.created_at), '[]'::jsonb) into v_entries
    from private.current_revisions cr left join public.vaccine_products p on p.id = cr.product_id left join public.vaccine_lots l on l.id = cr.lot_id
   where cr.child_id in (select private.child_ids_with_aliases(v_canon)) and cr.event_status = 'active' and cr.verification_status = 'verified' and cr.administered_on is not null;
  if jsonb_array_length(v_entries) = 0 then raise exception 'there are no verified vaccinations to certify yet' using errcode = 'CV422'; end if;
  select display_name into v_issuer from public.profiles where id = auth.uid();
  v_no := private.next_certificate_no(v_org);
  v_snap := jsonb_build_object('version', 1, 'certificateNo', v_no,
    'clinic', jsonb_build_object('name', v_clinic.name, 'address', v_clinic.address, 'contact', v_clinic.contact_text, 'timezone', v_clinic.timezone),
    'child', jsonb_build_object('displayName', v_child.display_name, 'dob', v_child.dob, 'datePrecision', v_child.birth_date_precision, 'recordNo', v_child.local_record_no),
    'entries', v_entries, 'issuedBy', coalesce(nullif(v_issuer, ''), 'Clinic staff'), 'preparedAt', now());
  insert into public.certificates (id, organization_id, clinic_id, child_id, certificate_no, snapshot, content_hash, issuer_id, replaces_id)
  values (v_id, v_org, p_clinic_id, v_canon, v_no, v_snap, encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex'), auth.uid(), p_replaces_id);
  insert into public.certificate_items (certificate_id, vaccination_revision_id)
  select v_id, (e ->> 'revisionId')::uuid from jsonb_array_elements(v_entries) e;
  perform private.audit(v_org, 'certificate.issue', 'certificate.prepared', 'certificate', v_id, null, jsonb_build_object('no', v_no, 'entries', jsonb_array_length(v_entries), 'replaces', p_replaces_id), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('certificateId', v_id, 'certificateNo', v_no, 'status', 'pending'));
end $$;

-- Rotates the verification token of a PENDING certificate and returns it once, with the frozen snapshot, so the app can render the document.
-- The token is never written anywhere in clear text (not in the receipt either), which is why this is a separate, non-idempotent call.
create function public.begin_certificate_render(p_certificate_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.certificates; v_token text;
begin
  select * into c from public.certificates where id = p_certificate_id;
  if c.id is null or not private.has_capability(c.clinic_id, 'certificate.issue') then return null; end if;
  if c.status <> 'pending' then raise exception 'this certificate has already been issued' using errcode = 'CV409'; end if;
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  update public.certificates set verification_token_hash = encode(sha256(convert_to(v_token, 'UTF8')), 'hex') where id = c.id;
  return jsonb_build_object('certificateId', c.id, 'certificateNo', c.certificate_no, 'token', v_token, 'snapshot', c.snapshot, 'contentHash', c.content_hash);
end $$;

create function public.store_certificate_pdf(p_operation_key uuid, p_certificate_id uuid, p_pdf_base64 text, p_sha256 text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.certificates; v_prev jsonb; v_bytes bytea; old public.certificates; v_guardian record;
begin
  select * into c from public.certificates where id = p_certificate_id for update;
  if c.id is null or not private.has_capability(c.clinic_id, 'certificate.issue') then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(c.organization_id, p_operation_key, 'certificate.store', jsonb_build_object('c', p_certificate_id, 'h', p_sha256));
  if v_prev is not null then return v_prev; end if;
  if c.status <> 'pending' then raise exception 'this certificate has already been issued' using errcode = 'CV409'; end if;
  if c.verification_token_hash is null then raise exception 'start rendering first' using errcode = 'CV409'; end if;
  if p_pdf_base64 is null or length(p_pdf_base64) > 2800000 then raise exception 'the document is too large' using errcode = 'CV422'; end if;
  begin v_bytes := decode(p_pdf_base64, 'base64'); exception when others then raise exception 'the document is not valid' using errcode = 'CV422'; end;
  if convert_from(substring(v_bytes from 1 for 5), 'SQL_ASCII') <> '%PDF-' then raise exception 'the document is not a PDF' using errcode = 'CV422'; end if;
  if encode(sha256(v_bytes), 'hex') <> lower(coalesce(p_sha256, '')) then raise exception 'the document did not match its checksum' using errcode = 'CV422'; end if;
  insert into private.certificate_documents (certificate_id, pdf, sha256) values (c.id, v_bytes, lower(p_sha256));
  update public.certificates set status = 'issued', issued_at = now() where id = c.id;
  if c.replaces_id is not null then
    select * into old from public.certificates where id = c.replaces_id for update;
    if old.status <> 'revoked' then
      update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = 'Replaced by ' || c.certificate_no, review_needed = false where id = old.id;
      perform private.enqueue(c.organization_id, 'certificate.revoked', 'certificate', old.id, 'cert-revoked:' || old.id, jsonb_build_object('replacedBy', c.certificate_no));
    end if;
  end if;
  perform private.enqueue(c.organization_id, 'certificate.issued', 'certificate', c.id, 'cert-issued:' || c.id, '{}'::jsonb);
  perform private.audit(c.organization_id, 'certificate.issue', 'certificate.issued', 'certificate', c.id, jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'issued', 'sha256', lower(p_sha256)), null);
  return private.finish_command(c.organization_id, p_operation_key, jsonb_build_object('certificateId', c.id, 'certificateNo', c.certificate_no, 'status', 'issued'));
end $$;

create function public.revoke_certificate(p_operation_key uuid, p_clinic_id uuid, p_certificate_id uuid, p_reason text) returns jsonb
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
  if c.status = 'pending' then raise exception 'a pending certificate has nothing to revoke yet' using errcode = 'CV409'; end if;
  update public.certificates set status = 'revoked', revoked_at = now(), revoked_by = auth.uid(), revocation_reason = left(btrim(p_reason), 300), review_needed = false where id = c.id;
  perform private.enqueue(v_org, 'certificate.revoked', 'certificate', c.id, 'cert-revoked:' || c.id, '{}'::jsonb);
  perform private.audit(v_org, 'certificate.issue', 'certificate.revoked', 'certificate', c.id, jsonb_build_object('status', c.status), jsonb_build_object('status', 'revoked'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('certificateId', c.id, 'status', 'revoked'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------------------------
create function public.list_child_certificates(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  perform private.require_capability(p_clinic_id, 'certificate.issue');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  return (select coalesce(jsonb_agg(private.certificate_json(c, true) order by c.created_at desc), '[]'::jsonb) from public.certificates c where c.child_id in (select private.child_ids_with_aliases(v_canon)) and c.clinic_id = p_clinic_id);
end $$;

create function public.guardian_list_certificates(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  return (select coalesce(jsonb_agg(private.certificate_json(c, false) order by c.created_at desc), '[]'::jsonb) from public.certificates c where c.child_id in (select private.child_ids_with_aliases(v_canon)) and c.status in ('issued','revoked'));
end $$;

-- Same stored bytes every time (BP20 "reprints download the same issued document"). Guardians get only certificates that are currently issued.
create function public.get_certificate_pdf(p_certificate_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.certificates; d private.certificate_documents; v_staff boolean; v_guardian boolean;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into c from public.certificates where id = p_certificate_id;
  if c.id is null then return null; end if;
  v_staff := private.has_capability(c.clinic_id, 'certificate.issue');
  v_guardian := private.guardian_has_full_access(private.canonical_child(c.child_id)) and c.status = 'issued';
  if not (v_staff or v_guardian) then return null; end if;
  select * into d from private.certificate_documents where certificate_id = c.id;
  if d.certificate_id is null then return null; end if;
  perform private.audit(c.organization_id, case when v_staff then 'certificate.issue' else 'guardian' end, 'certificate.downloaded', 'certificate', c.id, null, null, null);
  return jsonb_build_object('certificateNo', c.certificate_no, 'status', c.status, 'sha256', d.sha256, 'pdfBase64', encode(d.pdf, 'base64'));
end $$;

-- Public: minimal authenticity result. Unknown, malformed and still-pending tokens all look the same (NULL -> not found).
create function public.verify_certificate(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.certificates; v_clinic text;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select * into c from public.certificates where verification_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex') and status in ('issued','revoked');
  if c.id is null then return null; end if;
  select name into v_clinic from public.clinics where id = c.clinic_id;
  return jsonb_build_object('status', case when c.status = 'revoked' then 'revoked' when c.review_needed then 'under_review' else 'valid' end,
                            'certificateNo', c.certificate_no, 'clinicName', v_clinic, 'issuedOn', (c.issued_at at time zone (select timezone from public.clinics where id = c.clinic_id))::date);
end $$;

-- ---------------------------------------------------------------------------------------------
-- In-app messages
-- ---------------------------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  recipient_profile_id uuid not null references public.profiles (id),
  child_id uuid,
  kind text not null check (length(kind) between 1 and 60),
  title text not null check (length(title) between 1 and 120),
  body text not null check (length(body) between 1 and 600),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (recipient_profile_id, dedupe_key)
);
create index messages_inbox_idx on public.messages (recipient_profile_id, created_at desc);
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;

create function public.my_messages(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then return null; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.messages where recipient_profile_id = auth.uid() and read_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'childId', x.child_id, 'createdAt', x.created_at, 'read', x.read_at is not null) order by x.created_at desc), '[]'::jsonb)
                from (select * from public.messages where recipient_profile_id = auth.uid() order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x));
end $$;

create function public.mark_messages_read(p_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then return null; end if;
  update public.messages set read_at = now() where recipient_profile_id = auth.uid() and read_at is null and (p_ids is null or id = any (p_ids));
  get diagnostics v_n = row_count;
  return jsonb_build_object('marked', v_n);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Outbox worker (private). Bounded, retrying, safe to run from several workers at once (SKIP LOCKED).
-- ---------------------------------------------------------------------------------------------
create function private.notify_guardians(p_org uuid, p_child uuid, p_kind text, p_title text, p_body text, p_dedupe text) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
  select distinct p_org, g.profile_id, private.canonical_child(p_child), p_kind, p_title, p_body, p_dedupe
    from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id
   where r.child_id = private.canonical_child(p_child) and r.status = 'active' and r.access_scope = 'full' and (r.ends_at is null or r.ends_at > now())
     and g.profile_id is not null and g.deleted_at is null
  on conflict (recipient_profile_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Returns 'done' or 'cancelled'; raising means "retry later". Message wording is fixed here and contains no clinical guidance.
create function private.handle_outbox_job(j private.outbox_jobs) returns text
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; s public.clinic_sessions; c public.certificates; v_child public.children; v_clinic public.clinics; v_when text; v_key text;
begin
  if j.job_type in ('appointment.confirmation','appointment.cancellation','appointment.session_cancelled') then
    select * into a from public.appointments where id = j.aggregate_id;
    if a.id is null then return 'cancelled'; end if;
    select * into s from public.clinic_sessions where id = a.session_id;
    select * into v_clinic from public.clinics where id = s.clinic_id;
    select * into v_child from public.children where id = a.child_id;
    v_when := to_char(s.starts_at at time zone v_clinic.timezone, 'FMDay, FMDD FMMonth YYYY "at" FMHH12:MI AM');
    if j.job_type = 'appointment.confirmation' then
      if a.status not in ('confirmed','checked_in','fulfilled') then return 'cancelled'; end if;
      perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', case when j.payload ? 'rescheduledFrom' then 'Visit rescheduled' else 'Visit booked' end,
        format('%s: %s at %s.', v_child.display_name, v_when, v_clinic.name), j.dedupe_key);
    elsif j.job_type = 'appointment.cancellation' then
      perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', 'Visit cancelled', format('The visit for %s on %s was cancelled.', v_child.display_name, v_when), j.dedupe_key);
    else
      perform private.notify_guardians(j.organization_id, a.child_id, 'appointment', 'Clinic session cancelled',
        format('The clinic session on %s was cancelled, so the visit for %s will not take place. Please book another time.', v_when, v_child.display_name), j.dedupe_key);
    end if;
    return 'done';
  elsif j.job_type = 'vaccination.recorded' then
    select * into v_child from public.children where id = (j.payload ->> 'childId')::uuid;
    if v_child.id is null then return 'cancelled'; end if;
    perform private.notify_guardians(j.organization_id, v_child.id, 'record', 'Vaccination recorded', format('A vaccination was recorded for %s. Open the record to see what was given.', v_child.display_name), j.dedupe_key);
    return 'done';
  elsif j.job_type in ('certificate.issued','certificate.revoked') then
    select * into c from public.certificates where id = j.aggregate_id;
    if c.id is null then return 'cancelled'; end if;
    select * into v_child from public.children where id = c.child_id;
    if j.job_type = 'certificate.issued' then
      perform private.notify_guardians(j.organization_id, c.child_id, 'certificate', 'Certificate ready', format('Certificate %s for %s is ready to download.', c.certificate_no, v_child.display_name), j.dedupe_key);
    else
      perform private.notify_guardians(j.organization_id, c.child_id, 'certificate', 'Certificate no longer valid',
        format('Certificate %s for %s is no longer valid.%s Please ask the clinic about a new one.', c.certificate_no, v_child.display_name, case when j.payload ? 'replacedBy' then ' It was replaced by ' || (j.payload ->> 'replacedBy') || '.' else '' end), j.dedupe_key);
    end if;
    return 'done';
  elsif j.job_type = 'certificate.review' then
    -- Notify only when a certificate that shows the corrected record has actually been flagged.
    for c in select x.* from public.certificates x where x.status = 'issued' and x.review_needed and x.id in
             (select ci.certificate_id from public.certificate_items ci join public.vaccination_revisions r on r.id = ci.vaccination_revision_id where r.event_id = j.aggregate_id) loop
      select * into v_child from public.children where id = c.child_id;
      perform private.notify_guardians(j.organization_id, c.child_id, 'certificate', 'Certificate under review',
        format('A record shown on certificate %s for %s was corrected. The clinic is reviewing the certificate.', c.certificate_no, v_child.display_name), 'cert-review:' || c.id || ':' || j.dedupe_key);
    end loop;
    return 'done';
  end if;
  raise exception 'no handler for job type' using errcode = 'CV422';
end $$;

create function private.process_outbox(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j private.outbox_jobs; v_res text; v_done integer := 0; v_cancelled integer := 0; v_retry integer := 0; v_failed integer := 0; v_code text;
begin
  for j in select * from private.outbox_jobs
            where (status = 'queued' and available_at <= now()) or (status = 'processing' and locked_until < now())
            order by available_at, created_at limit least(greatest(coalesce(p_limit, 20), 1), 200) for update skip locked loop
    begin
      v_res := private.handle_outbox_job(j);
      update private.outbox_jobs set status = case when v_res = 'cancelled' then 'cancelled' else 'done' end, attempt_count = attempt_count + 1, locked_until = null, last_error_code = null, updated_at = now() where id = j.id;
      if v_res = 'cancelled' then v_cancelled := v_cancelled + 1; else v_done := v_done + 1; end if;
    exception when others then
      get stacked diagnostics v_code = returned_sqlstate;
      if j.attempt_count + 1 >= 5 or v_code = 'CV422' then
        update private.outbox_jobs set status = 'failed', attempt_count = attempt_count + 1, last_error_code = v_code, locked_until = null, updated_at = now() where id = j.id;
        v_failed := v_failed + 1;
      else
        update private.outbox_jobs set status = 'queued', attempt_count = attempt_count + 1, last_error_code = v_code, locked_until = null,
               available_at = now() + make_interval(mins => power(2, j.attempt_count)::int), updated_at = now() where id = j.id;
        v_retry := v_retry + 1;
      end if;
    end;
  end loop;
  return jsonb_build_object('done', v_done, 'cancelled', v_cancelled, 'retry', v_retry, 'failed', v_failed);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------------------------
revoke all on function private.next_certificate_no(uuid), private.certificates_guard(), private.flag_certificates_for_review(), private.certificate_json(public.certificates, boolean),
  private.notify_guardians(uuid, uuid, text, text, text, text), private.handle_outbox_job(private.outbox_jobs), private.process_outbox(integer) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'issue_certificate(uuid,uuid,uuid,uuid)', 'begin_certificate_render(uuid)', 'store_certificate_pdf(uuid,uuid,text,text)', 'revoke_certificate(uuid,uuid,uuid,text)',
    'list_child_certificates(uuid,uuid)', 'guardian_list_certificates(uuid)', 'get_certificate_pdf(uuid)', 'my_messages(integer)', 'mark_messages_read(uuid[])'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  revoke all on function public.verify_certificate(text) from public, anon, authenticated;
  grant execute on function public.verify_certificate(text) to anon, authenticated;
end $$;
