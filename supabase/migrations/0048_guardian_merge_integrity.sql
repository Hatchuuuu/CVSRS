-- Keep verified guardian access when a merge collides with an unverified link.
-- Only the shared implementation changes; the scheduling/hold wrapper and existing ACLs remain.
create or replace function public.merge_children_prev(p_operation_key uuid, p_clinic_id uuid, p_survivor uuid, p_duplicate uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; s public.children; d public.children; rel record; existing public.guardian_child_relationships;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'review.resolve');
  if p_survivor = p_duplicate then raise exception 'cannot merge a record into itself' using errcode = 'CV422'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'reason required' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'child.merge', jsonb_build_object('clinic', p_clinic_id, 's', p_survivor, 'd', p_duplicate, 'reason', p_reason));
  if v_prev is not null then return v_prev; end if;
  -- Lock in a stable order to avoid deadlocks between concurrent merges.
  perform 1 from public.children where id in (p_survivor, p_duplicate) order by id for update;
  select * into s from public.children where id = p_survivor and organization_id = v_org;
  select * into d from public.children where id = p_duplicate and organization_id = v_org;
  if s.id is null or d.id is null or not private.child_in_clinic(s.id, p_clinic_id) or not private.child_in_clinic(d.id, p_clinic_id) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  if s.record_status = 'merged' or d.record_status = 'merged' then raise exception 'record already merged' using errcode = 'CV409'; end if;

  -- Retain current verified access over an unverified or expired link; preserve a survivor's suspension.
  for rel in select * from public.guardian_child_relationships where child_id = d.id and status in ('provisional','active','suspended') for update loop
    select * into existing from public.guardian_child_relationships x
     where x.child_id = s.id and x.guardian_id = rel.guardian_id and x.status in ('provisional','active','suspended') for update;
    if existing.id is not null and (existing.status = 'provisional'
       or (existing.status = 'active' and existing.ends_at <= now())) and rel.status = 'active'
       and (rel.ends_at is null or rel.ends_at > now()) then
      -- Retain the verified row and its evidence; a suspended survivor still requires explicit restoration.
      update public.guardian_child_relationships set status = 'revoked', ends_at = now(), updated_by = auth.uid() where id = existing.id;
      update public.guardian_child_relationships set child_id = s.id, updated_by = auth.uid() where id = rel.id;
    elsif existing.id is not null then
      update public.guardian_child_relationships set status = 'revoked', ends_at = now(), updated_by = auth.uid() where id = rel.id;
    else
      update public.guardian_child_relationships set child_id = s.id, updated_by = auth.uid() where id = rel.id;
    end if;
  end loop;
  -- Enrollments: survivor inherits the clinic enrollment if missing; the duplicate's are closed.
  insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, access_scope, basis, created_by, updated_by)
  select v_org, s.id, e.clinic_id, case when s.record_status = 'active' then 'active' else 'pending' end, false,
         case when s.record_status = 'active' then 'care' else 'review_only' end, 'merge', auth.uid(), auth.uid()
    from public.child_clinic_enrollments e
   where e.child_id = d.id and e.status in ('pending','active')
     and not exists (select 1 from public.child_clinic_enrollments y where y.child_id = s.id and y.clinic_id = e.clinic_id and y.status in ('pending','active'));
  update public.child_clinic_enrollments set status = 'closed', is_primary = false, ends_at = now(), updated_by = auth.uid()
   where child_id = d.id and status in ('pending','active');
  update public.qr_passes set status = 'revoked', revoked_at = now(), updated_by = auth.uid() where child_id = d.id and status = 'active';
  update public.children set record_status = 'merged', merged_into_id = s.id, updated_by = auth.uid() where id = d.id;
  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'merged', 'survivor', s.id, 'duplicate', d.id)
   where kind = 'duplicate' and status in ('open','in_review') and least(child_id, candidate_child_id) = least(s.id, d.id) and greatest(child_id, candidate_child_id) = greatest(s.id, d.id);
  perform private.audit(v_org, 'review.resolve', 'child.merged', 'child', d.id,
                        jsonb_build_object('localRecordNo', d.local_record_no), jsonb_build_object('mergedInto', s.id, 'survivorRecordNo', s.local_record_no), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('survivorId', s.id, 'mergedId', d.id));
end $$;
