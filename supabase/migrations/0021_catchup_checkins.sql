-- 0021 Staff-authored catch-up plans (two-person reviewed) and staffed check-ins. Blueprint refs: F11, F20, BP17, M09.
--  * The system contains NO catch-up rules. A catch-up plan is written by clinical staff (what, when, why, which policy) and must be
--    approved by a different person with rules.approve. It never changes the schedule engine, never credits doses, never books visits.
--  * A check-in is a guardian's question to the clinic. Nothing answers it automatically and nothing is triaged by software: staff read
--    and reply. The feature stays OFF for a clinic until its clinical lead records the safety notice families will see; there is no default text.

-- ---------------------------------------------------------------------------------------------
-- Catch-up plans
-- ---------------------------------------------------------------------------------------------
create table public.catchup_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  child_id uuid not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected','superseded','cancelled')),
  rationale text not null check (length(btrim(rationale)) >= 10),
  policy_reference text not null check (length(btrim(policy_reference)) >= 3),
  authored_by uuid not null references public.profiles (id),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  review_note text,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id),
  unique (organization_id, id),
  check (reviewed_by is null or reviewed_by <> authored_by)
);
create unique index catchup_one_approved_uq on public.catchup_plans (child_id) where status = 'approved';
create index catchup_plans_child_idx on public.catchup_plans (child_id, status);

create table public.catchup_plan_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  plan_id uuid not null,
  seq integer not null check (seq > 0),
  label text not null check (length(btrim(label)) between 1 and 200),
  product_id uuid,
  target_date date,
  note text check (note is null or length(note) <= 300),
  status text not null default 'planned' check (status in ('planned','done','dropped')),
  status_note text,
  status_by uuid references public.profiles (id),
  status_at timestamptz,
  foreign key (organization_id, plan_id) references public.catchup_plans (organization_id, id),
  foreign key (organization_id, product_id) references public.vaccine_products (organization_id, id),
  unique (plan_id, seq)
);

-- Items are frozen once a plan leaves draft: only their status may change, and only while the plan is approved.
create function private.catchup_item_guard() returns trigger language plpgsql set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.catchup_plans where id = coalesce(old.plan_id, new.plan_id);
  if tg_op = 'DELETE' then
    if v_status <> 'draft' then raise exception 'plan items cannot be removed after submission' using errcode = 'CV403'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if v_status <> 'draft' then raise exception 'plan items cannot be added after submission' using errcode = 'CV403'; end if;
    return new;
  end if;
  if (new.plan_id, new.seq, new.label, new.product_id, new.target_date, new.note) is distinct from (old.plan_id, old.seq, old.label, old.product_id, old.target_date, old.note) then
    if v_status <> 'draft' then raise exception 'plan items cannot be edited after submission' using errcode = 'CV403'; end if;
  elsif v_status <> 'approved' and (new.status is distinct from old.status) then
    raise exception 'only items of an approved plan can be marked' using errcode = 'CV403';
  end if;
  return new;
end $$;
create trigger catchup_items_guard before insert or update or delete on public.catchup_plan_items for each row execute function private.catchup_item_guard();
create trigger catchup_items_no_truncate before truncate on public.catchup_plan_items for each statement execute function private.forbid_change();
create trigger catchup_plans_no_delete before delete on public.catchup_plans for each row execute function private.forbid_change();
create trigger catchup_plans_no_truncate before truncate on public.catchup_plans for each statement execute function private.forbid_change();
create trigger catchup_plans_touch before update on public.catchup_plans for each row execute function private.touch_row();
alter table public.catchup_plans enable row level security;
alter table public.catchup_plan_items enable row level security;
revoke all on public.catchup_plans, public.catchup_plan_items from anon, authenticated;

create function private.catchup_json(p public.catchup_plans, p_staff boolean) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'status', p.status, 'childId', p.child_id, 'version', p.version, 'reviewedAt', p.reviewed_at,
      'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'seq', i.seq, 'label', i.label, 'productId', i.product_id, 'targetDate', i.target_date, 'note', i.note, 'status', i.status)
                  || case when p_staff then jsonb_build_object('statusNote', i.status_note) else '{}'::jsonb end order by i.seq) from public.catchup_plan_items i where i.plan_id = p.id), '[]'::jsonb))
    || case when p_staff then jsonb_build_object('rationale', p.rationale, 'policyReference', p.policy_reference, 'authoredBy', (select display_name from public.profiles where id = p.authored_by),
         'authoredById', p.authored_by, 'submittedAt', p.submitted_at, 'reviewNote', p.review_note, 'reviewedBy', (select display_name from public.profiles where id = p.reviewed_by), 'createdAt', p.created_at) else '{}'::jsonb end
$$;

create function private.catchup_items_insert(p_org uuid, p_plan uuid, p_items jsonb) returns void language plpgsql security definer set search_path = '' as $$
declare i jsonb; n int := 0; v_prod uuid;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'add at least one planned item' using errcode = 'CV422'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'a plan can have at most 30 items' using errcode = 'CV422'; end if;
  for i in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    if length(btrim(coalesce(i ->> 'label', ''))) = 0 then raise exception 'every item needs a description' using errcode = 'CV422'; end if;
    v_prod := nullif(i ->> 'productId', '')::uuid;
    if v_prod is not null and not exists (select 1 from public.vaccine_products where id = v_prod and organization_id = p_org) then raise exception 'unknown product' using errcode = 'CV422'; end if;
    insert into public.catchup_plan_items (organization_id, plan_id, seq, label, product_id, target_date, note)
    values (p_org, p_plan, n, left(btrim(i ->> 'label'), 200), v_prod, nullif(i ->> 'targetDate', '')::date, left(nullif(btrim(coalesce(i ->> 'note', '')), ''), 300));
  end loop;
end $$;

create function public.save_catchup_draft(p_operation_key uuid, p_clinic_id uuid, p_child_id uuid, p_plan_id uuid, p_rationale text, p_policy_reference text, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_canon uuid; p public.catchup_plans;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'catchup.save', jsonb_build_object('c', p_clinic_id, 'ch', p_child_id, 'p', p_plan_id, 'r', p_rationale, 'pr', p_policy_reference, 'i', p_items));
  if v_prev is not null then return v_prev; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  if p_rationale is null or length(btrim(p_rationale)) < 10 then raise exception 'explain why this plan is needed (at least a sentence)' using errcode = 'CV422'; end if;
  if p_policy_reference is null or length(btrim(p_policy_reference)) < 3 then raise exception 'name the clinical policy or advice this plan follows' using errcode = 'CV422'; end if;
  if p_plan_id is null then
    if exists (select 1 from public.catchup_plans where child_id = v_canon and status in ('draft','submitted')) then raise exception 'this child already has a plan being prepared' using errcode = 'CV409'; end if;
    insert into public.catchup_plans (organization_id, clinic_id, child_id, rationale, policy_reference, authored_by) values (v_org, p_clinic_id, v_canon, btrim(p_rationale), btrim(p_policy_reference), auth.uid()) returning * into p;
  else
    select * into p from public.catchup_plans where id = p_plan_id and organization_id = v_org and clinic_id = p_clinic_id and child_id = v_canon for update;
    if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
    if p.status <> 'draft' then raise exception 'only a draft can be edited' using errcode = 'CV409'; end if;
    if p.authored_by <> auth.uid() then raise exception 'only the author can edit a draft' using errcode = 'CV403'; end if;
    update public.catchup_plans set rationale = btrim(p_rationale), policy_reference = btrim(p_policy_reference) where id = p.id;
    delete from public.catchup_plan_items where plan_id = p.id;
  end if;
  perform private.catchup_items_insert(v_org, p.id, p_items);
  perform private.audit(v_org, 'vaccination.record', 'catchup.drafted', 'catchup_plan', p.id, null, jsonb_build_object('child', v_canon, 'items', jsonb_array_length(p_items)), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('planId', p.id, 'status', 'draft'));
end $$;

create function public.submit_catchup_plan(p_operation_key uuid, p_clinic_id uuid, p_plan_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; p public.catchup_plans;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'catchup.submit', jsonb_build_object('c', p_clinic_id, 'p', p_plan_id));
  if v_prev is not null then return v_prev; end if;
  select * into p from public.catchup_plans where id = p_plan_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p.authored_by <> auth.uid() then raise exception 'only the author can submit a plan' using errcode = 'CV403'; end if;
  if p.status <> 'draft' then raise exception 'only a draft can be submitted' using errcode = 'CV409'; end if;
  if not exists (select 1 from public.catchup_plan_items where plan_id = p.id) then raise exception 'add at least one planned item' using errcode = 'CV422'; end if;
  update public.catchup_plans set status = 'submitted', submitted_at = now() where id = p.id;
  perform private.audit(v_org, 'vaccination.record', 'catchup.submitted', 'catchup_plan', p.id, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('planId', p.id, 'status', 'submitted'));
end $$;

create function public.review_catchup_plan(p_operation_key uuid, p_clinic_id uuid, p_plan_id uuid, p_decision text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; p public.catchup_plans; v_status text; v_old uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  v_prev := private.begin_command(v_org, p_operation_key, 'catchup.review', jsonb_build_object('c', p_clinic_id, 'p', p_plan_id, 'd', p_decision, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if p_decision not in ('approve','reject') then raise exception 'choose approve or reject' using errcode = 'CV422'; end if;
  if p_decision = 'reject' and (p_note is null or length(btrim(p_note)) < 3) then raise exception 'say why the plan is rejected' using errcode = 'CV422'; end if;
  select * into p from public.catchup_plans where id = p_plan_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p.status <> 'submitted' then raise exception 'only a submitted plan can be reviewed' using errcode = 'CV409'; end if;
  if p.authored_by = auth.uid() then raise exception 'the author cannot review their own plan' using errcode = 'CV403'; end if;
  v_status := case when p_decision = 'approve' then 'approved' else 'rejected' end;
  if v_status = 'approved' then
    for v_old in select id from public.catchup_plans where child_id = p.child_id and status = 'approved' and id <> p.id loop
      update public.catchup_plans set status = 'superseded' where id = v_old;
    end loop;
  end if;
  update public.catchup_plans set status = v_status, reviewed_by = auth.uid(), reviewed_at = now(), review_note = left(nullif(btrim(coalesce(p_note, '')), ''), 300) where id = p.id;
  if v_status = 'approved' then
    perform private.enqueue(v_org, 'catchup.approved', 'catchup_plan', p.id, 'catchup-approved:' || p.id, jsonb_build_object('childId', p.child_id));
  end if;
  perform private.audit(v_org, 'rules.approve', 'catchup.' || v_status, 'catchup_plan', p.id, jsonb_build_object('status', 'submitted'), jsonb_build_object('status', v_status), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('planId', p.id, 'status', v_status));
end $$;

create function public.set_catchup_item_status(p_operation_key uuid, p_clinic_id uuid, p_item_id uuid, p_status text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; i public.catchup_plan_items; p public.catchup_plans;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'catchup.item', jsonb_build_object('c', p_clinic_id, 'i', p_item_id, 's', p_status, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if p_status not in ('done','dropped') then raise exception 'choose done or dropped' using errcode = 'CV422'; end if;
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'a note is required' using errcode = 'CV422'; end if;
  select * into i from public.catchup_plan_items where id = p_item_id and organization_id = v_org for update;
  select * into p from public.catchup_plans where id = i.plan_id and clinic_id = p_clinic_id;
  if i.id is null or p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p.status <> 'approved' then raise exception 'only items of the approved plan can be marked' using errcode = 'CV409'; end if;
  if i.status <> 'planned' then raise exception 'this item was already marked' using errcode = 'CV409'; end if;
  update public.catchup_plan_items set status = p_status, status_note = left(btrim(p_note), 300), status_by = auth.uid(), status_at = now() where id = i.id;
  perform private.audit(v_org, 'vaccination.record', 'catchup.item_' || p_status, 'catchup_plan', p.id, null, jsonb_build_object('item', i.id, 'label', i.label), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('itemId', i.id, 'status', p_status));
end $$;

create function public.cancel_catchup_plan(p_operation_key uuid, p_clinic_id uuid, p_plan_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; p public.catchup_plans;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'vaccination.record');
  v_prev := private.begin_command(v_org, p_operation_key, 'catchup.cancel', jsonb_build_object('c', p_clinic_id, 'p', p_plan_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  select * into p from public.catchup_plans where id = p_plan_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if p.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p.status not in ('draft','submitted','approved') then raise exception 'this plan is already closed' using errcode = 'CV409'; end if;
  if p.authored_by <> auth.uid() and not private.has_capability(p_clinic_id, 'rules.approve') then raise exception 'only the author or a plan approver can cancel it' using errcode = 'CV403'; end if;
  update public.catchup_plans set status = 'cancelled', review_note = coalesce(review_note, left(btrim(p_reason), 300)) where id = p.id;
  perform private.audit(v_org, 'vaccination.record', 'catchup.cancelled', 'catchup_plan', p.id, jsonb_build_object('status', p.status), jsonb_build_object('status', 'cancelled'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('planId', p.id, 'status', 'cancelled'));
end $$;

create function public.list_catchup_plans(p_clinic_id uuid, p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  v_canon := private.canonical_child(p_child_id);
  if not private.child_in_clinic(v_canon, p_clinic_id) then return null; end if;
  return (select coalesce(jsonb_agg(private.catchup_json(p, true) order by p.created_at desc), '[]'::jsonb) from public.catchup_plans p where p.child_id = v_canon and p.clinic_id = p_clinic_id);
end $$;

-- Guardians see only the APPROVED plan: what is planned and its state. Not the rationale, policy reference or staff notes.
create function public.guardian_get_catchup_plan(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  return (select private.catchup_json(p, false) from public.catchup_plans p where p.child_id = v_canon and p.status = 'approved');
end $$;

-- Plans awaiting review, clinic-wide.
create function public.list_catchup_reviews(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_capability(p_clinic_id, 'rules.approve');
  return (select coalesce(jsonb_agg(jsonb_build_object('planId', p.id, 'childId', p.child_id, 'childName', c.display_name, 'recordNo', c.local_record_no, 'submittedAt', p.submitted_at,
            'authoredBy', (select display_name from public.profiles where id = p.authored_by), 'authoredById', p.authored_by, 'itemCount', (select count(*) from public.catchup_plan_items i where i.plan_id = p.id)) order by p.submitted_at), '[]'::jsonb)
            from public.catchup_plans p join public.children c on c.id = p.child_id where p.clinic_id = p_clinic_id and p.status = 'submitted');
end $$;

-- ---------------------------------------------------------------------------------------------
-- Check-ins
-- ---------------------------------------------------------------------------------------------
create function public.set_checkin_policy(p_operation_key uuid, p_clinic_id uuid, p_enabled boolean, p_safety_notice text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_pol jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'grant.approve.clinical');
  v_prev := private.begin_command(v_org, p_operation_key, 'checkin.policy', jsonb_build_object('c', p_clinic_id, 'e', p_enabled, 'n', p_safety_notice));
  if v_prev is not null then return v_prev; end if;
  if p_enabled and (p_safety_notice is null or length(btrim(p_safety_notice)) < 20) then raise exception 'write the safety notice families will see (at least a sentence) before turning check-ins on' using errcode = 'CV422'; end if;
  v_pol := (select operational_policy from public.clinics where id = p_clinic_id) || jsonb_build_object('checkinEnabled', coalesce(p_enabled, false), 'checkinSafetyNotice', left(btrim(coalesce(p_safety_notice, '')), 600));
  update public.clinics set operational_policy = v_pol where id = p_clinic_id;
  perform private.audit(v_org, 'grant.approve.clinical', 'checkin.policy_set', 'clinic', p_clinic_id, null, jsonb_build_object('enabled', coalesce(p_enabled, false)), p_safety_notice);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('enabled', coalesce(p_enabled, false)));
end $$;

create function public.get_checkin_policy(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_any(p_clinic_id, array['grant.approve.clinical','child.read_clinical']);
  return (select jsonb_build_object('enabled', coalesce((operational_policy ->> 'checkinEnabled')::boolean, false), 'safetyNotice', coalesce(operational_policy ->> 'checkinSafetyNotice', '')) from public.clinics where id = p_clinic_id);
end $$;

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  child_id uuid not null,
  guardian_profile_id uuid not null references public.profiles (id),
  category text not null check (category in ('question','after_vaccination','other')),
  message text not null check (length(btrim(message)) between 3 and 1000),
  status text not null default 'open' check (status in ('open','answered','closed')),
  answer text check (answer is null or length(answer) between 1 and 500),
  answered_by uuid references public.profiles (id),
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, child_id) references public.children (organization_id, id)
);
create index checkins_clinic_idx on public.checkins (clinic_id, status, created_at);
create trigger checkins_no_delete before delete on public.checkins for each row execute function private.forbid_change();
create trigger checkins_no_truncate before truncate on public.checkins for each statement execute function private.forbid_change();
alter table public.checkins enable row level security;
revoke all on public.checkins from anon, authenticated;

-- Returns the clinic's own safety notice with the acknowledgement so the guardian always sees it at the moment of sending.
create function public.create_checkin(p_operation_key uuid, p_child_id uuid, p_category text, p_message text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; v_clinic uuid; v_org uuid; v_prev jsonb; v_pol jsonb; v_id uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then raise exception 'not found' using errcode = 'CV404'; end if;
  select e.clinic_id, c.organization_id, c.operational_policy into v_clinic, v_org, v_pol from public.child_clinic_enrollments e join public.clinics c on c.id = e.clinic_id
   where e.child_id = v_canon and e.status in ('pending','active') order by e.is_primary desc, e.created_at limit 1;
  if v_clinic is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if not coalesce((v_pol ->> 'checkinEnabled')::boolean, false) or length(coalesce(v_pol ->> 'checkinSafetyNotice', '')) < 20 then
    raise exception 'this clinic has not turned on check-ins; please call or visit the clinic' using errcode = 'CV409';
  end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'checkin.create', jsonb_build_object('ch', v_canon, 'c', p_category, 'm', p_message));
  if v_prev is not null then return v_prev; end if;
  if p_category not in ('question','after_vaccination','other') then raise exception 'choose what this is about' using errcode = 'CV422'; end if;
  if p_message is null or length(btrim(p_message)) < 3 then raise exception 'write your question' using errcode = 'CV422'; end if;
  if (select count(*) from public.checkins where child_id = v_canon and status = 'open') >= 3 then raise exception 'you already have several questions waiting; the clinic will reply to those first' using errcode = 'CV409'; end if;
  insert into public.checkins (organization_id, clinic_id, child_id, guardian_profile_id, category, message) values (v_org, v_clinic, v_canon, auth.uid(), p_category, left(btrim(p_message), 1000)) returning id into v_id;
  perform private.audit(v_org, 'guardian', 'checkin.created', 'checkin', v_id, null, jsonb_build_object('category', p_category), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('checkinId', v_id, 'safetyNotice', v_pol ->> 'checkinSafetyNotice'));
end $$;

create function public.my_checkins(p_child_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_canon uuid; v_pol jsonb;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  v_canon := private.canonical_child(p_child_id);
  if not private.guardian_has_full_access(v_canon) then return null; end if;
  select c.operational_policy into v_pol from public.child_clinic_enrollments e join public.clinics c on c.id = e.clinic_id where e.child_id = v_canon and e.status in ('pending','active') order by e.is_primary desc limit 1;
  return jsonb_build_object('enabled', coalesce((v_pol ->> 'checkinEnabled')::boolean, false) and length(coalesce(v_pol ->> 'checkinSafetyNotice', '')) >= 20, 'safetyNotice', coalesce(v_pol ->> 'checkinSafetyNotice', ''),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'category', k.category, 'message', k.message, 'status', k.status, 'answer', k.answer, 'createdAt', k.created_at, 'answeredAt', k.answered_at) order by k.created_at desc)
                        from public.checkins k where k.child_id = v_canon and k.guardian_profile_id = auth.uid()), '[]'::jsonb));
end $$;

create function public.list_checkins(p_clinic_id uuid, p_status text default 'open') returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  if p_status not in ('open','answered','closed') then raise exception 'unknown status' using errcode = 'CV422'; end if;
  perform private.audit((select organization_id from public.clinics where id = p_clinic_id), 'child.read_clinical', 'checkin.list', 'clinic', p_clinic_id, null, jsonb_build_object('status', p_status), null);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'childId', k.child_id, 'childName', c.display_name, 'recordNo', c.local_record_no, 'category', k.category, 'message', k.message, 'status', k.status, 'answer', k.answer,
            'createdAt', k.created_at, 'answeredAt', k.answered_at) order by (k.category = 'after_vaccination') desc, k.created_at), '[]'::jsonb)
            from public.checkins k join public.children c on c.id = k.child_id where k.clinic_id = p_clinic_id and k.status = p_status);
end $$;

create function public.answer_checkin(p_operation_key uuid, p_clinic_id uuid, p_checkin_id uuid, p_answer text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; k public.checkins; v_name text;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'child.read_clinical');
  v_prev := private.begin_command(v_org, p_operation_key, 'checkin.answer', jsonb_build_object('c', p_clinic_id, 'k', p_checkin_id, 'a', p_answer));
  if v_prev is not null then return v_prev; end if;
  if p_answer is null or length(btrim(p_answer)) < 1 or length(p_answer) > 500 then raise exception 'write a reply of up to 500 characters' using errcode = 'CV422'; end if;
  select * into k from public.checkins where id = p_checkin_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if k.id is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if k.status <> 'open' then raise exception 'this question was already answered' using errcode = 'CV409'; end if;
  update public.checkins set status = 'answered', answer = btrim(p_answer), answered_by = auth.uid(), answered_at = now() where id = k.id;
  select display_name into v_name from public.children where id = k.child_id;
  insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
  values (v_org, k.guardian_profile_id, k.child_id, 'checkin', 'The clinic replied', left('Reply about ' || v_name || ': ' || btrim(p_answer), 600), 'checkin:' || k.id) on conflict (recipient_profile_id, dedupe_key) do nothing;
  perform private.audit(v_org, 'child.read_clinical', 'checkin.answered', 'checkin', k.id, jsonb_build_object('status', 'open'), jsonb_build_object('status', 'answered'), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('checkinId', k.id, 'status', 'answered'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Outbox: notify the family when a plan is approved (wrapper keeps the earlier handler intact)
-- ---------------------------------------------------------------------------------------------
alter function private.handle_outbox_job(private.outbox_jobs) rename to handle_outbox_job_base;
create function private.handle_outbox_job(j private.outbox_jobs) returns text
language plpgsql security definer set search_path = '' as $$
declare v_child public.children;
begin
  if j.job_type = 'catchup.approved' then
    select * into v_child from public.children where id = (j.payload ->> 'childId')::uuid;
    if v_child.id is null then return 'cancelled'; end if;
    perform private.notify_guardians(j.organization_id, v_child.id, 'record', 'Care plan from the clinic', format('The clinic added a care plan for %s. Open the record to see it.', v_child.display_name), j.dedupe_key);
    return 'done';
  end if;
  return private.handle_outbox_job_base(j);
end $$;

-- Backlog now also shows plans and questions waiting for a person.
create or replace function public.report_backlog(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id);
begin
  perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'backlog'), null);
  return jsonb_build_object('report', 'backlog', 'asOf', now(), 'definitions', jsonb_build_object('version', 'r1', 'terms', jsonb_build_object(
      'openReviewCases', 'Review cases still open or in review, by type.', 'pendingOutsideDoses', 'Doses reported as given elsewhere that staff have not yet verified or rejected.',
      'provisionalChildren', 'Children enrolled here whose identity has not been confirmed.', 'pendingGuardianLinks', 'Guardian links waiting for in-person verification.',
      'pendingCertificates', 'Certificates prepared but not yet issued (document not stored).', 'failedMessages', 'Notification jobs that failed permanently.',
      'openTemperatureExcursions', 'Fridge readings outside the approved limits that nobody has reviewed.', 'transfersNeedingDecision', 'Stock transfers that arrived short and still need a decision.',
      'transfersInTransit', 'Stock sent to or from this clinic that has not been received yet.',
      'plansAwaitingReview', 'Catch-up plans submitted and waiting for a second person.', 'openCheckins', 'Questions from families that no one has answered yet.')),
    'openReviewCases', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.record_review_cases where clinic_id = p_clinic_id and status in ('open','in_review') group by kind) k),
    'pendingOutsideDoses', (select count(*) from private.current_revisions cr where cr.verification_status = 'pending_verification' and cr.event_status = 'active'
                              and private.child_in_clinic(private.canonical_child(cr.child_id), p_clinic_id)),
    'provisionalChildren', (select count(*) from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where c.record_status = 'provisional' and c.merged_into_id is null),
    'pendingGuardianLinks', (select count(*) from public.guardian_child_relationships r join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where r.status = 'provisional'),
    'pendingCertificates', (select count(*) from public.certificates where clinic_id = p_clinic_id and status = 'pending'),
    'failedMessages', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'failed'),
    'openTemperatureExcursions', (select count(*) from public.temperature_readings r where r.clinic_id = p_clinic_id and r.status = 'excursion' and not exists (select 1 from public.temperature_reviews rv where rv.reading_id = r.id)),
    'transfersNeedingDecision', (select count(*) from public.stock_transfers where from_clinic_id = p_clinic_id and status = 'received_short'),
    'transfersInTransit', (select count(*) from public.stock_transfers where (from_clinic_id = p_clinic_id or to_clinic_id = p_clinic_id) and status = 'in_transit'),
    'plansAwaitingReview', (select count(*) from public.catchup_plans where clinic_id = p_clinic_id and status = 'submitted'),
    'openCheckins', (select count(*) from public.checkins where clinic_id = p_clinic_id and status = 'open'));
end $$;

revoke all on function private.catchup_item_guard(), private.catchup_json(public.catchup_plans, boolean), private.catchup_items_insert(uuid, uuid, jsonb), private.handle_outbox_job(private.outbox_jobs),
  private.handle_outbox_job_base(private.outbox_jobs) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'save_catchup_draft(uuid,uuid,uuid,uuid,text,text,jsonb)', 'submit_catchup_plan(uuid,uuid,uuid)', 'review_catchup_plan(uuid,uuid,uuid,text,text)', 'set_catchup_item_status(uuid,uuid,uuid,text,text)',
    'cancel_catchup_plan(uuid,uuid,uuid,text)', 'list_catchup_plans(uuid,uuid)', 'guardian_get_catchup_plan(uuid)', 'list_catchup_reviews(uuid)', 'set_checkin_policy(uuid,uuid,boolean,text)',
    'get_checkin_policy(uuid)', 'create_checkin(uuid,uuid,text,text)', 'my_checkins(uuid)', 'list_checkins(uuid,text)', 'answer_checkin(uuid,uuid,uuid,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
