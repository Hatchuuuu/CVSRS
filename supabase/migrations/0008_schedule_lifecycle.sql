-- 0008 Clinical master data + schedule lifecycle: import -> review -> approve -> activate -> retire.
-- Blueprint refs: BP16 (rule lifecycle), BP38 P35/P36, F35, T31 (partly).
-- Separation of duties: a technical admin can import/stage master data; clinical activation requires rules.approve held by a
-- DIFFERENT person than the proposer. Demo versions can only exist while private.settings.demo_mode is true.

create function private.require_any(p_clinic uuid, p_caps text[]) returns void language plpgsql stable security definer set search_path = '' as $$
declare c text;
begin
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  foreach c in array p_caps loop
    if private.has_capability(p_clinic, c) then return; end if;
  end loop;
  raise exception 'forbidden' using errcode = 'CV403';
end $$;

-- ---------------------------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------------------------
create function public.create_antigen(p_operation_key uuid, p_clinic_id uuid, p_code text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_id uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['admin.config','rules.propose']);
  v_prev := private.begin_command(v_org, p_operation_key, 'antigen.create', jsonb_build_object('c', p_clinic_id, 'code', p_code, 'name', p_name));
  if v_prev is not null then return v_prev; end if;
  insert into public.antigens (organization_id, code, name, created_by, updated_by) values (v_org, btrim(p_code), btrim(p_name), auth.uid(), auth.uid()) returning id into v_id;
  perform private.audit(v_org, 'master_data', 'antigen.created', 'antigen', v_id, null, jsonb_build_object('code', p_code), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('antigenId', v_id, 'status', 'draft'));
end $$;

create function public.create_vaccine_product(p_operation_key uuid, p_clinic_id uuid, p_product jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_id uuid; v_code text; v_a uuid; v_ac text; v_n int := 0;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['admin.config','rules.propose']);
  v_prev := private.begin_command(v_org, p_operation_key, 'product.create', jsonb_build_object('c', p_clinic_id, 'p', p_product));
  if v_prev is not null then return v_prev; end if;
  if p_product is null or jsonb_typeof(p_product) <> 'object' then raise exception 'product required' using errcode = 'CV400'; end if;
  if coalesce(jsonb_array_length(p_product -> 'antigenCodes'), 0) = 0 then raise exception 'a product must map to at least one antigen' using errcode = 'CV422'; end if;
  begin
    insert into public.vaccine_products (organization_id, code, name, manufacturer, presentation, stock_unit, doses_per_container, administration_unit, policy_reference, created_by, updated_by)
    values (v_org, btrim(p_product ->> 'code'), btrim(p_product ->> 'name'), nullif(btrim(coalesce(p_product ->> 'manufacturer', '')), ''), btrim(p_product ->> 'presentation'),
            btrim(p_product ->> 'stockUnit'), (p_product ->> 'dosesPerContainer')::numeric, btrim(p_product ->> 'administrationUnit'), coalesce(p_product ->> 'policyReference', ''), auth.uid(), auth.uid())
    returning id into v_id;
  exception when invalid_text_representation or not_null_violation then
    raise exception 'product details are incomplete or invalid' using errcode = 'CV422';
  end;
  for v_ac in select jsonb_array_elements_text(p_product -> 'antigenCodes') loop
    select id into v_a from public.antigens where organization_id = v_org and code = v_ac and status <> 'retired';
    if v_a is null then raise exception 'unknown antigen code %', v_ac using errcode = 'CV422'; end if;
    insert into public.product_antigens (organization_id, product_id, antigen_id, created_by) values (v_org, v_id, v_a, auth.uid());
    v_n := v_n + 1;
  end loop;
  perform private.audit(v_org, 'master_data', 'product.created', 'vaccine_product', v_id, null, jsonb_build_object('code', p_product ->> 'code', 'antigens', v_n), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('productId', v_id, 'status', 'draft'));
end $$;

-- Activation/retirement of master data is a clinical governance act: rules.approve, and not the creator.
create function public.set_master_status(p_operation_key uuid, p_clinic_id uuid, p_kind text, p_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_creator uuid; v_cur text;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  if p_kind not in ('antigen','product') or p_status not in ('active','retired') then raise exception 'invalid request' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'master.set_status', jsonb_build_object('c', p_clinic_id, 'k', p_kind, 'id', p_id, 's', p_status));
  if v_prev is not null then return v_prev; end if;
  if p_kind = 'antigen' then
    select created_by, status into v_creator, v_cur from public.antigens where id = p_id and organization_id = v_org for update;
  else
    select created_by, status into v_creator, v_cur from public.vaccine_products where id = p_id and organization_id = v_org for update;
  end if;
  if v_cur is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if p_status = 'active' then
    if v_cur <> 'draft' then raise exception 'only draft items can be activated' using errcode = 'CV409'; end if;
    if v_creator = auth.uid() then raise exception 'activation requires a different person than the creator' using errcode = 'CV403'; end if;
    if p_kind = 'product' and exists (select 1 from public.product_antigens pa join public.antigens a on a.id = pa.antigen_id where pa.product_id = p_id and a.status <> 'active') then
      raise exception 'all mapped antigens must be active first' using errcode = 'CV409';
    end if;
  elsif v_cur = 'retired' then raise exception 'already retired' using errcode = 'CV409';
  end if;
  if p_kind = 'antigen' then update public.antigens set status = p_status, updated_by = auth.uid() where id = p_id;
  else update public.vaccine_products set status = p_status, updated_by = auth.uid() where id = p_id; end if;
  perform private.audit(v_org, 'rules.approve', 'master.' || p_kind || '.' || p_status, p_kind, p_id, jsonb_build_object('status', v_cur), jsonb_build_object('status', p_status), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('id', p_id, 'status', p_status));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Schedule import (draft)
-- ---------------------------------------------------------------------------------------------
create function public.import_schedule_draft(p_operation_key uuid, p_clinic_id uuid, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; v_ver uuid; v_demo boolean; v_program text; v_label text; v_src text;
  x jsonb; dep jsonb; fx jsonb; v_ant uuid; v_seq int; v_code text; v_ids jsonb := '{}'::jsonb; v_seqs jsonb := '{}'::jsonb;
  v_rid uuid; v_pid uuid; v_from date; v_to date; v_rules int := 0; v_deps int := 0; v_fx int := 0;
  allowed_status text[] := array['completed','not_yet_eligible','upcoming','due_today','due_now','overdue','past_recommended_date','staff_review_needed','not_applicable'];
  v_key text; v_val text; v_p text; v_d jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.propose');
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.import', jsonb_build_object('c', p_clinic_id, 'p', p_payload));
  if v_prev is not null then return v_prev; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload required' using errcode = 'CV400'; end if;

  v_demo := coalesce((p_payload ->> 'isDemo')::boolean, false);
  v_program := coalesce(nullif(btrim(p_payload ->> 'programCode'), ''), 'routine');
  v_label := nullif(btrim(coalesce(p_payload ->> 'versionLabel', '')), '');
  v_src := btrim(coalesce(p_payload ->> 'sourceReference', ''));
  if v_label is null then raise exception 'versionLabel is required' using errcode = 'CV422'; end if;
  if v_demo and not private.setting_bool('demo_mode') then raise exception 'demo schedules can only be imported while demo mode is on' using errcode = 'CV403'; end if;
  if not v_demo and v_src = '' then raise exception 'a real schedule must cite its authoritative source (sourceReference)' using errcode = 'CV422'; end if;
  if jsonb_typeof(p_payload -> 'rules') <> 'array' or jsonb_array_length(p_payload -> 'rules') not between 1 and 200 then raise exception 'rules must be an array of 1-200 items' using errcode = 'CV422'; end if;
  if jsonb_typeof(coalesce(p_payload -> 'fixtures', '[]'::jsonb)) <> 'array' then raise exception 'fixtures must be an array' using errcode = 'CV422'; end if;
  begin
    v_from := nullif(p_payload ->> 'effectiveFrom', '')::date; v_to := nullif(p_payload ->> 'effectiveTo', '')::date;
    perform (p_payload -> 'cohort' ->> 'dobFrom')::date, (p_payload -> 'cohort' ->> 'dobTo')::date;
  exception when others then raise exception 'invalid date in payload' using errcode = 'CV422';
  end;

  insert into public.schedule_versions (organization_id, program_code, version_label, status, is_demo, effective_from, effective_to, cohort_predicate, source_reference, source_hash, proposed_by, created_by, updated_by)
  values (v_org, v_program, v_label, 'draft', v_demo, v_from, v_to, coalesce(p_payload -> 'cohort', '{}'::jsonb), v_src, nullif(p_payload ->> 'sourceHash', ''), auth.uid(), auth.uid(), auth.uid())
  returning id into v_ver;

  for x in select * from jsonb_array_elements(p_payload -> 'rules') loop
    begin
      v_seq := (x ->> 'sequence')::int; v_code := btrim(x ->> 'requirement');
    exception when others then raise exception 'rule sequence must be an integer' using errcode = 'CV422';
    end;
    if v_seq is null or v_seq < 1 or v_code is null or v_code = '' then raise exception 'each rule needs a positive sequence and a requirement code' using errcode = 'CV422'; end if;
    if v_seqs ? v_code or exists (select 1 from jsonb_each_text(v_seqs) e where e.value = v_seq::text) then raise exception 'duplicate rule requirement or sequence: %', v_code using errcode = 'CV422'; end if;
    select id into v_ant from public.antigens where organization_id = v_org and code = x ->> 'antigen' and status <> 'retired';
    if v_ant is null then raise exception 'unknown antigen % in rule %', x ->> 'antigen', v_code using errcode = 'CV422'; end if;
    if not (private.valid_age(x -> 'targetOffset') and private.valid_age(x -> 'minimumAge') and private.valid_age(x -> 'maximumAge')
            and private.valid_age(x #> '{dueWindow,start}') and private.valid_age(x #> '{dueWindow,end}')) then
      raise exception 'invalid age/offset in rule % (value must be 0-9999 with unit days|weeks|months)', v_code using errcode = 'CV422';
    end if;
    if jsonb_typeof(coalesce(x -> 'acceptedProducts', '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(x -> 'reviewConditions', '[]'::jsonb)) <> 'array' then
      raise exception 'acceptedProducts/reviewConditions must be arrays' using errcode = 'CV422';
    end if;
    for v_p in select jsonb_array_elements_text(coalesce(x -> 'acceptedProducts', '[]'::jsonb)) loop
      if not exists (select 1 from public.vaccine_products where organization_id = v_org and code = v_p and status <> 'retired') then
        raise exception 'unknown product code % in rule %', v_p, v_code using errcode = 'CV422';
      end if;
    end loop;
    if exists (select 1 from jsonb_array_elements_text(coalesce(x -> 'reviewConditions', '[]'::jsonb)) c where c <> 'clinician_review_required') then
      raise exception 'unsupported review condition in rule %', v_code using errcode = 'CV422';
    end if;
    insert into public.schedule_rules (organization_id, schedule_version_id, sequence_no, requirement_code, antigen_id, series_code, dose_ordinal, target_offset, minimum_age, maximum_age, due_window, review_conditions, accepted_products, created_by)
    values (v_org, v_ver, v_seq, v_code, v_ant, coalesce(nullif(btrim(x ->> 'series'), ''), v_code), coalesce((x ->> 'ordinal')::int, 1), x -> 'targetOffset', x -> 'minimumAge', x -> 'maximumAge', x -> 'dueWindow',
            coalesce(x -> 'reviewConditions', '[]'::jsonb), coalesce(x -> 'acceptedProducts', '[]'::jsonb), auth.uid())
    returning id into v_rid;
    v_ids := v_ids || jsonb_build_object(v_code, v_rid);
    v_seqs := v_seqs || jsonb_build_object(v_code, v_seq);
    v_rules := v_rules + 1;
  end loop;

  for dep in select * from jsonb_array_elements(coalesce(p_payload -> 'dependencies', '[]'::jsonb)) loop
    v_rid := (v_ids ->> (dep ->> 'rule'))::uuid; v_pid := (v_ids ->> (dep ->> 'predecessor'))::uuid;
    if v_rid is null or v_pid is null then raise exception 'dependency references an unknown requirement' using errcode = 'CV422'; end if;
    -- Predecessors must come earlier in sequence, which makes the dependency graph acyclic by construction.
    if (v_seqs ->> (dep ->> 'predecessor'))::int >= (v_seqs ->> (dep ->> 'rule'))::int then raise exception 'a predecessor must have a lower sequence than its dependent rule' using errcode = 'CV422'; end if;
    v_d := dep -> 'minimumInterval';
    if v_d is null or not private.valid_age(v_d) then raise exception 'invalid minimumInterval' using errcode = 'CV422'; end if;
    insert into public.schedule_rule_dependencies (organization_id, rule_id, predecessor_rule_id, minimum_interval_value, interval_unit, created_by)
    values (v_org, v_rid, v_pid, (v_d ->> 'value')::int, v_d ->> 'unit', auth.uid());
    v_deps := v_deps + 1;
  end loop;

  for fx in select * from jsonb_array_elements(coalesce(p_payload -> 'fixtures', '[]'::jsonb)) loop
    if nullif(btrim(fx ->> 'name'), '') is null or jsonb_typeof(fx -> 'expected') <> 'object' then raise exception 'each fixture needs a name and expected statuses' using errcode = 'CV422'; end if;
    for v_key, v_val in select key, value from jsonb_each_text(fx -> 'expected') loop
      if not (v_ids ? v_key) then raise exception 'fixture % expects unknown requirement %', fx ->> 'name', v_key using errcode = 'CV422'; end if;
      if v_val <> all (allowed_status) then raise exception 'fixture % uses unknown status %', fx ->> 'name', v_val using errcode = 'CV422'; end if;
    end loop;
    begin
      insert into public.schedule_fixtures (organization_id, schedule_version_id, name, dob, doses, as_of, expected, created_by)
      values (v_org, v_ver, btrim(fx ->> 'name'), (fx ->> 'dob')::date, coalesce(fx -> 'doses', '[]'::jsonb), (fx ->> 'asOf')::date, fx -> 'expected', auth.uid());
    exception when invalid_text_representation or datetime_field_overflow or not_null_violation then
      raise exception 'fixture % has an invalid or missing date', fx ->> 'name' using errcode = 'CV422';
    end;
    v_fx := v_fx + 1;
  end loop;

  perform private.audit(v_org, 'rules.propose', 'schedule.imported', 'schedule_version', v_ver, null,
                        jsonb_build_object('program', v_program, 'label', v_label, 'demo', v_demo, 'rules', v_rules, 'dependencies', v_deps, 'fixtures', v_fx), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', v_ver, 'status', 'draft', 'rules', v_rules, 'dependencies', v_deps, 'fixtures', v_fx));
end $$;

create function public.submit_schedule_for_review(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; sv public.schedule_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.propose');
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.submit', jsonb_build_object('c', p_clinic_id, 'v', p_version_id));
  if v_prev is not null then return v_prev; end if;
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if sv.status <> 'draft' then raise exception 'only drafts can be submitted' using errcode = 'CV409'; end if;
  if not exists (select 1 from public.schedule_fixtures where schedule_version_id = sv.id) then raise exception 'add at least one fixture case before review' using errcode = 'CV422'; end if;
  update public.schedule_versions set status = 'clinical_review', updated_by = auth.uid() where id = sv.id;
  perform private.audit(v_org, 'rules.propose', 'schedule.submitted', 'schedule_version', sv.id, jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'clinical_review'), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', sv.id, 'status', 'clinical_review'));
end $$;

create function public.approve_schedule(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; sv public.schedule_versions; v_fx jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.approve', jsonb_build_object('c', p_clinic_id, 'v', p_version_id, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if sv.status <> 'clinical_review' then raise exception 'version is not awaiting review' using errcode = 'CV409'; end if;
  if sv.proposed_by = auth.uid() then raise exception 'the proposer cannot approve their own schedule' using errcode = 'CV403'; end if;
  v_fx := private.run_fixtures(sv.id);
  if jsonb_array_length(v_fx) = 0 or exists (select 1 from jsonb_array_elements(v_fx) f where not (f ->> 'passed')::boolean) then
    raise exception 'fixture cases must all pass before approval' using errcode = 'CV422';
  end if;
  update public.schedule_versions set status = 'approved', approved_by = auth.uid(), reviewed_by = auth.uid(), approved_at = now(), updated_by = auth.uid() where id = sv.id;
  perform private.audit(v_org, 'rules.approve', 'schedule.approved', 'schedule_version', sv.id, jsonb_build_object('status', sv.status), jsonb_build_object('status', 'approved', 'fixtures', jsonb_array_length(v_fx)), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', sv.id, 'status', 'approved'));
end $$;

create function public.activate_schedule(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid, p_effective_from date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; sv public.schedule_versions; old public.schedule_versions; v_fx jsonb; v_today date; v_affected int;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.activate', jsonb_build_object('c', p_clinic_id, 'v', p_version_id, 'from', p_effective_from));
  if v_prev is not null then return v_prev; end if;
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if sv.status <> 'approved' then raise exception 'only approved versions can be activated' using errcode = 'CV409'; end if;
  if sv.is_demo and not private.setting_bool('demo_mode') then raise exception 'demo schedules cannot be activated outside demo mode' using errcode = 'CV403'; end if;
  v_today := private.local_today(p_clinic_id);
  if p_effective_from is null or p_effective_from < v_today then raise exception 'effective date must be today or later' using errcode = 'CV422'; end if;
  v_fx := private.run_fixtures(sv.id);
  if jsonb_array_length(v_fx) = 0 or exists (select 1 from jsonb_array_elements(v_fx) f where not (f ->> 'passed')::boolean) then
    raise exception 'fixture cases must all pass before activation' using errcode = 'CV422';
  end if;
  -- Lock the program row set, then retire the version in force so exactly one stays active (BP16).
  select * into old from public.schedule_versions where organization_id = v_org and program_code = sv.program_code and status = 'active' for update;
  if found then
    if p_effective_from <= old.effective_from then raise exception 'new version must take effect after the current one (%)', old.effective_from using errcode = 'CV422'; end if;
    update public.schedule_versions set status = 'retired', effective_to = p_effective_from - 1, updated_by = auth.uid() where id = old.id;
  end if;
  update public.schedule_versions set status = 'active', effective_from = p_effective_from, supersedes_id = old.id, updated_by = auth.uid() where id = sv.id;
  select count(*) into v_affected from public.child_programs where organization_id = v_org and program_code = sv.program_code and status = 'active';
  perform private.audit(v_org, 'rules.approve', 'schedule.activated', 'schedule_version', sv.id, jsonb_build_object('previous', old.id),
                        jsonb_build_object('effectiveFrom', p_effective_from, 'childrenToRecalculate', v_affected), null);
  -- Recalculation is lazy: the next evaluation of each child pins the new version; old evaluations keep their own reference.
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', sv.id, 'status', 'active', 'effectiveFrom', p_effective_from, 'childrenToRecalculate', v_affected));
end $$;

create function public.retire_schedule(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; sv public.schedule_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'rules.approve');
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.retire', jsonb_build_object('c', p_clinic_id, 'v', p_version_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if sv.status not in ('active','approved') then raise exception 'only approved or active versions can be retired' using errcode = 'CV409'; end if;
  -- Manual retirement stops use immediately: the effective window ends yesterday (clinic-local).
  update public.schedule_versions set status = 'retired', effective_to = private.local_today(p_clinic_id) - 1, updated_by = auth.uid() where id = sv.id;
  perform private.audit(v_org, 'rules.approve', 'schedule.retired', 'schedule_version', sv.id, jsonb_build_object('status', sv.status), jsonb_build_object('status', 'retired'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', sv.id, 'status', 'retired'));
end $$;

create function public.discard_schedule_draft(p_operation_key uuid, p_clinic_id uuid, p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; sv public.schedule_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['rules.propose','rules.approve']);
  v_prev := private.begin_command(v_org, p_operation_key, 'schedule.discard', jsonb_build_object('c', p_clinic_id, 'v', p_version_id));
  if v_prev is not null then return v_prev; end if;
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if sv.status <> 'draft' then raise exception 'only drafts can be discarded' using errcode = 'CV409'; end if;
  delete from public.schedule_rule_dependencies where rule_id in (select id from public.schedule_rules where schedule_version_id = sv.id);
  delete from public.schedule_fixtures where schedule_version_id = sv.id;
  delete from public.schedule_rules where schedule_version_id = sv.id;
  delete from public.schedule_versions where id = sv.id;
  perform private.audit(v_org, 'rules.propose', 'schedule.discarded', 'schedule_version', sv.id, jsonb_build_object('label', sv.version_label), null, null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('versionId', sv.id, 'discarded', true));
end $$;

-- ---------------------------------------------------------------------------------------------
-- Reads for the configuration pages
-- ---------------------------------------------------------------------------------------------
create function public.list_clinical_master(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['admin.config','rules.propose','rules.approve']);
  return jsonb_build_object(
    'demoMode', private.setting_bool('demo_mode'),
    'antigens', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'code', a.code, 'name', a.name, 'status', a.status, 'createdBy', a.created_by) order by a.code) from public.antigens a where a.organization_id = v_org), '[]'::jsonb),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'presentation', p.presentation, 'status', p.status, 'createdBy', p.created_by,
        'antigens', coalesce((select jsonb_agg(a.code order by a.code) from public.product_antigens pa join public.antigens a on a.id = pa.antigen_id where pa.product_id = p.id), '[]'::jsonb)) order by p.code)
        from public.vaccine_products p where p.organization_id = v_org), '[]'::jsonb),
    'schedules', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'program', s.program_code, 'label', s.version_label, 'status', s.status, 'isDemo', s.is_demo,
        'effectiveFrom', s.effective_from, 'effectiveTo', s.effective_to, 'proposedBy', s.proposed_by, 'approvedBy', s.approved_by,
        'rules', (select count(*) from public.schedule_rules r where r.schedule_version_id = s.id),
        'fixtures', (select count(*) from public.schedule_fixtures f where f.schedule_version_id = s.id)) order by s.created_at desc)
        from public.schedule_versions s where s.organization_id = v_org), '[]'::jsonb));
end $$;

create function public.get_schedule_version(p_clinic_id uuid, p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; sv public.schedule_versions;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['admin.config','rules.propose','rules.approve']);
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', sv.id, 'program', sv.program_code, 'label', sv.version_label, 'status', sv.status, 'isDemo', sv.is_demo, 'source', sv.source_reference,
    'effectiveFrom', sv.effective_from, 'effectiveTo', sv.effective_to, 'cohort', sv.cohort_predicate, 'proposedBy', sv.proposed_by, 'approvedBy', sv.approved_by, 'version', sv.version,
    'rules', coalesce((select jsonb_agg(jsonb_build_object('sequence', r.sequence_no, 'requirement', r.requirement_code, 'antigen', a.code, 'series', r.series_code, 'ordinal', r.dose_ordinal,
        'targetOffset', r.target_offset, 'minimumAge', r.minimum_age, 'maximumAge', r.maximum_age, 'dueWindow', r.due_window, 'acceptedProducts', r.accepted_products,
        'dependsOn', coalesce((select jsonb_agg(jsonb_build_object('predecessor', pr.requirement_code, 'interval', jsonb_build_object('value', d.minimum_interval_value, 'unit', d.interval_unit)))
                                 from public.schedule_rule_dependencies d join public.schedule_rules pr on pr.id = d.predecessor_rule_id where d.rule_id = r.id), '[]'::jsonb)) order by r.sequence_no)
        from public.schedule_rules r join public.antigens a on a.id = r.antigen_id where r.schedule_version_id = sv.id), '[]'::jsonb),
    'fixtures', private.run_fixtures(sv.id));
end $$;

create function public.preview_schedule_impact(p_clinic_id uuid, p_version_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; sv public.schedule_versions; v_match int; v_moving int;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_any(p_clinic_id, array['rules.propose','rules.approve']);
  select * into sv from public.schedule_versions where id = p_version_id and organization_id = v_org;
  if not found then return null; end if;
  select count(*) into v_match from public.children c
   where c.organization_id = v_org and c.record_status in ('provisional','active') and c.dob is not null
     and (sv.cohort_predicate ->> 'dobFrom' is null or c.dob >= (sv.cohort_predicate ->> 'dobFrom')::date)
     and (sv.cohort_predicate ->> 'dobTo' is null or c.dob <= (sv.cohort_predicate ->> 'dobTo')::date);
  select count(*) into v_moving from public.child_programs cp where cp.organization_id = v_org and cp.program_code = sv.program_code and cp.status = 'active' and cp.schedule_version_id <> sv.id;
  return jsonb_build_object('cohortChildren', v_match, 'childrenOnAnotherVersion', v_moving);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_antigen(uuid,uuid,text,text)', 'create_vaccine_product(uuid,uuid,jsonb)', 'set_master_status(uuid,uuid,text,uuid,text)',
    'import_schedule_draft(uuid,uuid,jsonb)', 'submit_schedule_for_review(uuid,uuid,uuid)', 'approve_schedule(uuid,uuid,uuid,text)',
    'activate_schedule(uuid,uuid,uuid,date)', 'retire_schedule(uuid,uuid,uuid,text)', 'discard_schedule_draft(uuid,uuid,uuid)',
    'list_clinical_master(uuid)', 'get_schedule_version(uuid,uuid)', 'preview_schedule_impact(uuid,uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_capability(uuid, text), private.clinics_with(text), private.session_ok(),
  private.my_guardian_ids(), private.guardian_can_read_child(uuid) to authenticated;
