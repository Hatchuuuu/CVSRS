-- 0022 Follow-up worklist with outreach log, clinical hold commands, clinic privacy notice with acknowledgement gate.
-- Blueprint refs: F10, F04 (privacy), F09 (holds), BP17, BP33, M02/M03 leftovers.
--  * The worklist is DERIVED from the schedule engine's results for the clinic's own approved schedule. It never invents due dates;
--    with no active schedule it says so and lists nothing.
--  * Outreach attempts are an append-only log. Contact numbers are shown only to staff who follow families up.
--  * A clinical hold is placed by clinical staff and released only by a clinical lead; the engine already refuses planned doses under a hold.
--  * The privacy notice text and version belong to the clinic's privacy owner. There is no default text. When a notice is configured,
--    a guardian must acknowledge the current version before adding a child or asking to link one.

-- ---------------------------------------------------------------------------------------------
-- Clinical holds
-- ---------------------------------------------------------------------------------------------
alter table public.clinical_holds add column resolution_note text;
alter table public.clinical_holds add column resolved_at timestamptz;
alter table public.clinical_holds add column placed_clinic_id uuid;

create function public.place_clinical_hold(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_reason_code text, p_restricted_note text default null, p_review_on date default null, p_rule_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'hold.place', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'r', p_reason_code, 'n', p_restricted_note, 'd', p_review_on, 'rule', p_rule_id));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  if p_reason_code is null or length(btrim(p_reason_code)) < 3 or length(p_reason_code) > 80 then raise exception 'name the reason for the hold (3 to 80 characters)' using errcode = 'CV422'; end if;
  if p_review_on is not null and p_review_on < private.local_today(p_clinic_id) then raise exception 'the review date cannot be in the past' using errcode = 'CV422'; end if;
  if p_rule_id is not null and not exists (select 1 from public.schedule_rules where id = p_rule_id and organization_id = v_org) then raise exception 'unknown schedule item' using errcode = 'CV422'; end if;
  if exists (select 1 from public.clinical_holds where child_id = v_canon and status = 'active' and coalesce(rule_id, '00000000-0000-0000-0000-000000000000') = coalesce(p_rule_id, '00000000-0000-0000-0000-000000000000')) then
    raise exception 'this hold already exists' using errcode = 'CV409';
  end if;
  insert into public.clinical_holds (organization_id, child_id, rule_id, reason_code, restricted_note, review_on, placed_clinic_id, created_by, updated_by)
  values (v_org, v_canon, p_rule_id, btrim(p_reason_code), left(nullif(btrim(coalesce(p_restricted_note, '')), ''), 500), p_review_on, p_clinic_id, auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'vaccination.record', 'hold.placed', 'child', v_canon, null, jsonb_build_object('holdId', v_id, 'rule', p_rule_id, 'reviewOn', p_review_on), p_reason_code);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('holdId', v_id, 'status', 'active'));
end $$;

create function public.release_clinical_hold(p_operation_key uuid, p_clinic_id uuid, p_hold_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; h public.clinical_holds;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'review.resolve');
  v_prev := private.begin_command(v_org, p_operation_key, 'hold.release', jsonb_build_object('c', p_clinic_id, 'h', p_hold_id, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'say why the hold is released' using errcode = 'CV422'; end if;
  select * into h from public.clinical_holds where id = p_hold_id and organization_id = v_org for update;
  if h.id is null or not private.child_in_clinic(private.canonical_child(h.child_id), p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if h.status <> 'active' then raise exception 'this hold is already released' using errcode = 'CV409'; end if;
  update public.clinical_holds set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), resolution_note = left(btrim(p_note), 500), updated_by = auth.uid() where id = h.id;
  perform private.audit(v_org, 'review.resolve', 'hold.released', 'child', h.child_id, jsonb_build_object('status', 'active'), jsonb_build_object('status', 'resolved'), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('holdId', h.id, 'status', 'resolved'));
end $$;

create function public.list_clinical_holds(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'status', h.status, 'reason', h.reason_code, 'note', h.restricted_note, 'reviewOn', h.review_on, 'startsAt', h.starts_at,
            'ruleRequirement', (select r.requirement_code from public.schedule_rules r where r.id = h.rule_id), 'resolvedAt', h.resolved_at, 'resolutionNote', h.resolution_note,
            'placedBy', (select display_name from public.profiles where id = h.created_by)) order by h.starts_at desc), '[]'::jsonb)
            from public.clinical_holds h where h.child_id = v_canon);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Clinic privacy notice and the acknowledgement gate
-- ---------------------------------------------------------------------------------------------
create function public.set_privacy_notice(p_operation_key uuid, p_clinic_id uuid, p_version text, p_text text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'admin.config');
  v_prev := private.begin_command(v_org, p_operation_key, 'privacy.notice', jsonb_build_object('c', p_clinic_id, 'v', p_version, 't', p_text));
  if v_prev is not null then return v_prev; end if;
  if p_version is null or length(btrim(p_version)) = 0 or length(p_version) > 50 then raise exception 'give the notice a version (for example "2026-10")' using errcode = 'CV422'; end if;
  if p_text is null or length(btrim(p_text)) < 50 or length(p_text) > 8000 then raise exception 'paste the privacy notice text approved by your privacy owner (at least 50 characters)' using errcode = 'CV422'; end if;
  if (select operational_policy -> 'privacyNotice' ->> 'version' from public.clinics where id = p_clinic_id) = btrim(p_version) then raise exception 'use a new version when the text changes' using errcode = 'CV409'; end if;
  update public.clinics set operational_policy = operational_policy || jsonb_build_object('privacyNotice', jsonb_build_object('version', btrim(p_version), 'text', btrim(p_text), 'setAt', now())) where id = p_clinic_id;
  perform private.audit(v_org, 'admin.config', 'privacy.notice_set', 'clinic', p_clinic_id, null, jsonb_build_object('version', btrim(p_version)), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('version', btrim(p_version)));
end $$;

create function private.guardian_ack_version(p_org uuid, p_version text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.privacy_records pr join public.guardians g on g.id = pr.guardian_id
                  where g.profile_id = auth.uid() and g.organization_id = p_org and pr.record_type = 'notice_acknowledgement' and pr.notice_version = p_version and pr.decision = 'acknowledged')
$$;

create function public.get_privacy_notice(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.clinics; v_n jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into c from public.clinics where id = p_clinic_id and status = 'active';
  if c.id is null then return null; end if;
  v_n := c.operational_policy -> 'privacyNotice';
  if v_n is null then return jsonb_build_object('configured', false, 'acknowledged', true); end if;
  return jsonb_build_object('configured', true, 'version', v_n ->> 'version', 'text', v_n ->> 'text', 'acknowledged', private.guardian_ack_version(c.organization_id, v_n ->> 'version'));
end $$;

create function public.acknowledge_clinic_privacy_notice(p_operation_key uuid, p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.clinics; v_prev jsonb; v_ver text; v_g uuid; v_id uuid;
begin
  if auth.uid() is null or not private.session_ok() then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  select * into c from public.clinics where id = p_clinic_id and status = 'active';
  if c.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  v_ver := c.operational_policy -> 'privacyNotice' ->> 'version';
  if v_ver is null then raise exception 'this clinic has no privacy notice to accept' using errcode = 'CV409'; end if;
  v_prev := private.begin_command(c.organization_id, p_operation_key, 'privacy.acknowledge_clinic', jsonb_build_object('c', p_clinic_id, 'v', v_ver));
  if v_prev is not null then return v_prev; end if;
  if not private.guardian_ack_version(c.organization_id, v_ver) then
    v_g := private.ensure_guardian(c.organization_id);
    insert into public.privacy_records (organization_id, guardian_id, purpose, record_type, notice_version, decision, created_by)
    values (c.organization_id, v_g, 'care_records', 'notice_acknowledgement', v_ver, 'acknowledged', auth.uid()) returning id into v_id;
    perform private.audit(c.organization_id, 'guardian', 'privacy.acknowledged', 'clinic', p_clinic_id, null, jsonb_build_object('version', v_ver), null);
  end if;
  return private.finish_command(c.organization_id, p_operation_key, jsonb_build_object('version', v_ver, 'acknowledged', true));
end $$;

create function private.require_privacy_ack(p_clinic uuid) returns void language plpgsql stable security definer set search_path = '' as $$
declare c public.clinics; v_ver text;
begin
  select * into c from public.clinics where id = p_clinic;
  if c.id is null then return; end if;
  v_ver := c.operational_policy -> 'privacyNotice' ->> 'version';
  if v_ver is not null and auth.uid() is not null and not private.guardian_ack_version(c.organization_id, v_ver) then
    raise exception 'please read and accept the clinic''s privacy notice first' using errcode = 'CV409';
  end if;
end $$;

-- The two guardian self-service entry points check the acknowledgement first, then run the original commands unchanged.
alter function public.create_child_provisional(uuid, uuid, jsonb, text) rename to create_child_provisional_base;
alter function public.request_guardian_link(uuid, uuid, jsonb, text) rename to request_guardian_link_base;
revoke all on function public.create_child_provisional_base(uuid, uuid, jsonb, text), public.request_guardian_link_base(uuid, uuid, jsonb, text) from public, anon, authenticated;

create function public.create_child_provisional(p_operation_key uuid, p_clinic_id uuid, p_child jsonb, p_relationship text default 'mother') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_privacy_ack(p_clinic_id);
  return public.create_child_provisional_base(p_operation_key, p_clinic_id, p_child, p_relationship);
end $$;

create function public.request_guardian_link(p_operation_key uuid, p_clinic_id uuid, p_descriptor jsonb, p_relationship text default 'other') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_privacy_ack(p_clinic_id);
  return public.request_guardian_link_base(p_operation_key, p_clinic_id, p_descriptor, p_relationship);
end $$;

-- ---------------------------------------------------------------------------------------------
-- Follow-up worklist
-- ---------------------------------------------------------------------------------------------
create table public.followup_snapshots (
  child_id uuid primary key references public.children (id),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  computed_at timestamptz not null default now(),
  as_of date not null,
  schedule_version_id uuid,
  status text not null check (status in ('evaluated','no_active_schedule')),
  behind integer not null default 0,
  due integer not null default 0,
  review integer not null default 0,
  needs jsonb not null default '[]'::jsonb,
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id)
);
create index followup_snapshots_clinic_idx on public.followup_snapshots (clinic_id, behind desc, due desc);

create table public.followup_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  child_id uuid not null,
  outcome text not null check (outcome in ('reached','no_answer','wrong_number','refused','will_visit','moved_away','other')),
  note text check (note is null or length(note) <= 300),
  next_try_on date,
  recorded_by uuid not null references public.profiles (id),
  recorded_at timestamptz not null default now(),
  operation_id uuid not null unique,
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id)
);
create index followup_attempts_idx on public.followup_attempts (child_id, recorded_at desc);
create trigger followup_attempts_immutable before update or delete on public.followup_attempts for each row execute function private.forbid_change();
create trigger followup_attempts_no_truncate before truncate on public.followup_attempts for each statement execute function private.forbid_change();
alter table public.followup_snapshots enable row level security;
alter table public.followup_attempts enable row level security;
revoke all on public.followup_snapshots, public.followup_attempts from anon, authenticated;

create function private.followup_is_stale(p_org uuid, p_dob date, p_today date, p_computed timestamptz, p_version uuid, p_has boolean) returns boolean
language sql stable security definer set search_path = '' as $$
  select not p_has or p_computed < now() - interval '24 hours' or p_version is distinct from private.active_schedule_for(p_org, 'routine', p_dob, p_today)
$$;

-- Recomputes snapshots for the children whose snapshot is missing or older than 24 hours (oldest first). Bounded per call.
create function public.refresh_followup(p_operation_key uuid, p_clinic_id uuid, p_batch integer default 100) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_today date; r record; v_res jsonb; v_n int := 0; v_needs jsonb; v_behind int; v_due int; v_review int; v_batch int := least(greatest(coalesce(p_batch, 100), 1), 200); v_left int; v_ver uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['bhw.followup','child.read_clinical']);
  v_prev := private.begin_command(v_org, p_operation_key, 'followup.refresh', jsonb_build_object('c', p_clinic_id, 'b', v_batch));
  if v_prev is not null then return v_prev; end if;
  v_today := private.local_today(p_clinic_id);
  for r in
    select c.id from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status = 'active'
      left join public.followup_snapshots s on s.child_id = c.id
     where c.merged_into_id is null and c.record_status = 'active' and c.deleted_at is null and private.followup_is_stale(c.organization_id, c.dob, v_today, s.computed_at, s.schedule_version_id, s.child_id is not null)
     order by s.computed_at nulls first, c.created_at limit v_batch
  loop
    v_res := private.compute_child_schedule(r.id, v_today, false);
    v_ver := private.active_schedule_for(v_org, 'routine', (select dob from public.children where id = r.id), v_today);
    if v_res ->> 'status' <> 'evaluated' then
      insert into public.followup_snapshots (child_id, organization_id, clinic_id, as_of, status, schedule_version_id) values (r.id, v_org, p_clinic_id, v_today, 'no_active_schedule', v_ver)
      on conflict (child_id) do update set computed_at = now(), as_of = v_today, status = 'no_active_schedule', behind = 0, due = 0, review = 0, needs = '[]'::jsonb, clinic_id = p_clinic_id, schedule_version_id = v_ver;
    else
      select coalesce(jsonb_agg(jsonb_build_object('requirement', x ->> 'requirement', 'status', x ->> 'status') order by (x ->> 'requirement')), '[]'::jsonb),
             count(*) filter (where x ->> 'status' in ('overdue','past_recommended_date')), count(*) filter (where x ->> 'status' in ('due_now','due_today')), count(*) filter (where x ->> 'status' = 'staff_review_needed')
        into v_needs, v_behind, v_due, v_review
        from jsonb_array_elements(v_res -> 'requirements') x where x ->> 'status' in ('overdue','past_recommended_date','due_now','due_today','staff_review_needed');
      insert into public.followup_snapshots (child_id, organization_id, clinic_id, as_of, status, behind, due, review, needs, schedule_version_id) values (r.id, v_org, p_clinic_id, v_today, 'evaluated', v_behind, v_due, v_review, v_needs, v_ver)
      on conflict (child_id) do update set computed_at = now(), as_of = v_today, status = 'evaluated', behind = v_behind, due = v_due, review = v_review, needs = v_needs, clinic_id = p_clinic_id, schedule_version_id = v_ver;
    end if;
    v_n := v_n + 1;
  end loop;
  select count(*) into v_left from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status = 'active'
    left join public.followup_snapshots s on s.child_id = c.id where c.merged_into_id is null and c.record_status = 'active' and private.followup_is_stale(c.organization_id, c.dob, v_today, s.computed_at, s.schedule_version_id, s.child_id is not null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('refreshed', v_n, 'remaining', v_left));
end $$;

create function public.list_followup_worklist(p_clinic_id uuid, p_filter text default 'behind', p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_res jsonb; v_lim int := least(greatest(coalesce(p_limit, 50), 1), 100); v_today date; v_contact boolean;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['bhw.followup','child.read_clinical']);
  if p_filter not in ('behind','due','review','all') then raise exception 'unknown filter' using errcode = 'CV422'; end if;
  v_today := private.local_today(p_clinic_id);
  v_contact := private.has_capability(p_clinic_id, 'bhw.followup');
  select jsonb_build_object(
    'asOf', now(),
    'schedule', case when exists (select 1 from public.followup_snapshots where clinic_id = p_clinic_id and status = 'evaluated') then 'active' when exists (select 1 from public.followup_snapshots where clinic_id = p_clinic_id) then 'none' else 'unknown' end,
    'staleChildren', (select count(*) from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status = 'active'
                        left join public.followup_snapshots s on s.child_id = c.id where c.merged_into_id is null and c.record_status = 'active' and private.followup_is_stale(c.organization_id, c.dob, v_today, s.computed_at, s.schedule_version_id, s.child_id is not null)),
    'items', coalesce((select jsonb_agg(x.item order by x.ord1 desc, x.ord2 desc, x.ord3) from (
        select jsonb_build_object('childId', c.id, 'childName', c.display_name, 'recordNo', c.local_record_no, 'dob', c.dob, 'behind', s.behind, 'due', s.due, 'review', s.review, 'needs', s.needs, 'computedAt', s.computed_at,
                 'lastAttempt', (select jsonb_build_object('outcome', a.outcome, 'at', a.recorded_at, 'note', a.note, 'nextTryOn', a.next_try_on) from public.followup_attempts a where a.child_id = c.id order by a.recorded_at desc limit 1),
                 'attempts', (select count(*) from public.followup_attempts a where a.child_id = c.id),
                 'guardian', (select jsonb_build_object('name', g.full_name, 'phone', case when v_contact then g.contact_phone end, 'phoneChecked', g.contact_verified_at is not null)
                                from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where r.child_id = c.id and r.status = 'active' and g.deleted_at is null order by r.created_at limit 1)) item,
               s.behind ord1, s.due ord2, c.display_name ord3
          from public.followup_snapshots s join public.children c on c.id = s.child_id
         where s.clinic_id = p_clinic_id and s.status = 'evaluated'
           and ((p_filter = 'behind' and s.behind > 0) or (p_filter = 'due' and s.due > 0) or (p_filter = 'review' and s.review > 0) or (p_filter = 'all' and (s.behind + s.due + s.review) > 0))
           and not exists (select 1 from public.followup_attempts a where a.child_id = c.id and a.next_try_on > v_today and a.recorded_at = (select max(a2.recorded_at) from public.followup_attempts a2 where a2.child_id = c.id))
         order by s.behind desc, s.due desc, c.display_name limit v_lim) x), '[]'::jsonb)) into v_res;
  perform private.audit(v_org, case when v_contact then 'bhw.followup' else 'child.read_clinical' end, 'followup.listed', 'clinic', p_clinic_id, null, jsonb_build_object('filter', p_filter, 'shown', jsonb_array_length(v_res -> 'items')), null);
  return v_res;
end $$;

create function public.log_followup_attempt(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_outcome text, p_note text default null, p_next_try_on date default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['bhw.followup','child.read_clinical']);
  v_prev := private.begin_command(v_org, p_operation_key, 'followup.attempt', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'o', p_outcome, 'n', p_note, 'd', p_next_try_on));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  if p_outcome not in ('reached','no_answer','wrong_number','refused','will_visit','moved_away','other') then raise exception 'choose what happened' using errcode = 'CV422'; end if;
  if p_next_try_on is not null and (p_next_try_on <= private.local_today(p_clinic_id) or p_next_try_on > private.local_today(p_clinic_id) + 180) then raise exception 'choose a date within the next 6 months' using errcode = 'CV422'; end if;
  insert into public.followup_attempts (organization_id, clinic_id, child_id, outcome, note, next_try_on, recorded_by, operation_id)
  values (v_org, p_clinic_id, v_canon, p_outcome, left(nullif(btrim(coalesce(p_note, '')), ''), 300), p_next_try_on, auth.uid(), p_operation_key) returning id into v_id;
  perform private.audit(v_org, 'bhw.followup', 'followup.attempt', 'child', v_canon, null, jsonb_build_object('outcome', p_outcome), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('attemptId', v_id));
end $$;

revoke all on function private.guardian_ack_version(uuid, text), private.require_privacy_ack(uuid), private.followup_is_stale(uuid, date, date, timestamptz, uuid, boolean) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'place_clinical_hold(uuid,uuid,uuid,text,text,date,uuid)', 'release_clinical_hold(uuid,uuid,uuid,text)', 'list_clinical_holds(uuid,uuid)',
    'set_privacy_notice(uuid,uuid,text,text)', 'get_privacy_notice(uuid)', 'acknowledge_clinic_privacy_notice(uuid,uuid)',
    'create_child_provisional(uuid,uuid,jsonb,text)', 'request_guardian_link(uuid,uuid,jsonb,text)',
    'refresh_followup(uuid,uuid,integer)', 'list_followup_worklist(uuid,text,integer)', 'log_followup_attempt(uuid,uuid,uuid,text,text,date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- A change to a child's history or holds makes the stored follow-up result untrustworthy: mark it stale so the next refresh recomputes it.
create function private.followup_invalidate() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_child uuid := new.child_id;
begin
  update public.followup_snapshots set computed_at = now() - interval '1000 days' where child_id in (select private.child_ids_with_aliases(private.canonical_child(v_child)));
  return new;
end $$;
create trigger vaccination_revisions_followup after insert on public.vaccination_revisions for each row execute function private.followup_invalidate();
create trigger clinical_holds_followup after insert or update on public.clinical_holds for each row execute function private.followup_invalidate();
revoke all on function private.followup_invalidate() from public, anon, authenticated;
