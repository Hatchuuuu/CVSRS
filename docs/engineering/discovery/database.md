# Database / business-rule / data-integrity discovery (iteration 1)

Date: 2026-10-01/02. Model: claude-opus-5-5. Scope: `supabase/migrations/0001`–`0033` as applied to a disposable database, the SQL business logic, and catalog-level security posture. Read-only on migrations and source.

Method:

- I built `cvsrs_audit_db` from bootstrap plus all 33 migrations: `CVSRS_TEST_DB_NAME=cvsrs_audit_db npx vitest run --config vitest.db.config.ts`. All 316 tests in 19 files passed on that database.
- I dumped the final function definitions with `pg_get_functiondef` to `.local/audit-scratch/database/final-functions.sql` (6,370 lines) and audited the final bodies, not only the migration text.
- I ran a catalog check script (`catalog-checks.sql`, output in `catalog-checks.out`).
- I ran probes as real `authenticated`/`anon` roles with JWT claims, using the `tests/db/helpers.ts` pattern. The files are `*.probe.ts`, run with `.local/audit-scratch/database/vitest.probe.config.ts`.
- I loaded synthetic volume (100k children, 200k revisions, 300k audit rows, 200k outbox rows) to test query plans.

All scratch evidence is in `.local/audit-scratch/database/`.

Summary: P0 0 · P1 2 · P2 2 · P3 3.

## Whole-schema security posture (mechanical proof): PASS

Source: `.local/audit-scratch/database/catalog-checks.sql`. Every check below returned zero rows or the expected set.

1. All 57 `public` base tables have RLS enabled. Seven policies exist, all `SELECT` except `profiles_update_own`. There is no `using (true)` write policy. The only `using (true)` policy is `barangays_read`, which is SELECT on reference geography.
2. Grants to `anon`/`authenticated`:
   - Table-level grants are SELECT only, on `barangays`, `public_clinics`, `children`, `guardians`, `guardian_child_relationships`, `profiles` and `staff_memberships`.
   - Every granted table has a matching SELECT policy.
   - The only write grant is the column grant `UPDATE (display_name, locale)` on `profiles`.
   - No `private` table is granted to anyone.
3. All 161 `public` functions are `SECURITY DEFINER` with `search_path=""`. All 98 `private` functions pin `search_path=""` except three immutable non-definer constant functions: `capability_vocab`, `clinical_caps`, `role_preset`.
4. No `public`/`private` function is executable by `PUBLIC`.
   - `anon` can execute exactly `list_public_clinics()`, `public_queue_display(uuid)` and `verify_certificate(text)`.
   - `authenticated` can execute only five `private` RLS helpers (`session_ok`, `my_guardian_ids`, `guardian_can_read_child`, `clinics_with`, `has_capability`). Each answers only about the caller.
5. Upgrade compatibility of 0025–0033:
   - The renamed bodies are all non-executable by API roles: the six `*_prev` from 0025 and the two `*_base` from 0022.
   - `mark_sms` and `store_certificate_pdf` were dropped and recreated with new signatures. Their grants were re-applied (0026:236, 0027:70), and no old overload remains.
   - The only remaining overload is `private.child_eval_inputs(uuid)` / `(uuid,date)`. It is intentional and revoked.
   - The `create or replace` replacements in 0026/0029/0030/0031/0032/0033 keep their ACLs. I confirmed this in the catalog: none has gained `anon`.
6. Runtime roles (0028):
   - `cvsrs_outbox_worker` can execute only `process_outbox`, `claim_sms` and `mark_sms`.
   - `cvsrs_sms_webhook` can execute only `record_sms_event`.
   - Neither role has table grants.

## Prior `docs/audit/data-audit.md` findings: current state

| Prior finding | State | Where fixed |
|---|---|---|
| Historical evaluation includes future doses/holds | Fixed | `child_eval_inputs(p_child,p_as_of)` filters doses and holds by effective date (0025:278-303) |
| Walk-in capacity race | Fixed | Per clinic/day advisory lock in the `check_in` wrapper (0025:70-72) |
| Cancelled session appointment check-in | Fixed | 0025:63-68 |
| Merged child's appointments unusable | Fixed | Appointments and queue entries move to the survivor; collisions are cancelled with audit (0025:122-133) |
| Guardian booking not bound to clinic enrollment | Fixed | 0025:34-36. Reschedule keeps the same clinic (`reschedule_appointment_prev` `sn.clinic_id <> so.clinic_id`) |
| Reconcile repair vs concurrent posting | Fixed | Org advisory lock: shared for postings, exclusive for repair (0026:5-90) |
| Report export audit bypass | Fixed | Every report call audits viewed/exported (0026:92-98) |
| Certificate render race / unbound PDF | Fixed | Row lock in `begin_certificate_render`, token + content hash binding, HMAC attestation (0027) |
| Paper reconciliation ignores small cells | Fixed | 0026:177-214 |
| SMS stale completion | Fixed | `mark_sms(p_expected_attempt)` plus a lease check (0026:216-234). Provider idempotency by message id remains a documented provider contract (`src/lib/sms/provider.ts:3`) |
| Record transfer vs booking race | Fixed | Both serialize on the child row (0025:33, 0025:96) |
| Multiple confirmed sessions per child/day | Still open | See DB-07 |

## Findings

### DB-01 — Active clinical hold disappears when the held record is merged into another child
- Priority: P1
- Class: Reproduced defect
- Location:
  - `supabase/migrations/0003_registry.sql:735-779` (`merge_children_prev` moves relationships and enrollments but not `clinical_holds`)
  - `supabase/migrations/0025_scheduling_integrity.sql:100-135` (merge wrapper moves appointments and queue only)
  - `supabase/migrations/0025_scheduling_integrity.sql:295-298` (`child_eval_inputs` reads holds with `h.child_id = p_child`; doses use `child_ids_with_aliases`)
  - `supabase/migrations/0022_followup_holds_privacy.sql:31,51,58-69` (place, release and list read holds by canonical id only)
- Evidence: `.local/audit-scratch/database/a-isolation.probe.ts` → `a-isolation.out`. Steps: a hold is placed on child D, D is merged into survivor S, then S is read back. Output:
  ```
  hold.before_merge.check_planned_dose(dup): {"blocked":true,"reasons":["clinical_hold"],...}
  hold.after_merge.rows: [{"child_id":"<D>","status":"active"}]
  hold.after_merge.list_clinical_holds(survivor): []
  hold.after_merge.list_clinical_holds(dupId): []          -- canonicalised to S
  hold.after_merge.check_planned_dose(survivor): {"blocked":false,"credited":["A1"],...}
  hold.after_merge.evaluate(survivor).reasons: ["A1:overdue:after_due_window", ...]  -- no clinical_hold
  ```
- Impact:
  - A clinician-placed hold silently stops blocking planned administration (`record_administration` → `check_planned_dose`).
  - The schedule and follow-up worklist stop showing `staff_review_needed`.
  - No screen shows the hold, and it cannot be released either: `release_clinical_hold` checks the canonical child's enrollment, which still passes, but nothing lists the hold so staff never see it.
  - The hold row stays `active` forever on the merged record.
  - This is a clinical-safety regression triggered by a routine duplicate merge.
- Root cause: holds are keyed to the physical child id. Merge never re-points them, and every hold reader uses the canonical id instead of the alias set.
- Solution: add a new forward migration.
  1. Make every hold reader alias-aware: `child_eval_inputs`, `list_clinical_holds`, the duplicate check in `place_clinical_hold` and the lookup in `release_clinical_hold`. Use `h.child_id in (select private.child_ids_with_aliases(v_canon))`.
  2. Also, or alternatively, re-point active holds to the survivor inside the `merge_children` wrapper, with `private.audit(... 'hold.merged' ...)`.
  3. Backfill: for every active hold whose child has `merged_into_id is not null`, apply the same treatment.
- Acceptance: after merging a held duplicate, `check_planned_dose(survivor)` returns `blocked:true, reasons:['clinical_hold']`. `list_clinical_holds(survivor)` lists the hold. `release_clinical_hold` releases it. `evaluate_child(survivor)` shows `clinical_hold`.
- Verification: proposed regression test in `tests/db/followup.test.ts` or `registry.test.ts`: "a hold on a merged duplicate still blocks and is listed on the survivor". It uses the probe steps above.

### DB-02 — Every child-history lookup scans and sorts the whole cross-tenant `vaccination_revisions` table; at scale the planner picks a per-row loop that does not finish
- Priority: P1
- Class: Reproduced defect (synthetic volume)
- Location:
  - `supabase/migrations/0006_clinical_master.sql:276` (`private.current_revisions` = `DISTINCT ON (event_id)` over the whole table)
  - `supabase/migrations/0007_schedule_engine.sql:185` (`child_ids_with_aliases`: recursive join on `children.merged_into_id`, which has no index)
  - Callers include:
    - `0025_scheduling_integrity.sql:291-301`: `child_eval_inputs`, used by `evaluate_child`, `check_planned_dose` → `record_administration`, and `refresh_followup`
    - `0017_certificates_messages.sql:115` `issue_certificate`
    - `0009_evidence_history.sql:135,158` `list_child_history` / `guardian_child_history`
    - `0021_catchup_checkins.sql:400` `report_backlog.pendingOutsideDoses`: scans every organisation's revisions and calls `child_in_clinic` per row
- Evidence: `.local/audit-scratch/database/perf-volume.sql`, `perf-explain.out`, `perf-explain-evalinputs.out`, `perf-scale.out`.
  - At 100k children / 200k revisions: `select private.child_eval_inputs('<child>', current_date)` was still running after 312 s and I cancelled it. `EXPLAIN` of its dose query shows `Nested Loop Semi Join … Join Filter: (cr.child_id = child_ids_with_aliases(..))` with an un-materialised `ProjectSet` inner side. That re-runs the alias function, a 13 ms seq scan of `children`, for each of the 200k view rows. The view is estimated at `rows=2`.
  - The same query outside the function, where the planner chose a hash join, took 269 ms. Even that plan reads and sorts all 200,078 revisions from every organisation.
  - At 10k / 20k: 134 ms per call. The estimate was `rows=1` against an actual 20,049.
  - Test-suite scale (76 revisions) hides all of this.
- Impact:
  - Recording a vaccination, schedule evaluation, follow-up refresh (up to 200 children per call), certificate preparation and history views all degrade linearly with total system volume, not with the child's own record.
  - There is a cliff where requests time out. One large tenant slows every tenant.
- Root cause:
  - Predicates on `child_id` cannot be pushed through `DISTINCT ON (event_id)`.
  - The planner uses default selectivities on the subquery output and so badly underestimates rows.
  - `children.merged_into_id` is unindexed. The catalog check (`catalog-checks.out` [13]) lists `children_organization_id_merged_into_id_fkey` without an index.
- Solution, in a new migration:
  1. `create index on public.children (merged_into_id) where merged_into_id is not null;`
  2. Replace `current_revisions` usage in child-scoped queries with an event-scoped form:
     - compute aliases once (`v_ids uuid[] := array(select private.child_ids_with_aliases(v_canon))`);
     - then `select distinct on (r.event_id) r.* from public.vaccination_revisions r where r.event_id in (select event_id from public.vaccination_revisions where child_id = any(v_ids)) order by r.event_id, r.revision_no desc`;
     - then filter `child_id = any(v_ids)`.
     
     The existing `(child_id, administered_on)` and `(event_id, revision_no)` indexes serve this.
  3. Scope `report_backlog.pendingOutsideDoses` through clinic enrollments first.
  4. Optionally add `vaccination_revisions (clinic_id, administered_on)` and `(lot_id)` indexes for the reports and `trace_lot_use`.
- Acceptance: at 100k children / 200k revisions, `child_eval_inputs` and `list_child_history` run in under 50 ms and their `EXPLAIN` shows index scans on `vaccination_revisions`. Results are identical to the current function on the test-suite data.
- Verification: rerun `perf-volume.sql` and `perf-explain.sql`. Run the existing `schedule`, `administration`, `evidence` and `certificates` DB tests for equivalence.

### DB-03 — A privacy-notice acknowledgement is keyed by organisation and version label, so a different clinic notice with the same label counts as already accepted
- Priority: P2
- Class: Reproduced defect
- Location:
  - `supabase/migrations/0022_followup_holds_privacy.sql:85`: the "new version" check covers the same clinic only
  - `0022_followup_holds_privacy.sql:91-94`: `guardian_ack_version(p_org, p_version)`
  - `0022_followup_holds_privacy.sql:119-122` and `128-137`: `require_privacy_ack`
  - `supabase/migrations/0031_pending_privacy_notices.sql:12-17`
- Evidence: `.local/audit-scratch/database/b-privacy.probe.ts` → `b-privacy.out`. Clinic A and clinic B in the same organisation both carry label `v1` with different text. The guardian acknowledged clinic A only. Output:
  ```
  privacy.otherClinic(after acking clinic A only): {"version":"v1","acknowledged":true}
  privacy.create_child_provisional(otherClinic) without reading B's notice: {"ok":true,...}
  ```
  Second part, from `a-isolation.out`: `get_pending_privacy_notices()` loops over every active clinic in every organisation. A brand-new user with no organisation was shown another organisation's notices. Acknowledging one created a `guardians` row for that user inside the unrelated organisation (`privacy.after_ack.guardian_rows_for_g1: [{"in_org_b":true}]`).
- Impact:
  - The consent gate before adding or linking a child can be satisfied by a different clinic's notice text. The recorded acknowledgement does not prove which text was shown.
  - The dashboard RPC is unbounded in the number of clinics and shows notices from unrelated tenants.
  - Accepting such a notice creates guardian identity rows in organisations the family has no relationship with.
- Root cause:
  - `privacy_records` stores `notice_version` without a clinic or text digest.
  - The version-uniqueness check is per clinic.
  - The pending-notice RPC has no relationship scope.
- Solution:
  - Record `clinic_id` and a SHA-256 of the notice text on `privacy_records`.
  - Make `guardian_ack_version` take the clinic and compare on clinic + version + digest. Alternatively, enforce label uniqueness per organisation in `set_privacy_notice`.
  - Scope `get_pending_privacy_notices` to clinics where the caller has a relationship or enrollment, or return notices only for the clinic being chosen. Bound it.
- Acceptance: acknowledging clinic A's `v1` leaves clinic B's `v1` (different text) unacknowledged, and `create_child_provisional` at B returns CV409. A user with no relationships gets `[]` from `get_pending_privacy_notices`.
- Verification: proposed DB test with the probe steps.

### DB-04 — Clinic-scoped staff can read other clinics' child identities and audit payloads in the same organisation
- Priority: P2
- Class: Reproduced defect (policy-dependent)
- Location:
  - `supabase/migrations/0015_administration.sql:386` `trace_lot_use`: filters `cr.organization_id = v_org` only and has no `child_in_clinic` check
  - `supabase/migrations/0024_config_content_audit_ops.sql:214` `search_audit`: filters `a.organization_id = v_org` and returns `before`/`after` JSON
- Evidence: `a-isolation.out`. The lead of clinic A has `inventory.approve` and `child.read_clinical` at clinic A only. The probe child is enrolled only at clinic B (`child_in_clinic(otherKid, clinicA) = false`). Output:
  ```
  trace_lot_use(clinicA, lot used only at clinicB): [{"childName":"Other Clinic Kid","recordNo":"CV-000003","clinicId":"<clinicB>",...}]
  search_audit(clinicA) rows about otherKid: [{"action":"child.registered","after":{"localRecordNo":"CV-000003",...}}]
  ```
- Impact: every other clinical read RPC enforces `child_in_clinic`. These two disclose child names, record numbers and audit payloads across clinics. Audit payloads can include identity-edit before/after values. Organisation-wide lot recall may be intended, but nothing in the code or docs states that, and access is granted by a clinic-scoped capability.
- Root cause: both functions scope by organisation, not clinic.
- Solution: ask the product/privacy owner whether org-wide recall and audit access are intended.
  - If not, restrict `trace_lot_use` rows to children where `child_in_clinic(canonical, p_clinic_id)`, and return only counts per other clinic.
  - Restrict `search_audit` to rows whose entity belongs to the clinic. Add a `clinic_id` column to `audit_logs` populated by `private.audit`. Alternatively, require a distinct org-level capability.
- Acceptance: a clinic A lead tracing a lot used only at clinic B sees no clinic B child identities. `search_audit` at clinic A returns no clinic B entity rows, unless an explicit org-level capability exists.
- Verification: proposed DB test from the probe.

### DB-05 — Five commands commit "in progress" idempotency receipts, so a retried key runs the command again
- Priority: P3
- Class: Reproduced defect
- Location:
  - `supabase/migrations/0017_certificates_messages.sql:126-128` (`issue_certificate`)
  - `0021_catchup_checkins.sql:113` (`save_catchup_draft`)
  - `0022_followup_holds_privacy.sql:27` (`place_clinical_hold`) and `:281` (`log_followup_attempt`)
  - `0023_record_transfer.sql:81` (`initiate_record_transfer_out`)
- Evidence: after the full DB suite ran on `cvsrs_audit_db`:
  ```
  select command_type,status,count(*) from private.command_receipts group by 1,2 having status<>'completed';
  catchup.save 3 · certificate.issue 1 · followup.attempt 3 · hold.place 2 · transfer.initiate_out 4   (13 of 1,647)
  ```
  Each of these functions does `begin_command(...)` and then `return null` when the child is not in the clinic, without calling `finish_command`. The `begin_command` replay path returns `r.result` (null) for an existing in-progress receipt, so the caller treats it as a new operation.
- Impact: the receipts no longer give the "same key → same answer" guarantee. If enrollment changes between attempts, a retried key returns a different outcome. Receipts stay `in_progress` permanently, which pollutes any receipt-based monitoring. Low direct harm, because the first attempt wrote nothing apart from one denied audit row.
- Root cause: `return null` after `begin_command` instead of raising or finishing.
- Solution: raise `CV404` (rolls back the receipt), or call `finish_command(..., 'null'::jsonb)` before returning. In `begin_command`, treat an existing `in_progress` receipt from another committed transaction as a conflict.
- Acceptance: after the full DB suite, `select count(*) from private.command_receipts where status <> 'completed'` = 0.
- Verification: that query in a DB test teardown, or a dedicated test calling each function for an unenrolled child twice with the same key.

### DB-06 — Audit search and org-wide audit volume have no supporting index
- Priority: P3
- Class: Inspection risk (measured)
- Location: `supabase/migrations/0001_foundation.sql:210-212` (indexes cover entity, actor and request only); `0024_config_content_audit_ops.sql:214` (`search_audit` filters `organization_id`, `action like`, ordered by `server_time desc`).
- Evidence: `perf-explain.out` §3/3b. At 300k audit rows, `search_audit`'s inner query runs as a `Parallel Seq Scan on audit_logs` (47 ms and 36 ms). Every list/read RPC writes an audit row (`list_queue`, `list_appointments`, `staff_search_children`, `report_*`, `list_followup_worklist`), so this is the fastest-growing table, and cost grows linearly.
- Impact: audit search becomes slow, and pagination pages get slower. There is no retention or partitioning plan for the table.
- Solution: `create index on private.audit_logs (organization_id, server_time desc)`. Optionally add `(organization_id, action text_pattern_ops, server_time desc)`. Add `id` as a keyset tie-breaker: `p_before` currently compares `server_time` only, so rows with identical timestamps can be skipped between pages.
- Acceptance: `EXPLAIN` of the `search_audit` query at 1M rows uses an index scan, and a page completes in under 10 ms.
- Verification: rerun `perf-explain.sql` §3.

### DB-07 — One child can hold confirmed appointments in several sessions on the same day (prior finding, still open)
- Priority: P3
- Class: Missing required behavior (needs a policy decision)
- Location: `supabase/migrations/0012_visits.sql:80` (`appointments_one_active_uq` on `(child_id, session_id)`); `book_appointment_prev`, from 0013 and renamed in `0025_scheduling_integrity.sql:3`, checks the same session only.
- Evidence: final body of `public.book_appointment_prev` (`final-functions.sql`): `if exists (... where child_id = v_canon and session_id = s.id ...)`. There is no per-day or per-clinic check. Neither the 0025 wrapper nor `reschedule_appointment_prev` adds one.
- Impact: a family can take several online slots on the same day, which reduces capacity for others.
- Solution: once policy confirms, lock the child row (the wrapper already does) and reject a second active appointment for the same clinic and `service_date`. Alternatively, enforce it with a denormalised `service_date` column and a partial unique index.
- Acceptance: a second booking for the same child, clinic and date returns CV409.
- Verification: proposed `visits.test.ts` case.

## Proposed regression tests (not added: `tests/` is not owned by this agent)

1. Merged duplicate with an active hold: survivor blocked and hold listed (DB-01).
2. Volume test or EXPLAIN assertion: `child_eval_inputs` does not seq-scan `vaccination_revisions` and stays fast at ≥50k revisions (DB-02).
3. Same version label at two clinics with different text: the second clinic is still unacknowledged. `get_pending_privacy_notices` is `[]` for an unrelated user (DB-03).
4. Cross-clinic `trace_lot_use` / `search_audit` (DB-04).
5. No `in_progress` receipts remain after the suite (DB-05).
6. Same child, two sessions, same day (DB-07).

## Coverage

| Item | Status |
|---|---|
| 0001 foundation (settings, membership, `has_capability`, receipts, audit) | Inspected |
| 0002 staff access, 0004 public surface, 0005 staff admin reads | Inspected (catalog + final bodies) |
| 0003 registry (registration, link, merge) | Defect found (DB-01 merge/holds) |
| 0006 clinical master / `current_revisions` view | Defect found (DB-02) |
| 0007 schedule engine (`add_age` month-end clamping, leap day, `active_schedule_for`) | Inspected. Month-end uses PostgreSQL `date + interval` clamping (Jan 31 + 1 month = Feb 28/29). This is consistent, but the convention is not documented; it needs clinical-owner confirmation, and I did not report it as a defect |
| 0008 schedule lifecycle | Inspected (org-level governance via any clinic's `rules.approve` is by design) |
| 0009 evidence/history | Defect found (DB-02) |
| 0010, 0014, 0016 | Inspected |
| 0011 inventory + 0026 ledger locking | Inspected. Lock order: org advisory lock (shared, or exclusive for repair) → balance row. The re-entrant shared lock is safe; I found no upgrade path |
| 0012/0013 visits + 0025 wrappers (booking, reschedule, check-in, merge, transfer, queue) | Inspected. Prior P1s fixed; DB-07 open |
| 0015 administration, `trace_lot_use` | Defect found (DB-04) |
| 0017 certificates/messages/outbox + 0027 attestation + 0030 pending retirement | Inspected; DB-05 (`issue_certificate`). Outbox poll uses `outbox_ready_idx` (0.05 ms at 200k rows) |
| 0018 reports + 0026 replacements | Inspected (audit on every call; small-cell suppression applied) |
| 0019 transfers/temperature + 0032 pending visibility | Inspected (pending items now unbounded but bounded by business state; closed history limited to 50) |
| 0020 SMS + 0026 `mark_sms` + 0028 runtime roles | Inspected (claim generation and lease bound; least-privilege roles) |
| 0021 catch-up/check-ins | DB-05 |
| 0022 follow-up/holds/privacy + 0031 pending notices | Defect found (DB-01, DB-03, DB-05) |
| 0023 record transfer | DB-05; transfer/booking race fixed |
| 0024 config/content/audit search/ops | Defect found (DB-04, DB-06) |
| 0029 clinic timezones | Inspected. `local_today` uses the clinic zone; reports convert `timestamptz` with the clinic zone. Remaining server-`current_date` uses carry a +1 day tolerance: `children_before_write`, `clean_outside_dose`, `verify_outside_dose`, `my_appointments` (−60 days window). That is safe for Asia/Manila on a UTC server |
| 0033 operation-key reuse feedback | Inspected (body identical apart from message/hint; ACL kept) |
| Whole-schema RLS/grants/definer/search_path/anon surface | Inspected, PASS (catalog proof above) |
| Tenant isolation probes (cross-org privacy, cross-clinic reads) | Defect found (DB-03, DB-04); the other clinic-scoped RPCs enforce `child_in_clinic` (mechanical scan of final bodies) |
| Constraints vs `src/lib/validation/schemas.ts` | Partially inspected: the app schemas are thin and the DB functions are authoritative; no mismatch found |
| Live Supabase / PostgREST / GoTrue behaviour | Not inspected (local bootstrap only) |
