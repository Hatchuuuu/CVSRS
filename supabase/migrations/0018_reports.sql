-- 0018 Operational reports and paper reconciliation. Blueprint refs: F33, BP27 (exports), BP31, M08.
--  * Reports are clinic-scoped aggregates computed from the same facts the care screens use (current revisions, ledger, queue).
--    They never take numbers from a cache and never include names or other identifiers.
--  * Every report returns its metric definitions and a definitions version so a printed figure can be interpreted later.
--  * Exports (CSV, produced by the app) apply small-cell suppression using a privacy-owner threshold setting
--    (default 0 = off; the right value Requires external validation) and are audited.
--  * Paper reconciliation compares paper-log tallies entered later with what the system holds; it never edits either side.

insert into private.settings(key, value) values ('report_small_cell_threshold', '0'::jsonb) on conflict (key) do nothing;

create table public.paper_tallies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  clinic_id uuid not null,
  service_date date not null,
  product_id uuid not null,
  paper_count integer not null check (paper_count between 0 and 10000),
  note text,
  entered_by uuid not null references public.profiles (id),
  entered_at timestamptz not null default now(),
  operation_id uuid not null unique,
  foreign key (organization_id, clinic_id) references public.clinics (organization_id, id),
  foreign key (organization_id, product_id) references public.vaccine_products (organization_id, id)
);
create index paper_tallies_lookup_idx on public.paper_tallies (clinic_id, service_date, product_id, entered_at desc);
create trigger paper_tallies_immutable before update or delete on public.paper_tallies for each row execute function private.forbid_change();
create trigger paper_tallies_no_truncate before truncate on public.paper_tallies for each statement execute function private.forbid_change();
alter table public.paper_tallies enable row level security;
revoke all on public.paper_tallies from anon, authenticated;

create function private.report_definitions() returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('version', 'r1', 'terms', jsonb_build_object(
    'booked', 'Appointments in a session on that date that are confirmed, checked in or fulfilled.',
    'cancelled', 'Appointments in a session on that date that were cancelled.',
    'noShow', 'Appointments in a session on that date marked no-show by staff.',
    'arrivals', 'Queue tickets issued that date, excluding tickets cancelled at the desk.',
    'walkIns', 'Arrivals without an appointment.',
    'completed', 'Arrivals whose visit ended with service completed.',
    'deferred', 'Arrivals whose visit ended deferred by a clinician.',
    'left', 'Arrivals marked as having left before service.',
    'vaccinationsGiven', 'Vaccinations given at this clinic on that date, counted once per event using its latest revision; voided events are excluded. One dose = one event.',
    'certificatesIssued', 'Certificates that reached the issued state on that date (local clinic date).',
    'received', 'Units received into stock in the period (ledger receipts).',
    'issued', 'Units issued for administration in the period, net of reversals.',
    'wastage', 'Units recorded as wastage in the period.',
    'adjustments', 'Net units from approved count adjustments in the period.',
    'onHand', 'Units on hand now according to the stock projection.',
    'ledgerTotal', 'Sum of every ledger movement for the lot at this clinic. It must equal onHand.',
    'paperCount', 'Doses written in the paper log for that date and product, as entered later by staff (latest entry counts).',
    'systemCount', 'Vaccinations given in the system for that date and product (see vaccinationsGiven).',
    'difference', 'systemCount minus paperCount. Zero means the two agree; any other value needs a staff explanation, not an edit.'))
$$;

create function private.report_range(p_clinic uuid, p_from date, p_to date) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'choose a start date that is not after the end date' using errcode = 'CV422'; end if;
  if p_to - p_from > 365 then raise exception 'a report can cover at most 366 days' using errcode = 'CV422'; end if;
end $$;

-- Small-cell rule for exports: counts between 1 and threshold-1 are withheld.
create function private.export_cell(p_n bigint, p_export boolean) returns bigint language sql stable security definer set search_path = '' as $$
  select case when p_export and p_n > 0 and p_n < coalesce((select (value)::text::int from private.settings where key = 'report_small_cell_threshold'), 0) then null else p_n end
$$;

create function private.report_org(p_clinic uuid, p_cap text default 'report.run') returns uuid language plpgsql stable security definer set search_path = '' as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.clinics where id = p_clinic;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  perform private.require_capability(p_clinic, p_cap);
  return v_org;
end $$;

create function public.report_daily_activity(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
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
  if not p_export then perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'daily_activity', 'from', p_from, 'to', p_to), null); end if;
  return jsonb_build_object('report', 'daily_activity', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', v_supp, 'definitions', private.report_definitions(), 'rows', coalesce(v_rows, '[]'::jsonb),
    'totals', case when v_supp then null else (select jsonb_build_object(
       'booked', sum((r ->> 'booked')::int), 'cancelled', sum((r ->> 'cancelled')::int), 'noShow', sum((r ->> 'noShow')::int), 'arrivals', sum((r ->> 'arrivals')::int), 'walkIns', sum((r ->> 'walkIns')::int),
       'completed', sum((r ->> 'completed')::int), 'deferred', sum((r ->> 'deferred')::int), 'left', sum((r ->> 'left')::int),
       'vaccinationsGiven', sum((r ->> 'vaccinationsGiven')::int), 'certificatesIssued', sum((r ->> 'certificatesIssued')::int)) from jsonb_array_elements(v_rows) r) end);
end $$;

create function public.report_vaccinations_by_product(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_rows jsonb; v_supp boolean;
begin
  perform private.report_range(p_clinic_id, p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object('productCode', x.code, 'product', x.name, 'count', private.export_cell(x.n, p_export)) order by x.name), '[]'::jsonb) into v_rows from (
    select p.code, p.name, count(*) n from private.current_revisions cr join public.vaccine_products p on p.id = cr.product_id
     where cr.clinic_id = p_clinic_id and cr.source = 'clinic_administered' and cr.event_status = 'active' and cr.administered_on between p_from and p_to group by p.code, p.name) x;
  v_supp := exists (select 1 from jsonb_array_elements(v_rows) r where r -> 'count' = 'null'::jsonb);
  if not p_export then perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'vaccinations_by_product', 'from', p_from, 'to', p_to), null); end if;
  return jsonb_build_object('report', 'vaccinations_by_product', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', v_supp, 'definitions', private.report_definitions(), 'rows', v_rows,
    'total', case when v_supp then null else (select coalesce(sum((r ->> 'count')::int), 0) from jsonb_array_elements(v_rows) r) end);
end $$;

create function public.report_stock_summary(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
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
            coalesce((select sum(b.on_hand) from public.stock_balances b join public.stock_locations s on s.id = b.location_id where b.lot_id = m.lot_id and s.clinic_id = p_clinic_id), 0) on_hand,
            sum(m.quantity_delta) ledger_total
            from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id
           where t.clinic_id = p_clinic_id group by m.lot_id) x
    join public.vaccine_lots l on l.id = x.lot_id join public.vaccine_products p on p.id = l.product_id;
  if not p_export then perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'stock_summary', 'from', p_from, 'to', p_to), null); end if;
  return jsonb_build_object('report', 'stock_summary', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', false, 'definitions', private.report_definitions(), 'rows', v_rows);
end $$;

create function public.report_backlog(p_clinic_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id);
begin
  perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'backlog'), null);
  return jsonb_build_object('report', 'backlog', 'asOf', now(), 'definitions', jsonb_build_object('version', 'r1', 'terms', jsonb_build_object(
      'openReviewCases', 'Review cases still open or in review, by type.', 'pendingOutsideDoses', 'Doses reported as given elsewhere that staff have not yet verified or rejected.',
      'provisionalChildren', 'Children enrolled here whose identity has not been confirmed.', 'pendingGuardianLinks', 'Guardian links waiting for in-person verification.',
      'pendingCertificates', 'Certificates prepared but not yet issued (document not stored).', 'failedMessages', 'Notification jobs that failed permanently.')),
    'openReviewCases', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (select kind, count(*) n from public.record_review_cases where clinic_id = p_clinic_id and status in ('open','in_review') group by kind) k),
    'pendingOutsideDoses', (select count(*) from private.current_revisions cr where cr.verification_status = 'pending_verification' and cr.event_status = 'active'
                              and private.child_in_clinic(private.canonical_child(cr.child_id), p_clinic_id)),
    'provisionalChildren', (select count(*) from public.children c join public.child_clinic_enrollments e on e.child_id = c.id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where c.record_status = 'provisional' and c.merged_into_id is null),
    'pendingGuardianLinks', (select count(*) from public.guardian_child_relationships r join public.child_clinic_enrollments e on e.child_id = r.child_id and e.clinic_id = p_clinic_id and e.status in ('pending','active') where r.status = 'provisional'),
    'pendingCertificates', (select count(*) from public.certificates where clinic_id = p_clinic_id and status = 'pending'),
    'failedMessages', (select count(*) from private.outbox_jobs where organization_id = v_org and status = 'failed'));
end $$;

-- Paper reconciliation ---------------------------------------------------------------------------------------------
create function public.record_paper_tally(p_operation_key uuid, p_clinic_id uuid, p_service_date date, p_product_id uuid, p_paper_count integer, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_prev jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not (private.has_capability(p_clinic_id, 'report.run') or private.has_capability(p_clinic_id, 'vaccination.record')) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  if p_service_date is null or p_service_date > private.local_today(p_clinic_id) then raise exception 'the paper log date cannot be in the future' using errcode = 'CV422'; end if;
  if p_paper_count is null or p_paper_count < 0 or p_paper_count > 10000 then raise exception 'enter the number of doses written on the paper log' using errcode = 'CV422'; end if;
  if not exists (select 1 from public.vaccine_products where id = p_product_id and organization_id = v_org) then raise exception 'unknown product' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'paper.tally', jsonb_build_object('c', p_clinic_id, 'd', p_service_date, 'p', p_product_id, 'n', p_paper_count, 'note', p_note));
  if v_prev is not null then return v_prev; end if;
  insert into public.paper_tallies (organization_id, clinic_id, service_date, product_id, paper_count, note, entered_by, operation_id)
  values (v_org, p_clinic_id, p_service_date, p_product_id, p_paper_count, left(nullif(btrim(p_note), ''), 300), auth.uid(), p_operation_key);
  perform private.audit(v_org, 'report.run', 'paper.tally', 'clinic', p_clinic_id, null, jsonb_build_object('date', p_service_date, 'product', p_product_id, 'count', p_paper_count), p_note);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('recorded', true));
end $$;

create function public.report_paper_reconciliation(p_clinic_id uuid, p_from date, p_to date, p_export boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_rows jsonb;
begin
  select organization_id into v_org from public.clinics where id = p_clinic_id;
  if v_org is null then raise exception 'not found' using errcode = 'CV404'; end if;
  if auth.uid() is null then raise exception 'unauthenticated' using errcode = 'CV401'; end if;
  if not (private.has_capability(p_clinic_id, 'report.run') or private.has_capability(p_clinic_id, 'vaccination.record')) then raise exception 'forbidden' using errcode = 'CV403'; end if;
  perform private.report_range(p_clinic_id, p_from, p_to);
  select coalesce(jsonb_agg(jsonb_build_object('date', k.d, 'productCode', p.code, 'product', p.name, 'paperCount', k.paper, 'systemCount', k.sys, 'difference', k.sys - coalesce(k.paper, 0), 'note', k.note,
           'status', case when k.paper is null then 'no_paper_tally' when k.sys = k.paper then 'matches' when k.sys > k.paper then 'system_higher' else 'paper_higher' end) order by k.d, p.name), '[]'::jsonb) into v_rows
  from (
    select coalesce(s.d, t.d) d, coalesce(s.product_id, t.product_id) product_id, coalesce(s.n, 0) sys, t.paper_count paper, t.note
      from (select cr.administered_on d, cr.product_id, count(*) n from private.current_revisions cr
             where cr.clinic_id = p_clinic_id and cr.source = 'clinic_administered' and cr.event_status = 'active' and cr.administered_on between p_from and p_to group by 1, 2) s
      full join (select distinct on (service_date, product_id) service_date d, product_id, paper_count, note from public.paper_tallies
                  where clinic_id = p_clinic_id and service_date between p_from and p_to order by service_date, product_id, entered_at desc) t
        on t.d = s.d and t.product_id = s.product_id) k
  join public.vaccine_products p on p.id = k.product_id;
  if not p_export then perform private.audit(v_org, 'report.run', 'report.viewed', 'clinic', p_clinic_id, null, jsonb_build_object('report', 'paper_reconciliation', 'from', p_from, 'to', p_to), null); end if;
  return jsonb_build_object('report', 'paper_reconciliation', 'from', p_from, 'to', p_to, 'asOf', now(), 'suppressed', false, 'definitions', private.report_definitions(), 'rows', v_rows,
    'unresolved', (select count(*) from jsonb_array_elements(v_rows) r where r ->> 'status' <> 'matches'));
end $$;

-- Exports leave the system, so each one is audited (who, which report, which period) and uses the small-cell rule.
create function public.record_report_export(p_operation_key uuid, p_clinic_id uuid, p_report text, p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := private.report_org(p_clinic_id); v_prev jsonb;
begin
  if p_report not in ('daily_activity','vaccinations_by_product','stock_summary','paper_reconciliation') then raise exception 'unknown report' using errcode = 'CV422'; end if;
  v_prev := private.begin_command(v_org, p_operation_key, 'report.export', jsonb_build_object('c', p_clinic_id, 'r', p_report, 'f', p_from, 't', p_to));
  if v_prev is not null then return v_prev; end if;
  perform private.audit(v_org, 'report.run', 'report.exported', 'clinic', p_clinic_id, null, jsonb_build_object('report', p_report, 'from', p_from, 'to', p_to, 'smallCellThreshold', (select value from private.settings where key = 'report_small_cell_threshold')), null);
  return private.finish_command(v_org, p_operation_key, jsonb_build_object('exported', true));
end $$;

revoke all on function private.report_definitions(), private.report_range(uuid, date, date), private.export_cell(bigint, boolean), private.report_org(uuid, text) from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'report_daily_activity(uuid,date,date,boolean)', 'report_vaccinations_by_product(uuid,date,date,boolean)', 'report_stock_summary(uuid,date,date,boolean)', 'report_backlog(uuid)',
    'record_paper_tally(uuid,uuid,date,uuid,integer,text)', 'report_paper_reconciliation(uuid,date,date,boolean)', 'record_report_export(uuid,uuid,text,date,date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
