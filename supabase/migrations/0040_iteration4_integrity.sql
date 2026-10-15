-- 0040 Iteration-4 integrity fixes (docs/engineering/audit.md "Iteration 4").
--
--  I4-03 A revoke that would leave a health center unable to grant staff access is refused (CV409, hint
--        cvsrs:last_access_holder). Granting needs two DIFFERENT people (0002): one files the request (admin.users or
--        grant.approve.clinical) and another approves it (admin.users for a non-clinical grant, grant.approve.clinical for a
--        clinical one). The revoke is refused when that is possible for either kind of grant before it and not after it; a
--        health center that already cannot grant is not made worse, so its revokes are not refused. Revokes at one health center
--        are serialized so that two concurrent revokes cannot together break it.
--  I4-04 Least privilege: acknowledge_privacy_notice (superseded by acknowledge_clinic_privacy_notice, 0022/0034) and
--        record_report_export (superseded by the p_export flag of the report functions, 0026) are no longer executable by API
--        roles (anon, authenticated, service_role). Both remain as definitions only; nothing in the application or the database
--        calls them.
--  I4-05 The duplicate-session booking conflict carries a stable hint (cvsrs:duplicate_session_booking), so the application no
--        longer matches the message text. Only the RAISE changes; the bodies are 0013's, reproduced verbatim (0025 renamed them
--        to *_prev and wraps them; grants and ownership are kept by CREATE OR REPLACE).
--  I4-12 list_review_cases and my_messages break created_at ties by id, so rows created in one transaction keep one order and
--        the same rows fall inside the limit on every call.
--  I4-18 private.restore_clinic_approver: a database-owner-only break-glass that gives one confirmed account the tech_admin or
--        clinical_lead role at a health center that can no longer grant that kind of access (and only then). Adds
--        staff_memberships.operator_restored_at, which the two-person check accepts in place of an approver.
--  QA-02 update_session_capacity says "1 family is already booked" instead of "1 families are already booked".
--  QA-03 private.add_clinic: a database-owner-only command that adds another health center to an existing organization
--        (record and stock transfers need a second clinic); its first staff are seeded with private.restore_clinic_approver.
--
-- Conventions as in 0001: SECURITY DEFINER with an empty search_path, idempotent commands keyed by p_operation_key, stable
-- SQLSTATEs (CV4xx), explicit grants. Rollback: re-run the previous definitions (0002 revoke_staff_membership, 0013 bodies, 0016
-- list_review_cases, 0017 my_messages) and re-grant the two superseded functions to authenticated only if they are needed again.
-- The service_role revoke on them is intended to stay: nothing uses service_role for them (or at all in src/).
-- I4-18 rollback: drop private.restore_clinic_approver; restoring the original check (status <> 'active' or approved_by is not
-- null) needs every operator-restored active membership approved or revoked first; then drop operator_restored_at.

-- ---------------------------------------------------------------------------------------------
-- I4-03 Access-granting guard on revoke_staff_membership
-- ---------------------------------------------------------------------------------------------
-- A membership that currently gives p_cap to its holder, by the same rule as private.has_capability (active, inside its validity
-- window, role preset or explicit capability) and only for a person whose account is active.
create function private.membership_holds(p_membership_id uuid, p_cap text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.staff_memberships m
      join public.profiles p on p.id = m.profile_id
     where m.id = p_membership_id
       and m.status = 'active' and p.status = 'active'
       and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
       and (p_cap = any (private.role_preset(m.role_code)) or p_cap = any (m.capabilities))
  )
$$;

-- Whether the health center can still grant access of one kind without membership p_except (null: as it is now): some person can
-- approve it (p_approver_cap) and a DIFFERENT person can request it (0002: request needs admin.users or grant.approve.clinical;
-- approve needs p_approver_cap, an approver other than the requester and the grantee). Capabilities are combined per person
-- across their memberships, counting only active memberships of active accounts inside their validity window, as in
-- private.has_capability.
create function private.clinic_can_grant(p_clinic uuid, p_approver_cap text, p_except uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  with people as (
    select m.profile_id,
           bool_or(p_approver_cap = any (private.role_preset(m.role_code)) or p_approver_cap = any (m.capabilities)) as can_approve,
           bool_or(array['admin.users','grant.approve.clinical'] && (private.role_preset(m.role_code) || m.capabilities)) as can_request
      from public.staff_memberships m
      join public.profiles p on p.id = m.profile_id
     where m.clinic_id = p_clinic and (p_except is null or m.id <> p_except)
       and m.status = 'active' and p.status = 'active'
       and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
     group by m.profile_id
  )
  select exists (
    select 1 from people approver join people requester on requester.profile_id <> approver.profile_id
     where approver.can_approve and requester.can_request
  )
$$;

create or replace function public.revoke_staff_membership(p_operation_key uuid, p_membership_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  m public.staff_memberships;
  v_prev jsonb;
  v_needed text;
  v_staff_breaks boolean;
  v_clinical_breaks boolean;
begin
  select * into m from public.staff_memberships where id = p_membership_id;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_needed := case when private.membership_is_clinical(m.role_code, m.capabilities) then 'grant.approve.clinical' else 'admin.users' end;
  if not private.has_capability(m.clinic_id, v_needed) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  -- One revoke at a time per health center, always clinic row first and membership row second (a fixed order, so no deadlock).
  -- Two administrators revoking each other therefore run one after the other, and the second one sees the first one's result.
  -- NO KEY UPDATE does not block inserts that reference the clinic (they take KEY SHARE).
  perform 1 from public.clinics where id = m.clinic_id for no key update;
  select * into m from public.staff_memberships where id = p_membership_id for update;
  -- Checked again after the wait: the caller's own access may have been revoked meanwhile.
  if not private.has_capability(m.clinic_id, v_needed) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(m.organization_id, p_operation_key, 'staff_membership.revoke',
                                  jsonb_build_object('membership', p_membership_id, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  if m.status not in ('active','pending_approval','suspended') then raise exception 'already closed' using errcode = 'CV409'; end if;
  -- A membership that holds neither capability (including every pending or suspended one) cannot change who can grant access.
  if private.membership_holds(m.id, 'admin.users') or private.membership_holds(m.id, 'grant.approve.clinical') then
    v_staff_breaks := private.clinic_can_grant(m.clinic_id, 'admin.users', null) and not private.clinic_can_grant(m.clinic_id, 'admin.users', m.id);
    v_clinical_breaks := private.clinic_can_grant(m.clinic_id, 'grant.approve.clinical', null) and not private.clinic_can_grant(m.clinic_id, 'grant.approve.clinical', m.id);
    -- When both would break, name the kind of approval this membership gives (a clinical approver hears about clinical access).
    if v_clinical_breaks and (not v_staff_breaks or private.membership_holds(m.id, 'grant.approve.clinical')) then
      raise exception 'Revoking this access would leave this health center without two different people who can request and approve clinical access. Approve a replacement clinical approver first, then revoke this access.'
        using errcode = 'CV409', hint = 'cvsrs:last_access_holder';
    elsif v_staff_breaks then
      raise exception 'Revoking this access would leave this health center without two different people who can request and approve staff access. Approve a replacement access administrator first, then revoke this access.'
        using errcode = 'CV409', hint = 'cvsrs:last_access_holder';
    end if;
  end if;
  update public.staff_memberships set status = 'revoked', updated_by = auth.uid() where id = m.id;
  perform private.audit(m.organization_id, v_needed, 'staff_membership.revoked', 'staff_membership', m.id,
                        jsonb_build_object('status', m.status), jsonb_build_object('status', 'revoked'), p_reason);
  return private.finish_command(m.organization_id, p_operation_key, jsonb_build_object('membershipId', m.id, 'status', 'revoked'));
end $$;

revoke all on function private.membership_holds(uuid, text), private.clinic_can_grant(uuid, text, uuid) from public, anon, authenticated;
-- CREATE OR REPLACE keeps 0002's grants; restated so the intended ACL is visible here.
revoke all on function public.revoke_staff_membership(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.revoke_staff_membership(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- I4-04 Superseded commands are no longer executable by API roles
-- ---------------------------------------------------------------------------------------------
revoke all on function public.acknowledge_privacy_notice(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.record_report_export(uuid, uuid, text, date, date) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- I4-05 Stable hint on the duplicate-session booking conflict (bodies verbatim from 0013 except the RAISE)
-- ---------------------------------------------------------------------------------------------
create or replace function public.book_appointment_prev(p_operation_key uuid, p_child_id uuid, p_session_id uuid, p_reason text default null, p_rule_codes text[] default '{}') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_canon uuid; s public.clinic_sessions; v_channel text; v_prev jsonb; v_id uuid; c public.children; v_ver uuid; v_code text; v_rule uuid; a public.appointments;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  -- Lock the session row first: this serialises every booking, cancellation and move touching this session.
  select * into s from public.clinic_sessions where id = p_session_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_channel := private.can_book_for(v_canon, s.clinic_id);
  if v_channel is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(s.organization_id, p_operation_key, 'appointment.book', jsonb_build_object('child', p_child_id, 'session', p_session_id, 'reason', p_reason, 'rules', to_jsonb(coalesce(p_rule_codes, '{}'))));
  if v_prev is not null then return v_prev; end if;
  select * into c from public.children where id = v_canon;
  if c.record_status not in ('provisional','active') then raise exception 'record is not open for booking' using errcode = 'CV409'; end if;
  if s.status <> 'open' or s.ends_at <= now() then raise exception 'this session is not open for booking' using errcode = 'CV409'; end if;
  if exists (select 1 from public.appointments where child_id = v_canon and session_id = s.id and status in ('confirmed','checked_in','fulfilled')) then
    raise exception 'this child already has an appointment in this session' using errcode = 'CV409', hint = 'cvsrs:duplicate_session_booking';
  end if;
  if private.session_booked(s.id) >= s.online_capacity then raise exception 'this session is full' using errcode = 'CV409'; end if;

  insert into public.appointments (organization_id, child_id, session_id, booked_by, channel, reason, created_by, updated_by)
  values (s.organization_id, v_canon, s.id, auth.uid(), v_channel, left(p_reason, 300), auth.uid(), auth.uid()) returning id into v_id;

  -- Optional: which schedule requirements this visit is for. Must exist in the version in force; never implies clearance.
  if coalesce(array_length(p_rule_codes, 1), 0) > 0 then
    v_ver := private.active_schedule_for(s.organization_id, 'routine', c.dob, s.service_date);
    if v_ver is null then raise exception 'no approved schedule is in force for those requirements' using errcode = 'CV422'; end if;
    foreach v_code in array p_rule_codes loop
      select id into v_rule from public.schedule_rules where schedule_version_id = v_ver and requirement_code = v_code;
      if v_rule is null then raise exception 'unknown requirement %', v_code using errcode = 'CV422'; end if;
      insert into public.appointment_items (organization_id, appointment_id, rule_id) values (s.organization_id, v_id, v_rule) on conflict do nothing;
    end loop;
  end if;
  perform private.enqueue(s.organization_id, 'appointment.confirmation', 'appointment', v_id, 'appt-confirm:' || v_id, jsonb_build_object('sessionId', s.id));
  perform private.audit(s.organization_id, case when v_channel = 'online' then 'guardian' else 'appointment.manage' end, 'appointment.booked', 'appointment', v_id, null,
                        jsonb_build_object('session', s.id, 'channel', v_channel), p_reason);
  select * into a from public.appointments where id = v_id;
  return private.finish_command(s.organization_id, p_operation_key, private.appointment_json(a, s));
end $$;

-- Atomic move: if the new session cannot take the child, the original booking is untouched (BP17).
create or replace function public.reschedule_appointment_prev(p_operation_key uuid, p_appointment_id uuid, p_new_session_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a public.appointments; so public.clinic_sessions; sn public.clinic_sessions; v_prev jsonb; v_channel text; v_new uuid; a2 public.appointments;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select a0.* into a from public.appointments a0 where a0.id = p_appointment_id;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  -- lock both sessions in a stable id order to avoid deadlocks between opposite moves
  perform 1 from public.clinic_sessions where id in (a.session_id, p_new_session_id) order by id for update;
  select * into so from public.clinic_sessions where id = a.session_id;
  select * into sn from public.clinic_sessions where id = p_new_session_id;
  if sn.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  select * into a from public.appointments where id = p_appointment_id for update;
  v_channel := private.can_book_for(a.child_id, so.clinic_id);
  if v_channel is null or sn.clinic_id <> so.clinic_id then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(a.organization_id, p_operation_key, 'appointment.reschedule', jsonb_build_object('a', p_appointment_id, 'n', p_new_session_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if a.status <> 'confirmed' then raise exception 'only a confirmed appointment can be moved' using errcode = 'CV409'; end if;
  if sn.id = so.id then raise exception 'choose a different session' using errcode = 'CV422'; end if;
  if sn.status <> 'open' or sn.ends_at <= now() then raise exception 'that session is not open for booking' using errcode = 'CV409'; end if;
  if exists (select 1 from public.appointments where child_id = a.child_id and session_id = sn.id and status in ('confirmed','checked_in','fulfilled')) then raise exception 'this child already has an appointment in that session' using errcode = 'CV409', hint = 'cvsrs:duplicate_session_booking'; end if;
  if private.session_booked(sn.id) >= sn.online_capacity then raise exception 'that session is full' using errcode = 'CV409'; end if;
  update public.appointments set status = 'rescheduled', updated_by = auth.uid() where id = a.id;
  insert into public.appointments (organization_id, child_id, session_id, booked_by, channel, reason, replaces_id, created_by, updated_by)
  values (a.organization_id, a.child_id, sn.id, auth.uid(), v_channel, coalesce(left(p_reason, 300), a.reason), a.id, auth.uid(), auth.uid()) returning id into v_new;
  insert into public.appointment_items (organization_id, appointment_id, rule_id, purpose) select organization_id, v_new, rule_id, purpose from public.appointment_items where appointment_id = a.id;
  update private.outbox_jobs set status = 'cancelled', updated_at = now() where organization_id = a.organization_id and status = 'queued' and (dedupe_key like 'appt-remind:' || a.id || '%' or dedupe_key = 'appt-confirm:' || a.id);
  perform private.enqueue(a.organization_id, 'appointment.confirmation', 'appointment', v_new, 'appt-confirm:' || v_new, jsonb_build_object('sessionId', sn.id, 'rescheduledFrom', a.id));
  perform private.audit(a.organization_id, case when v_channel = 'online' then 'guardian' else 'appointment.manage' end, 'appointment.rescheduled', 'appointment', v_new,
                        jsonb_build_object('from', a.id, 'session', so.id), jsonb_build_object('session', sn.id), p_reason);
  select * into a2 from public.appointments where id = v_new;
  return private.finish_command(a.organization_id, p_operation_key, private.appointment_json(a2, sn) || jsonb_build_object('replaces', a.id));
end $$;

revoke all on function public.book_appointment_prev(uuid, uuid, uuid, text, text[]), public.reschedule_appointment_prev(uuid, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- I4-12 Deterministic ordering for rows created in one transaction (created_at = now() is equal for all of them)
-- ---------------------------------------------------------------------------------------------
-- cancel_session opens one review case per booking and one outbox run writes many messages, all with the same created_at. The id
-- breaks the tie, so the order and the rows inside the limit are the same on every call. Bodies are 0016's and 0017's except the
-- ORDER BY clauses (list_review_cases now aggregates by the row's own columns instead of the createdAt text).
create or replace function public.list_review_cases(p_clinic_id uuid, p_status text default 'open', p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if not (private.has_capability(p_clinic_id, 'guardian.verify') or private.has_capability(p_clinic_id, 'review.resolve') or private.has_capability(p_clinic_id, 'correction.approve')
          or private.has_capability(p_clinic_id, 'inventory.approve')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  select coalesce(jsonb_agg(s.x order by s.sort_at, s.sort_id), '[]'::jsonb) into v_res from (
    select jsonb_build_object('caseId', k.id, 'kind', k.kind, 'status', k.status, 'reason', k.reason, 'createdAt', k.created_at, 'version', k.version,
             'evidence', k.evidence, 'childId', k.child_id, 'candidateChildId', k.candidate_child_id, 'eventId', k.vaccination_event_id, 'createdBy', k.created_by,
             'child', (select jsonb_build_object('displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob) from public.children c where c.id = k.child_id),
             'candidate', (select jsonb_build_object('displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob) from public.children c where c.id = k.candidate_child_id
                             and private.child_in_clinic(c.id, p_clinic_id)),
             'guardianName', (select g.full_name from public.guardians g where g.id = k.guardian_id)) x,
           k.created_at as sort_at, k.id as sort_id
      from public.record_review_cases k
     where k.clinic_id = p_clinic_id and k.status = p_status
     order by k.created_at, k.id limit least(greatest(coalesce(p_limit, 50), 1), 100)) s;
  return v_res;
end $$;

create or replace function public.my_messages(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not private.session_ok() then return null; end if;
  return jsonb_build_object(
    'unread', (select count(*) from public.messages where recipient_profile_id = auth.uid() and read_at is null),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'title', x.title, 'body', x.body, 'childId', x.child_id, 'createdAt', x.created_at, 'read', x.read_at is not null) order by x.created_at desc, x.id desc), '[]'::jsonb)
                from (select * from public.messages where recipient_profile_id = auth.uid() order by created_at desc, id desc limit least(greatest(coalesce(p_limit, 50), 1), 100)) x));
end $$;

-- CREATE OR REPLACE keeps the grants of 0016/0017; restated so the intended ACL is visible here.
revoke all on function public.list_review_cases(uuid, text, integer), public.my_messages(integer) from public, anon, authenticated;
grant execute on function public.list_review_cases(uuid, text, integer), public.my_messages(integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- I4-18 Operator break-glass: restore an approver at a health center that can no longer grant access
-- ---------------------------------------------------------------------------------------------
-- The revoke guard (I4-03) cannot stop an operator suspending an account, nor a membership expiring. When a health center then
-- has no two different people who can request and approve a kind of access, the in-app two-person path is closed for good.
-- private.restore_clinic_approver lets the DATABASE OWNER (same execution model as private.bootstrap_initial_staff, 0034/0039)
-- give one confirmed, active account the role that reopens that path, and only then: it refuses whenever the path still works.
--
-- A restored membership has no approver (nobody at the health center could approve it), so it is marked by
-- operator_restored_at instead; the two-person check on active memberships accepts either an approver or that marker.
-- Existing rows: an active, currently valid membership of that person with that role is refused (CV409). A pending request or
-- an active-but-expired membership with that role (at most one, staff_memberships_one_live_uq) is reused and made active
-- without an end date; revoked, rejected and suspended rows are never reactivated, they stay as history and a new row is added.
alter table public.staff_memberships add column operator_restored_at timestamptz;

do $$
declare v_name text;
begin
  select c.conname into v_name
    from pg_catalog.pg_constraint c
   where c.conrelid = 'public.staff_memberships'::regclass and c.contype = 'c'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%status <> ''active''%'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%approved_by IS NOT NULL%';
  if v_name is null then raise exception '0040: the two-person check on public.staff_memberships was not found'; end if;
  execute pg_catalog.format('alter table public.staff_memberships drop constraint %I', v_name);
end $$;
alter table public.staff_memberships add constraint staff_memberships_active_approved_check
  check (status <> 'active' or approved_by is not null or operator_restored_at is not null);

create function private.restore_clinic_approver(p_clinic_id uuid, p_email text, p_role text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.clinics; v_email text := lower(btrim(coalesce(p_email, ''))); v_reason text := btrim(coalesce(p_reason, ''));
  v_cap text; v_profile uuid; m public.staff_memberships; v_id uuid;
begin
  if p_role is null or p_role not in ('tech_admin','clinical_lead') then
    raise exception 'restore a tech_admin (staff access) or a clinical_lead (clinical access)' using errcode = 'CV422';
  end if;
  if length(v_reason) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = 'CV422'; end if;
  -- Same order as revoke_staff_membership: the clinic row first, so restores and revokes at one health center run one at a time.
  select * into c from public.clinics where id = p_clinic_id for no key update;
  if c.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if c.status <> 'active' then raise exception 'this health center is not active' using errcode = 'CV409'; end if;
  v_cap := case p_role when 'tech_admin' then 'admin.users' else 'grant.approve.clinical' end;
  if private.clinic_can_grant(c.id, v_cap, null) then
    raise exception 'this health center can still approve access through the app; use the normal two-person request' using errcode = 'CV409';
  end if;
  select p.id into v_profile from auth.users u join public.profiles p on p.id = u.id where lower(u.email) = v_email and p.status = 'active';
  if v_profile is null then raise exception 'no active account uses that email address' using errcode = 'CV422'; end if;
  -- As in 0039: Supabase records confirmation in auth.users.email_confirmed_at (read through to_jsonb so this compiles on the
  -- local test bootstrap, whose auth.users has no such column).
  if exists (select 1 from auth.users u where u.id = v_profile and to_jsonb(u) ? 'email_confirmed_at' and (to_jsonb(u) ->> 'email_confirmed_at') is null) then
    raise exception 'the person must confirm their email address first' using errcode = 'CV422';
  end if;
  select * into m from public.staff_memberships
   where profile_id = v_profile and clinic_id = c.id and role_code = p_role and status in ('pending_approval','active') for update;
  if m.id is not null and m.status = 'active' and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now()) then
    raise exception 'this person already holds that role at this health center' using errcode = 'CV409';
  end if;
  if m.id is not null then
    update public.staff_memberships
       set status = 'active', valid_from = now(), valid_until = null, operator_restored_at = now(), updated_by = null
     where id = m.id returning id into v_id;
  else
    insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, operator_restored_at)
    values (c.organization_id, v_profile, c.id, p_role, 'active', now()) returning id into v_id;
  end if;
  perform private.audit(c.organization_id, null, 'staff_membership.restored_by_operator', 'staff_membership', v_id,
                        case when m.id is null then null else jsonb_build_object('status', m.status, 'validUntil', m.valid_until) end,
                        jsonb_build_object('clinic', c.id, 'profile', v_profile, 'role', p_role, 'status', 'active',
                                           'emailDomain', split_part(v_email, '@', 2), 'dbUser', session_user::text,
                                           'reusedMembership', m.id is not null),
                        v_reason);
  return jsonb_build_object('membershipId', v_id, 'role', p_role, 'clinicId', c.id);
end $$;

revoke all on function private.restore_clinic_approver(uuid, text, text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- QA-02 Plain singular wording in the capacity conflict ("1 family is already booked"); body is 0037's except that RAISE
-- ---------------------------------------------------------------------------------------------
create or replace function public.update_session_capacity(p_operation_key uuid, p_clinic_id uuid, p_session_id uuid, p_expected_version integer,
                                               p_total integer, p_online integer, p_walkin integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; s public.clinic_sessions; v_booked int;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'appointment.manage');
  v_prev := private.begin_command(v_org, p_operation_key, 'session.capacity',
    jsonb_build_object('c', p_clinic_id, 's', p_session_id, 'v', p_expected_version, 't', p_total, 'o', p_online, 'w', p_walkin));
  if v_prev is not null then return v_prev; end if;
  select * into s from public.clinic_sessions where id = p_session_id and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if s.version <> p_expected_version then raise exception 'the session changed; reload and try again' using errcode = 'CV409'; end if;
  if s.status <> 'open' or s.ends_at <= now() then raise exception 'only an open, upcoming session can be changed' using errcode = 'CV409'; end if;
  if p_total is null or p_online is null or p_walkin is null or p_total < 0 or p_online < 0 or p_walkin < 0 or p_online + p_walkin > p_total then
    raise exception 'online plus walk-in capacity cannot exceed total capacity' using errcode = 'CV422';
  end if;
  v_booked := private.session_booked(s.id);
  if p_online < v_booked then
    raise exception '%', case when v_booked = 1 then '1 family is already booked' else v_booked || ' families are already booked' end || '; bookable places cannot go below that' using errcode = 'CV409';
  end if;
  update public.clinic_sessions set total_capacity = p_total, online_capacity = p_online, walkin_capacity = p_walkin, updated_by = auth.uid() where id = s.id;
  perform private.audit(v_org, 'appointment.manage', 'session.capacity_changed', 'clinic_session', s.id,
    jsonb_build_object('total', s.total_capacity, 'online', s.online_capacity, 'walkin', s.walkin_capacity),
    jsonb_build_object('total', p_total, 'online', p_online, 'walkin', p_walkin), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('sessionId', s.id, 'booked', v_booked));
end $$;


-- CREATE OR REPLACE keeps 0037's grants; restated so the intended ACL is visible here.
revoke all on function public.update_session_capacity(uuid, uuid, uuid, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.update_session_capacity(uuid, uuid, uuid, integer, integer, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- QA-03 Operator command to add another health center to an existing organization
-- ---------------------------------------------------------------------------------------------
-- Until now the only supported clinic insert was the one-time bootstrap (0034/0039), so record transfers and inter-clinic stock
-- transfers had no second clinic to use. Database owner only, like private.bootstrap_initial_staff: the same columns and
-- defaults as its clinic insert (name trimmed, timezone defaulting to Asia/Manila, status active by default). The new clinic has
-- no staff; its first access administrator and clinical lead are seeded with private.restore_clinic_approver (a clinic with no
-- memberships cannot grant either kind of access), after which the normal two-person commands apply.
create function private.add_clinic(p_organization_id uuid, p_name text, p_timezone text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o public.organizations; v_name text := btrim(coalesce(p_name, '')); v_tz text := coalesce(nullif(btrim(coalesce(p_timezone, '')), ''), 'Asia/Manila');
  v_reason text := btrim(coalesce(p_reason, '')); v_clinic uuid;
begin
  if length(v_reason) < 10 then raise exception 'give a reason of at least 10 characters' using errcode = 'CV422'; end if;
  -- One add at a time per organization, so two concurrent adds cannot both pass the name check. NO KEY UPDATE does not block
  -- inserts that reference the organization (they take KEY SHARE).
  select * into o from public.organizations where id = p_organization_id for no key update;
  if o.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if o.status <> 'active' then raise exception 'this organization is not active' using errcode = 'CV409'; end if;
  if length(v_name) < 3 or length(v_name) > 120 then raise exception 'name the health center (3 to 120 characters)' using errcode = 'CV422'; end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_tz) then
    raise exception 'choose a valid time zone name (for example Asia/Manila)' using errcode = 'CV422';
  end if;
  if exists (select 1 from public.clinics c where c.organization_id = o.id and lower(btrim(c.name)) = lower(v_name)) then
    raise exception 'this organization already has a health center with that name' using errcode = 'CV409';
  end if;
  insert into public.clinics (organization_id, name, timezone) values (o.id, v_name, v_tz) returning id into v_clinic;
  perform private.audit(o.id, null, 'clinic.added_by_operator', 'clinic', v_clinic, null,
                        jsonb_build_object('organization', o.id, 'name', v_name, 'timezone', v_tz, 'dbUser', session_user::text), v_reason);
  return jsonb_build_object('clinicId', v_clinic, 'name', v_name, 'timezone', v_tz);
end $$;

revoke all on function private.add_clinic(uuid, text, text, text) from public, anon, authenticated, service_role;
