-- 0016 Review cases also expose the linked vaccination event (needed to decide corrections and exceptions from the queue).
create or replace function public.list_review_cases(p_clinic_id uuid, p_status text default 'open', p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb;
begin
  if not (private.has_capability(p_clinic_id, 'guardian.verify') or private.has_capability(p_clinic_id, 'review.resolve') or private.has_capability(p_clinic_id, 'correction.approve')
          or private.has_capability(p_clinic_id, 'inventory.approve')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'createdAt'), '[]'::jsonb) into v_res from (
    select jsonb_build_object('caseId', k.id, 'kind', k.kind, 'status', k.status, 'reason', k.reason, 'createdAt', k.created_at, 'version', k.version,
             'evidence', k.evidence, 'childId', k.child_id, 'candidateChildId', k.candidate_child_id, 'eventId', k.vaccination_event_id, 'createdBy', k.created_by,
             'child', (select jsonb_build_object('displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob) from public.children c where c.id = k.child_id),
             'candidate', (select jsonb_build_object('displayName', c.display_name, 'localRecordNo', c.local_record_no, 'dob', c.dob) from public.children c where c.id = k.candidate_child_id
                             and private.child_in_clinic(c.id, p_clinic_id)),
             'guardianName', (select g.full_name from public.guardians g where g.id = k.guardian_id)) x
      from public.record_review_cases k
     where k.clinic_id = p_clinic_id and k.status = p_status
     order by k.created_at limit least(greatest(coalesce(p_limit, 50), 1), 100)) s;
  return v_res;
end $$;
revoke all on function public.list_review_cases(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.list_review_cases(uuid, text, integer) to authenticated;
