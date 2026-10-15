-- A newly identified lot differs from an unknown lot: validate, record and issue it atomically.
-- Preserve the full current correction command and its existing authenticated-only grants.
-- Reverse the outstanding stock issue for this event, never an issue an earlier correction already reversed.
-- CREATE OR REPLACE retains existing grants; all validation, event locking and receipt behavior is preserved.
create or replace function public.approve_correction(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid; v_prev jsonb; k public.record_review_cases; cur public.vaccination_revisions; v_kind text; v_prop jsonb; v_new_lot uuid; v_new_loc uuid; v_old_tx public.stock_transactions; v_old_mv public.stock_movements;
  v_lot public.vaccine_lots; v_child uuid := null; v_tx uuid; v_rev uuid; v_on date; v_at timestamptz; v_route text; v_site text; v_status text; v_stock jsonb := '[]'::jsonb; v_tz text; v_eval1 jsonb; v_eval2 jsonb;
  v_prod uuid; v_effect text; v_new_child uuid; v_ev_status text;
begin
  select organization_id, timezone into v_org, v_tz from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'correction.approve');
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'correction' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'correction.approve', jsonb_build_object('c', p_clinic_id, 'case', p_case_id, 'n', p_note));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'already decided' using errcode = 'CV409'; end if;
  if k.created_by = auth.uid() then raise exception 'the proposer cannot approve their own correction' using errcode = 'CV403'; end if;
  perform 1 from public.vaccination_events where id = k.vaccination_event_id for update;
  select * into cur from private.current_revisions where event_id = k.vaccination_event_id;
  if cur.revision_no <> (k.evidence ->> 'baseRevision')::int then raise exception 'the record changed since this correction was requested; request it again' using errcode = 'CV409'; end if;
  v_kind := k.evidence ->> 'kind'; v_prop := k.evidence -> 'proposal';
  v_on := cur.administered_on; v_at := cur.administered_at; v_route := cur.route; v_site := cur.site; v_prod := cur.product_id; v_new_lot := cur.lot_id; v_status := cur.verification_status; v_ev_status := cur.event_status;
  v_new_child := cur.child_id;

  if v_kind = 'correct_details' then
    if nullif(v_prop ->> 'administeredAt', '') is not null then v_at := (v_prop ->> 'administeredAt')::timestamptz; v_on := (v_at at time zone v_tz)::date; end if;
    if v_at > now() + interval '5 minutes' then raise exception 'the administration time cannot be in the future' using errcode = 'CV422'; end if;
    if v_prop ? 'route' then v_route := nullif(left(btrim(v_prop ->> 'route'), 40), ''); end if;
    if v_prop ? 'site' then v_site := nullif(left(btrim(v_prop ->> 'site'), 40), ''); end if;
    if nullif(v_prop ->> 'lotId', '') is not null and (v_prop ->> 'lotId')::uuid is distinct from cur.lot_id then
      -- The physical fact changed (a different vial was used): compensate the ledger, do not rewrite it (BP19).
      select * into v_lot from public.vaccine_lots where id = (v_prop ->> 'lotId')::uuid and organization_id = v_org;
      if v_lot.id is null then raise exception 'unknown lot' using errcode = 'CV422'; end if;
      v_new_loc := nullif(v_prop ->> 'locationId', '')::uuid;
      if v_new_loc is null then raise exception 'name the stock location of the correct lot' using errcode = 'CV422'; end if;
      select t.* into v_old_tx from public.stock_transactions t where t.event_id = cur.event_id and t.type = 'issue_administration'
        and not exists (select 1 from public.stock_transactions reversed where reversed.reverses_id = t.id)
        order by t.created_at, t.id limit 1;
      if v_old_tx.id is not null then
        select m.* into v_old_mv from public.stock_movements m where m.transaction_id = v_old_tx.id limit 1;
        insert into public.stock_transactions (organization_id, clinic_id, type, event_id, reason, approved_by, operation_id, reverses_id, created_by)
        values (v_org, p_clinic_id, 'reversal', cur.event_id, 'correction: wrong lot recorded', auth.uid(), p_operation_key, v_old_tx.id, auth.uid()) returning id into v_tx;
        perform private.post_movement(v_org, v_tx, v_old_mv.location_id, v_old_mv.lot_id, -v_old_mv.quantity_delta, 'corr-rev:' || p_operation_key);
        v_stock := v_stock || jsonb_build_object('reversed', v_old_tx.id);
      end if;
      v_tx := private.issue_for_administration(v_org, p_clinic_id, v_new_loc, v_lot.id, 1, cur.event_id, p_operation_key); -- refuses if the correct lot cannot supply it
      v_stock := v_stock || jsonb_build_object('issued', v_tx);
      v_new_lot := v_lot.id; v_prod := v_lot.product_id;
    end if;
  elsif v_kind = 'reattribute_child' then
    v_new_child := private.canonical_child((v_prop ->> 'toChildId')::uuid);
    if not private.child_in_clinic(v_new_child, p_clinic_id) or v_new_child = cur.child_id then raise exception 'the correct child must be a different child enrolled at this clinic' using errcode = 'CV422'; end if;
  else -- void_duplicate
    v_effect := v_prop ->> 'stockEffect';
    v_ev_status := 'voided';
    select t.* into v_old_tx from public.stock_transactions t where t.event_id = cur.event_id and t.type = 'issue_administration'
        and not exists (select 1 from public.stock_transactions reversed where reversed.reverses_id = t.id)
        order by t.created_at, t.id limit 1;
    if v_old_tx.id is not null and v_effect in ('return_to_stock','wastage') then
      select m.* into v_old_mv from public.stock_movements m where m.transaction_id = v_old_tx.id limit 1;
      insert into public.stock_transactions (organization_id, clinic_id, type, event_id, reason, approved_by, operation_id, reverses_id, created_by)
      values (v_org, p_clinic_id, 'reversal', cur.event_id, 'correction: duplicate record voided', auth.uid(), p_operation_key, v_old_tx.id, auth.uid()) returning id into v_tx;
      perform private.post_movement(v_org, v_tx, v_old_mv.location_id, v_old_mv.lot_id, -v_old_mv.quantity_delta, 'void-rev:' || p_operation_key);
      v_stock := v_stock || jsonb_build_object('reversed', v_old_tx.id);
      if v_effect = 'wastage' then
        -- The vial was physically used or spoiled: it is NOT returned to usable stock, it is reclassified as wastage.
        insert into public.stock_transactions (organization_id, clinic_id, type, event_id, reason, approved_by, operation_id, created_by)
        values (v_org, p_clinic_id, 'wastage', cur.event_id, 'duplicate record: dose physically lost', auth.uid(), p_operation_key, auth.uid()) returning id into v_tx;
        perform private.post_movement(v_org, v_tx, v_old_mv.location_id, v_old_mv.lot_id, v_old_mv.quantity_delta, 'void-waste:' || p_operation_key);
        v_stock := v_stock || jsonb_build_object('wastage', v_tx);
      end if;
    end if;
  end if;

  insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, reported_product_text, administered_on, administered_at, date_precision, lot_id, reported_lot, expiry_snapshot,
                                             quantity, unit, route, site, administered_by, external_vaccinator, clinic_id, source, verification_status, event_status, approved_by, signed_at, reason, created_by)
  values (v_org, cur.event_id, cur.revision_no + 1, v_new_child, v_prod, cur.reported_product_text, v_on, v_at, cur.date_precision, v_new_lot,
          cur.reported_lot, coalesce((select expires_on from public.vaccine_lots where id = v_new_lot), cur.expiry_snapshot), cur.quantity, cur.unit, v_route, v_site, cur.administered_by, cur.external_vaccinator, cur.clinic_id,
          cur.source, cur.verification_status, v_ev_status, auth.uid(), now(), coalesce(p_note, k.reason), auth.uid()) returning id into v_rev;

  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'approved', 'newRevision', cur.revision_no + 1, 'stock', v_stock, 'note', p_note) where id = k.id;
  -- Recalculate downstream credit for every child whose facts changed (T16); certificates are reviewed in the certificate module.
  v_eval1 := private.compute_child_schedule(private.canonical_child(cur.child_id), private.local_today(p_clinic_id), true);
  if v_new_child <> cur.child_id then v_eval2 := private.compute_child_schedule(v_new_child, private.local_today(p_clinic_id), true); end if;
  perform private.enqueue(v_org, 'certificate.review', 'vaccination_event', cur.event_id, 'cert-review:' || v_rev::text, jsonb_build_object('event', cur.event_id, 'revision', cur.revision_no + 1));
  perform private.audit(v_org, 'correction.approve', 'correction.approved', 'vaccination_event', cur.event_id,
                        jsonb_build_object('revision', cur.revision_no, 'lot', cur.lot_id, 'child', cur.child_id), jsonb_build_object('revision', cur.revision_no + 1, 'lot', v_new_lot, 'child', v_new_child, 'kind', v_kind, 'stock', v_stock), coalesce(p_note, k.reason));
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('eventId', cur.event_id, 'revisionNo', cur.revision_no + 1, 'kind', v_kind, 'stock', v_stock));
end $$;

