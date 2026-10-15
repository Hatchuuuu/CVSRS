-- Closed locations cannot acquire stock. Inventory postings already hold the shared
-- organization lock; closing takes its exclusive counterpart before checking balances.
-- This avoids adding location row locks to multi-location transfers in inconsistent order.
create or replace function private.apply_movement() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.stock_org_lock(new.organization_id);
  if not exists (select 1 from public.stock_locations l
                  where l.id = new.location_id and l.organization_id = new.organization_id and l.status = 'active') then
    raise exception 'the stock location is closed or unavailable' using errcode = 'CV409';
  end if;
  update public.stock_balances set on_hand = on_hand + new.quantity_delta, updated_at = now()
   where location_id = new.location_id and lot_id = new.lot_id;
  if not found then
    begin
      insert into public.stock_balances (organization_id, location_id, lot_id, on_hand)
      values (new.organization_id, new.location_id, new.lot_id, new.quantity_delta);
    exception when unique_violation then
      update public.stock_balances set on_hand = on_hand + new.quantity_delta, updated_at = now()
       where location_id = new.location_id and lot_id = new.lot_id;
    end;
  end if;
  return new;
end $$;

create or replace function public.close_stock_location(p_operation_key uuid, p_clinic_id uuid, p_location_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; l public.stock_locations;
begin
  -- Do not call inventory_org here: upgrading a shared lock while another closer
  -- holds a shared lock would deadlock. Authorize, then acquire exclusive directly.
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'inventory.manage');
  perform private.stock_org_lock(v_org, true);
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.location_close', jsonb_build_object('c', p_clinic_id, 'l', p_location_id, 'r', p_reason));
  if v_prev is not null then return v_prev; end if;
  select * into l from public.stock_locations where id = p_location_id and organization_id = v_org and clinic_id = p_clinic_id for update;
  if not found then raise exception 'not found' using errcode = 'CV404'; end if;
  if l.status <> 'active' then raise exception 'the location is already closed' using errcode = 'CV409'; end if;
  if l.kind = 'in_transit' then raise exception 'the transit location is managed by the system' using errcode = 'CV409'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'a reason is required' using errcode = 'CV422'; end if;
  if exists (select 1 from public.stock_balances b where b.location_id = l.id and (b.on_hand <> 0 or b.allocated <> 0)) then
    raise exception 'move or record all stock at this location before closing it' using errcode = 'CV409';
  end if;
  if exists (select 1 from public.stock_transfers t where (t.from_location_id = l.id or t.to_location_id = l.id) and t.status = 'in_transit') then
    raise exception 'a transfer to or from this location is still in transit' using errcode = 'CV409';
  end if;
  update public.stock_locations set status = 'closed', updated_by = auth.uid() where id = l.id;
  perform private.audit(v_org, 'inventory.manage', 'stock.location_closed', 'stock_location', l.id, jsonb_build_object('status', 'active'), jsonb_build_object('status', 'closed'), p_reason);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('locationId', l.id, 'status', 'closed'));
end $$;

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
  select coalesce(on_hand, 0) into v_book from public.stock_balances where location_id = p_location_id and lot_id = p_lot_id;
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

-- CREATE OR REPLACE preserves the existing explicit ACLs.
revoke all on function private.apply_movement() from public, anon, authenticated;
revoke all on function public.close_stock_location(uuid, uuid, uuid, text),
  public.propose_stock_adjustment(uuid, uuid, uuid, uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.close_stock_location(uuid, uuid, uuid, text),
  public.propose_stock_adjustment(uuid, uuid, uuid, uuid, numeric, text, text) to authenticated;
