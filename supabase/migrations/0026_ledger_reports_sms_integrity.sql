-- Ledger repair, report exports, and SMS lease completion. Forward-only integrity fixes.

-- Every inventory command resolves its organization before touching a balance. The organization
-- advisory lock precedes every balance lock, including first postings and count approvals.
create function private.stock_org_lock(p_org uuid, p_exclusive boolean default false) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_org is null then raise exception 'organization is required' using errcode = 'CV422'; end if;
  if p_exclusive then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text, 2605));
  else
    perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended(p_org::text, 2605));
  end if;
end $$;

-- Placeholder anchor for generated report replacements.

create or replace function private.inventory_org(p_clinic uuid, p_cap text default 'inventory.manage') returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic, p_cap);
  perform private.stock_org_lock(v_org);
  return v_org;
end $$;

-- Clinical administrations and corrections reach the primitive without inventory_org. This
-- check also covers any future command that uses the primitive directly.
create or replace function private.post_movement(p_org uuid, p_tx uuid, p_location uuid, p_lot uuid, p_delta numeric, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_unit text; v_on numeric;
begin
  perform private.stock_org_lock(p_org);
  if p_delta = 0 then raise exception 'quantity must not be zero' using errcode = 'CV422'; end if;
  select p.stock_unit into v_unit from public.vaccine_lots l join public.vaccine_products p on p.id = l.product_id where l.id = p_lot and l.organization_id = p_org;
  if v_unit is null then raise exception 'unknown lot' using errcode = 'CV404'; end if;
  if p_delta < 0 then
    select on_hand into v_on from public.stock_balances where location_id = p_location and lot_id = p_lot for update;
    if coalesce(v_on, 0) + p_delta < 0 then raise exception 'insufficient stock' using errcode = 'CV409'; end if;
  end if;
  insert into public.stock_movements (organization_id, transaction_id, location_id, lot_id, quantity_delta, unit, movement_key, created_by)
  values (p_org, p_tx, p_location, p_lot, p_delta, v_unit, p_key, auth.uid());
end $$;

-- Defensive coverage for direct administrative inserts into the ledger. The trigger runs before
-- it takes the balance row lock; public roles still have no table write grant.
create or replace function private.apply_movement() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.stock_org_lock(new.organization_id);
  update public.stock_balances set on_hand = on_hand + new.quantity_delta, updated_at = now()
   where location_id = new.location_id and lot_id = new.lot_id;
  if not found then
    begin
      insert into public.stock_balances (organization_id, location_id, lot_id, on_hand) values (new.organization_id, new.location_id, new.lot_id, new.quantity_delta);
    exception when unique_violation then
      update public.stock_balances set on_hand = on_hand + new.quantity_delta, updated_at = now() where location_id = new.location_id and lot_id = new.lot_id;
    end;
  end if;
  return new;
end $$;

-- Reconciliation must not call inventory_org: a shared-to-exclusive advisory lock upgrade can
-- deadlock with another repair. Validate first, then take the required lock before the snapshot.
create or replace function public.reconcile_stock(p_operation_key uuid, p_clinic_id uuid, p_repair boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb; v_diff jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic_id, 'inventory.approve');
  perform private.stock_org_lock(v_org, coalesce(p_repair, false));
  v_prev := private.begin_command(v_org, p_operation_key, 'stock.reconcile', jsonb_build_object('c', p_clinic_id, 'repair', p_repair));
  if v_prev is not null then return v_prev; end if;
  select coalesce(jsonb_agg(jsonb_build_object('locationId', x.location_id, 'lotId', x.lot_id, 'ledger', x.ledger, 'projection', x.projection)), '[]'::jsonb) into v_diff from (
    select coalesce(l.location_id, b.location_id) location_id, coalesce(l.lot_id, b.lot_id) lot_id, coalesce(l.q, 0) ledger, coalesce(b.on_hand, 0) projection
      from (select m.location_id, m.lot_id, sum(m.quantity_delta) q from public.stock_movements m join public.stock_locations s on s.id = m.location_id where s.clinic_id = p_clinic_id group by 1, 2) l
      full join (select b2.location_id, b2.lot_id, b2.on_hand from public.stock_balances b2 join public.stock_locations s on s.id = b2.location_id where s.clinic_id = p_clinic_id) b
        on b.location_id = l.location_id and b.lot_id = l.lot_id
     where coalesce(l.q, 0) <> coalesce(b.on_hand, 0)) x;
  if p_repair and jsonb_array_length(v_diff) > 0 then
    insert into public.stock_balances (organization_id, location_id, lot_id, on_hand)
    select v_org, (d ->> 'locationId')::uuid, (d ->> 'lotId')::uuid, (d ->> 'ledger')::numeric from jsonb_array_elements(v_diff) d
    on conflict (location_id, lot_id) do update set on_hand = excluded.on_hand, allocated = least(public.stock_balances.allocated, excluded.on_hand), updated_at = now();
  end if;
  update public.stock_balances b set reconciled_at = now() from public.stock_locations s where s.id = b.location_id and s.clinic_id = p_clinic_id and (p_repair or jsonb_array_length(v_diff) = 0);
  perform private.audit(v_org, 'inventory.approve', 'stock.reconciled', 'clinic', p_clinic_id, null, jsonb_build_object('mismatches', jsonb_array_length(v_diff), 'repaired', p_repair and jsonb_array_length(v_diff) > 0), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('mismatches', v_diff, 'repaired', p_repair and jsonb_array_length(v_diff) > 0));
end $$;

create function private.audit_report_access(p_org uuid, p_clinic uuid, p_report text, p_from date, p_to date, p_export boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.audit(p_org, 'report.run', case when p_export then 'report.exported' else 'report.viewed' end,
    'clinic', p_clinic, null, jsonb_build_object('report', p_report, 'from', p_from, 'to', p_to,
    'smallCellThreshold', case when p_export then (select value from private.settings where key = 'report_small_cell_threshold') else null end), null);
end $$;

-- Report function replacements follow below.

create or replace function public.report_daily_activity(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_tz text; v_rows jsonb; v_supp boolean;
begin
  perform private.report_range(p_clinic_id, p_from, p_to);
  select timezone into v_tz from public.clinics where id = p_clinic_id;
  with days as (select d::date d from generate_series(p_from, p_to, interval '1 day') d),
  appt as (select s.service_date d,
             count(*) filter (where a.status in ('confirmed','checked_in','fulfilled')) booked,
             count(*) filter (where a.status = 'cancelled') cancelled,
             count(*) filter (where a.status = 'no_show') no_show
             from public.appointments a join public.clinic_sessions s on s.id = a.session_id
            where s.clinic_id = p_clinic_id and s.service_date between p_from and p_to group by 1),
  q as (select service_date d,
          count(*) filter (where status <> 'cancelled') arrivals,
          count(*) filter (where walk_in and status <> 'cancelled') walk_ins,
          count(*) filter (where status = 'completed') completed,
          count(*) filter (where status = 'deferred') deferred,
          count(*) filter (where status = 'left') left_n
          from public.queue_entries where clinic_id = p_clinic_id and service_date between p_from and p_to group by 1),
  v as (select cr.administered_on d, count(*) n from private.current_revisions cr
         where cr.clinic_id = p_clinic_id and cr.source = 'clinic_administered' and cr.event_status = 'active' and cr.administered_on between p_from and p_to group by 1),
  c as (select (ce.issued_at at time zone v_tz)::date d, count(*) n from public.certificates ce
         where ce.clinic_id = p_clinic_id and ce.issued_at is not null and (ce.issued_at at time zone v_tz)::date between p_from and p_to group by 1)
  select jsonb_agg(jsonb_build_object('date', days.d, 'booked', coalesce(appt.booked, 0), 'cancelled', coalesce(appt.cancelled, 0), 'noShow', coalesce(appt.no_show, 0),
           'arrivals', coalesce(q.arrivals, 0), 'walkIns', coalesce(q.walk_ins, 0), 'completed', coalesce(q.completed, 0), 'deferred', coalesce(q.deferred, 0), 'left', coalesce(q.left_n, 0),
           'vaccinationsGiven', private.export_cell(coalesce(v.n, 0), p_export), 'certificatesIssued', coalesce(c.n, 0)) order by days.d)
    into v_rows from days left join appt on appt.d = days.d left join q on q.d = days.d left join v on v.d = days.d left join c on c.d = days.d;
  v_supp := exists (select 1 from jsonb_array_elements(v_rows) r where r -> 'vaccinationsGiven' = 'null'::jsonb);
  perform private.audit_report_access(v_org, p_clinic_id, 'daily_activity', p_from, p_to, p_export);
  return jsonb_build_object('report', 'daily_activity', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', v_supp, 'definitions', private.report_definitions(), 'rows', coalesce(v_rows, '[]'::jsonb),
    'totals', case when v_supp then null else (select jsonb_build_object(
       'booked', sum((r ->> 'booked')::int), 'cancelled', sum((r ->> 'cancelled')::int), 'noShow', sum((r ->> 'noShow')::int), 'arrivals', sum((r ->> 'arrivals')::int), 'walkIns', sum((r ->> 'walkIns')::int),
       'completed', sum((r ->> 'completed')::int), 'deferred', sum((r ->> 'deferred')::int), 'left', sum((r ->> 'left')::int),
       'vaccinationsGiven', sum((r ->> 'vaccinationsGiven')::int), 'certificatesIssued', sum((r ->> 'certificatesIssued')::int)) from jsonb_array_elements(v_rows) r) end);
end $$;

create or replace function public.report_vaccinations_by_product(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_rows jsonb; v_supp boolean;
begin
  perform private.report_range(p_clinic_id, p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object('productCode', x.code, 'product', x.name, 'count', private.export_cell(x.n, p_export)) order by x.name), '[]'::jsonb) into v_rows from (
    select p.code, p.name, count(*) n from private.current_revisions cr join public.vaccine_products p on p.id = cr.product_id
     where cr.clinic_id = p_clinic_id and cr.source = 'clinic_administered' and cr.event_status = 'active' and cr.administered_on between p_from and p_to group by p.code, p.name) x;
  v_supp := exists (select 1 from jsonb_array_elements(v_rows) r where r -> 'count' = 'null'::jsonb);
  perform private.audit_report_access(v_org, p_clinic_id, 'vaccinations_by_product', p_from, p_to, p_export);
  return jsonb_build_object('report', 'vaccinations_by_product', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', v_supp, 'definitions', private.report_definitions(), 'rows', v_rows,
    'total', case when v_supp then null else (select coalesce(sum((r ->> 'count')::int), 0) from jsonb_array_elements(v_rows) r) end);
end $$;

create or replace function public.report_stock_summary(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_tz text; v_rows jsonb;
begin
  perform private.report_range(p_clinic_id, p_from, p_to);
  select timezone into v_tz from public.clinics where id = p_clinic_id;
  select coalesce(jsonb_agg(jsonb_build_object('productCode', p.code, 'product', p.name, 'lot', l.manufacturer_lot, 'expiresOn', l.expires_on, 'disposition', l.global_disposition,
           'received', x.received, 'issued', x.issued, 'wastage', x.wastage, 'adjustments', x.adjustments, 'onHand', x.on_hand, 'ledgerTotal', x.ledger_total,
           'reconciles', x.on_hand = x.ledger_total) order by p.name, l.expires_on, l.manufacturer_lot), '[]'::jsonb) into v_rows
    from (select m.lot_id,
            coalesce(sum(m.quantity_delta) filter (where t.type = 'receipt' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) received,
            -coalesce(sum(m.quantity_delta) filter (where t.type in ('issue_administration') and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0)
              - coalesce(sum(m.quantity_delta) filter (where t.type = 'reversal' and t.reason like 'correction:%' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) issued,
            -coalesce(sum(m.quantity_delta) filter (where t.type = 'wastage' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) wastage,
            coalesce(sum(m.quantity_delta) filter (where t.type = 'adjustment' and (m.occurred_at at time zone v_tz)::date between p_from and p_to), 0) adjustments,
            coalesce((select sum(b.on_hand) from public.stock_balances b join public.stock_locations s2 on s2.id = b.location_id where b.lot_id = m.lot_id and s2.clinic_id = p_clinic_id), 0) on_hand,
            sum(m.quantity_delta) ledger_total
            from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id join public.stock_locations s on s.id = m.location_id
           where s.clinic_id = p_clinic_id group by m.lot_id) x
    join public.vaccine_lots l on l.id = x.lot_id join public.vaccine_products p on p.id = l.product_id;
  perform private.audit_report_access(v_org, p_clinic_id, 'stock_summary', p_from, p_to, p_export);
  return jsonb_build_object('report', 'stock_summary', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', false, 'definitions', private.report_definitions(), 'rows', v_rows);
end $$;

create or replace function public.report_paper_reconciliation(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_rows jsonb; v_suppressed boolean;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if p_export then
    perform private.require_capability(p_clinic_id, 'report.run');
  elsif not (private.has_capability(p_clinic_id, 'report.run') or private.has_capability(p_clinic_id, 'vaccination.record')) then
    raise exception 'forbidden' using errcode = 'CV403';
  end if;
  perform private.report_range(p_clinic_id, p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object(
      'date', k.d, 'productCode', p.code, 'product', p.name,
      'paperCount', case when k.paper is null then null else private.export_cell(k.paper, p_export) end,
      'systemCount', private.export_cell(k.sys, p_export),
      'difference', case when p_export and (private.export_cell(k.paper, true) is null or private.export_cell(k.sys, true) is null)
                     then null else k.sys - coalesce(k.paper, 0) end,
      'status', case when p_export and (private.export_cell(k.paper, true) is null or private.export_cell(k.sys, true) is null)
                     then null when k.paper is null then 'no_paper_tally' when k.sys = k.paper then 'matches'
                     when k.sys > k.paper then 'system_higher' else 'paper_higher' end)
      || case when p_export then '{}'::jsonb else jsonb_build_object('note', k.note) end
      order by k.d, p.name), '[]'::jsonb) into v_rows
  from (
    select coalesce(s.d, t.d) d, coalesce(s.product_id, t.product_id) product_id, coalesce(s.n, 0) sys, t.paper_count paper, t.note
      from (select cr.administered_on d, cr.product_id, count(*) n from private.current_revisions cr
             where cr.clinic_id = p_clinic_id and cr.source = 'clinic_administered' and cr.event_status = 'active' and cr.administered_on between p_from and p_to group by 1, 2) s
      full join (select distinct on (service_date, product_id) service_date d, product_id, paper_count, note from public.paper_tallies
                  where clinic_id = p_clinic_id and service_date between p_from and p_to order by service_date, product_id, entered_at desc, id desc) t
        on t.d = s.d and t.product_id = s.product_id) k
  join public.vaccine_products p on p.id = k.product_id;
  v_suppressed := exists (select 1 from jsonb_array_elements(v_rows) r where r -> 'paperCount' = 'null'::jsonb or r -> 'systemCount' = 'null'::jsonb);
  perform private.audit_report_access(v_org, p_clinic_id, 'paper_reconciliation', p_from, p_to, p_export);
  return jsonb_build_object('report', 'paper_reconciliation', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', p_export and v_suppressed,
    'definitions', private.report_definitions(), 'rows', v_rows,
    'unresolved', case when p_export and v_suppressed then null else (select count(*) from jsonb_array_elements(v_rows) r where r ->> 'status' <> 'matches') end);
end $$;

-- Lease completion is bound to the claim generation. Remove the old five-argument entry point
-- so callers cannot bypass the generation check through a retained overload.
drop function private.mark_sms(uuid, text, text, text, text);
create function private.mark_sms(p_id uuid, p_expected_attempt integer, p_outcome text, p_provider text default null, p_provider_message_id text default null, p_error text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare m public.sms_messages;
begin
  select * into m from public.sms_messages where id = p_id for update;
  if m.id is null or m.status <> 'sending' or m.attempt_count is distinct from p_expected_attempt
     or m.locked_until is null or m.locked_until <= now() then return false; end if;
  if p_outcome = 'sent' then
    update public.sms_messages set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id, locked_until = null, last_error_code = null, updated_at = now() where id = m.id;
  elsif p_outcome = 'retry' and m.attempt_count < 5 then
    update public.sms_messages set status = 'queued', locked_until = null, last_error_code = left(p_error, 60), available_at = now() + make_interval(mins => power(2, m.attempt_count)::int), updated_at = now() where id = m.id;
  else
    update public.sms_messages set status = 'failed', locked_until = null, last_error_code = left(coalesce(p_error, 'failed'), 60), updated_at = now() where id = m.id;
  end if;
  return true;
end $$;

revoke all on function private.stock_org_lock(uuid, boolean), private.inventory_org(uuid, text), private.post_movement(uuid, uuid, uuid, uuid, numeric, text),
  private.apply_movement(), private.audit_report_access(uuid, uuid, text, date, date, boolean), private.mark_sms(uuid, integer, text, text, text, text)
  from public, anon, authenticated;
