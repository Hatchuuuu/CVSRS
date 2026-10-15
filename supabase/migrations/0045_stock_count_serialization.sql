-- Serialize physical counts against the current balance, including the first count for a location and lot.
-- CREATE OR REPLACE retains the commands' existing authenticated-only grants.
create or replace function public.propose_stock_adjustment(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_lot_id uuid, p_observed numeric, p_count_reference text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := private.inventory_org(p_clinic_id); v_prev jsonb; v_book numeric; v_delta numeric; v_thr numeric; v_case uuid; v_tx uuid; v_can_approve boolean;
begin
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.adjust', jsonb_build_object('c', p_clinic_id, 'loc', p_location_id, 'lot', p_lot_id, 'obs', p_observed, 'ref', p_count_reference, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  if p_observed is null or p_observed < 0 then raise exception 'observed count must be zero or more' using errcode = 'CV422'; end if;
  if p_count_reference is null or length(btrim(p_count_reference)) = 0 or p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'count reference and reason are required' using errcode = 'CV422'; end if;
  if not exists (select 1 from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id) then raise exception 'not found' using errcode = 'CV404'; end if;
  if not exists (select 1 from public.stock_locations where id = p_location_id and status = 'active') then
    raise exception 'the stock location is closed' using errcode = 'CV409';
  end if;
  if not exists (select 1 from public.vaccine_lots where id = p_lot_id and organization_id = v_org) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  -- A first count needs a row to lock too; concurrent postings wait on this same balance.
  insert into public.stock_balances (organization_id, location_id, lot_id, on_hand)
  values (v_org, p_location_id, p_lot_id, 0) on conflict (location_id, lot_id) do nothing;
  select coalesce(on_hand, 0) into v_book from public.stock_balances where location_id = p_location_id and lot_id = p_lot_id for update;
  v_book := coalesce(v_book, 0);
  v_delta := p_observed - v_book;
  if v_delta = 0 then return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'no_difference', 'book', v_book)); end if;
  v_thr := coalesce((select (value)::text::numeric from private.settings where key = 'adjustment_auto_approve_units'), 0);
  v_can_approve := private.has_capability(p_clinic_id, 'inventory.approve');
  if abs(v_delta) <= v_thr or v_can_approve then
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'adjustment', p_count_reference, p_reason, case when v_can_approve then auth.uid() end, p_operation_key, auth.uid()) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, p_location_id, p_lot_id, v_delta, 'adjust:' || p_operation_key);
    perform private.audit(v_org, 'inventory.manage', 'stock.adjusted', 'vaccine_lot', p_lot_id, jsonb_build_object('book', v_book), jsonb_build_object('observed', p_observed, 'delta', v_delta), p_reason);
    return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'posted', 'delta', v_delta, 'transactionId', v_tx));
  end if;
  insert into public.record_review_cases (organization_id, clinic_id, kind, reason, evidence, created_by, updated_by)
  values (v_org, p_clinic_id, 'stock', 'stock count difference awaiting approval',
          jsonb_build_object('locationId', p_location_id, 'lotId', p_lot_id, 'book', v_book, 'observed', p_observed, 'delta', v_delta, 'countReference', p_count_reference, 'reason', p_reason, 'operationKey', p_operation_key),
          auth.uid(), auth.uid()) returning id into v_case;
  perform private.audit(v_org, 'inventory.manage', 'stock.adjustment_proposed', 'review_case', v_case, jsonb_build_object('book', v_book), jsonb_build_object('observed', p_observed), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'pending_approval', 'caseId', v_case, 'delta', v_delta));
end $$;

create or replace function public.approve_stock_adjustment(p_operation_key uuid, p_clinic_id uuid, p_case_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.inventory_org(p_clinic_id, 'inventory.approve'); v_prev jsonb; k public.record_review_cases; v_book numeric; v_tx uuid; v_delta numeric; v_loc uuid; v_lot uuid;
begin
  select * into k from public.record_review_cases where id = p_case_id and organization_id = v_org and clinic_id = p_clinic_id and kind = 'stock' for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.approve_adjustment', jsonb_build_object('c', p_clinic_id, 'case', p_case_id));
  if v_prev is not null then return v_prev; end if;
  if k.status not in ('open','in_review') then raise exception 'case already decided' using errcode = 'CV409'; end if;
  -- Short deliveries and care-without-stock cases are also kind 'stock' but carry no count: they are decided where they came from.
  if k.evidence ->> 'observed' is null or k.evidence ->> 'locationId' is null or k.evidence ->> 'lotId' is null then
    raise exception 'this stock case is not a count adjustment; decide it from the transfer or the visit record it came from' using errcode = 'CV409';
  end if;
  if k.created_by = auth.uid() then raise exception 'the proposer cannot approve their own adjustment' using errcode = 'CV403'; end if;
  v_loc := (k.evidence ->> 'locationId')::uuid; v_lot := (k.evidence ->> 'lotId')::uuid;
  -- Re-derive the delta from the observed count against the CURRENT book balance (stock may have moved since the proposal).
  if not exists (select 1 from public.vaccine_lots where id = v_lot and organization_id = v_org) then
    raise exception 'not found' using errcode = 'CV404';
  end if;
  if not exists (select 1 from public.stock_locations where id = v_loc and organization_id = v_org and clinic_id = p_clinic_id and status = 'active') then
    raise exception 'the stock location is closed or unavailable' using errcode = 'CV409';
  end if;
  -- Materialize an empty balance before locking so simultaneous first approvals cannot double the count.
  insert into public.stock_balances (organization_id, location_id, lot_id, on_hand)
  values (v_org, v_loc, v_lot, 0) on conflict (location_id, lot_id) do nothing;
  select coalesce(on_hand, 0) into v_book from public.stock_balances where location_id = v_loc and lot_id = v_lot for update;
  v_book := coalesce(v_book, 0);
  v_delta := (k.evidence ->> 'observed')::numeric - v_book;
  if v_delta <> 0 then
    insert into public.stock_transactions (organization_id, clinic_id, type, source_reference, reason, approved_by, operation_id, created_by)
    values (v_org, p_clinic_id, 'adjustment', k.evidence ->> 'countReference', k.evidence ->> 'reason', auth.uid(), p_operation_key, k.created_by) returning id into v_tx;
    perform private.post_movement(v_org, v_tx, v_loc, v_lot, v_delta, 'adjust:' || p_operation_key);
  end if;
  update public.record_review_cases set status = 'resolved', resolved_by = auth.uid(), resolved_at = now(), updated_by = auth.uid(),
         resolution = jsonb_build_object('decision', 'approved', 'postedDelta', v_delta, 'transactionId', v_tx) where id = k.id;
  perform private.audit(v_org, 'inventory.approve', 'stock.adjustment_approved', 'review_case', k.id, null, jsonb_build_object('delta', v_delta), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('status', 'posted', 'delta', v_delta, 'transactionId', v_tx));
end $$;
