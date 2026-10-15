# Batch 1 review: SQL (role R2-C)

- Date: 2026-10-02
- Reviewer: independent database reviewer. Model: claude-opus-5-5.
- Scope: work by "Impl C", reviewed here for the first time:
  - `supabase/migrations/0000_extensions.sql` and `supabase/migrations/0034_integrity_performance.sql`
  - `tests/db/integrity-0034.test.ts`
  - `supabase/install/*` and `docs/engineering/manual-setup.md` §7
- Rules: read-only on source, tests and migrations. No git writes.
- Scratch evidence is in `.local/audit-scratch/review2-sql/`, which is gitignored.

## Gates run (executed)

| Gate | Result |
|---|---|
| `CVSRS_TEST_DB_NAME=cvsrs_audit_review2sql npx vitest run --config vitest.db.config.ts tests/db/integrity-0034.test.ts` | PASS, 19/19 |
| `CVSRS_TEST_DB_NAME=cvsrs_audit_review2sql npx vitest run --config vitest.db.config.ts` (every DB file, own DB name, not `npm run test:db`) | PASS, 20 files, 335/335 |
| After the full suite: `select … from private.command_receipts where status <> 'completed'` | 0 rows of 1,693 receipts (DB-05 acceptance) |
| `npx tsx scripts/build-supabase-install.ts --check` | "supabase/install is up to date (35 migrations)" |
| Catalog diff: baseline DB (bootstrap + 0000..0033, `cvsrs_audit_review2sql_base`) vs full DB (+0034, `cvsrs_audit_review2sql_full`) | See "Function-by-function comparison" |
| Volume DB `cvsrs_audit_review2sql_vol` (test data + 200k children in 2 orgs, 400k revisions, 1M audit rows): timings, `EXPLAIN`, `auto_explain` of in-function plans | See DB-02 and DB-06 |
| Cross-org and cross-clinic probes as real `authenticated` roles with JWT claims (`probe-isolation.sql`) | Isolation holds; output below |

I did not touch the demo cluster, `cvsrs_dev`, `cvsrs_test` or `cvsrs_demo`. Nothing was executed on PostgreSQL 15 or 17; the local cluster is 18.2, so SUP-03 is still open.

## Function-by-function comparison (executed: `pg_get_functiondef` and `proacl` diff, base vs full)

1. **ACLs, `SECURITY DEFINER` and `search_path`.** They are identical for all 22 replaced functions.
   - `search_audit` is dropped and recreated with the same grant: `postgres`, `service_role` and `authenticated` can execute it.
   - All 8 new private functions are `SECURITY DEFINER` with `search_path=""`, except `notice_digest`, which is immutable and not a definer function. Each one has ACL `{postgres=X/postgres}`, so no `PUBLIC`, `anon`, `authenticated` or `service_role` grant.
   - `guardian_ack_version` is dropped. No remaining function body references it (grep of all final bodies).
2. **Authorization order.** Every replaced public function still calls its capability check (`require_capability`, `require_any`, `inventory_org` or `report_org`) before reading state, exactly as before.
3. **Body diffs.** Each diff contains only the intended change:
   - `record_administration`, `list_child_history` and `guardian_child_history` read through `child_current_revisions`.
   - `child_eval_inputs` reads through the alias set, and its holds use `any(v_ids)`.
   - The five DB-05 commands now `raise … CV404` where they used to `return null`.
   - `approve_stock_adjustment` adds one guard.
   - `merge_children` adds the ownership pre-check and the hold re-point loop.
   - `require_capability` and `require_any` add `set_config('cvsrs.audit_clinic', …, true)`.
   - `private.audit` adds `clinic_id`.
   - The privacy functions switch from guardian/version keying to clinic/version/SHA-256 keying.
4. **Error texts.** Existing CV codes and messages are unchanged. The new texts:
   - CV409 "this stock case is not a count adjustment; decide it from the transfer or the visit record it came from" (approve).
   - CV404 "not found" for the five DB-05 commands.
   - CV409 and CV422 texts in the bootstrap function, which is operator-only.

   The new texts fit the `src/lib/api/errors.ts` behaviour: CV409 and CV422 pass their text through, and CV404 is generic.
5. **No other `return null` after `begin_command`.** An awk scan of all 6,568 lines of final bodies found none.
6. **Lost behaviour (one, minor).** Before 0034, `issue_certificate` wrote a `certificate.issue` audit row with outcome `denied` for a child outside the clinic, then returned null. The new `raise` rolls that row back, so cross-clinic issue attempts are no longer audited. See RV2-C-05.

## Verdicts

| ID | Verdict | Reason |
|---|---|---|
| SUP-01 | APPROVE | `0000_extensions.sql:4-7` is idempotent, and the test applies every migration with no bootstrap extension lines (`integrity-0034.test.ts:39-69`, executed PASS). Installer block and per-file path are consistent (`fresh-install.sql:103-127`). Supabase permission for `create extension pg_trgm/unaccent` as `postgres` is inferred, not live-checked. |
| SUP-02 | APPROVE with follow-up | `0034:778-804,812`: `search_path=''`; ACL is postgres only (catalog executed, and the test checks anon, authenticated, service_role and PUBLIC); CV409 on rerun; one `staff.bootstrap` audit row; table lock against concurrent runs; the constraint `approved_by <> profile_id` holds. Follow-up RV2-C-07 (P3): the audit row does not name the operator role, and once every membership is revoked or suspended, a rerun creates a second organization. |
| DB-01 | APPROVE | `0034:362-365` re-points active holds on merge and audits each one. `0034:56,277,299` make every hold reader alias-aware, and `0034:304-319,817` backfill holds left behind by earlier merges. Executed: the DB-01 tests pass, covering survivor blocked, hold listed, release works, `evaluate_child` shows `clinical_hold`, and the legacy-state backfill. Inference: a hold placed concurrently with a merge lands on the duplicate, but the alias-aware readers still enforce it, so nothing is orphaned. There is no unique index on active holds, so a survivor can end with two active holds for the same rule. That is conservative (both block) and not a defect. |
| SEC-05 | APPROVE | `0034:331-336`: the organization and clinic check runs before `for update` and before the state checks, mirroring `merge_children_prev`'s own check. Executed: a foreign-org child and a same-org other-clinic child, both under a held row lock with `lock_timeout 2s`, each return CV404 (test PASS). |
| DB-02 | APPROVE with follow-up | Acceptance met (executed on `_vol`): `child_eval_inputs` 12 ms cold and 1.7 ms warm; `list_child_history` 9 ms and 2 ms; `evaluate_child` 6 ms. `EXPLAIN` shows `vaccination_revisions_child_idx` plus `event_id_revision_no_key` index scans, touching only the child's 2 rows out of 400k across two orgs. The equivalence test with the old view passes over every child. Follow-up RV2-C-03 (P3): the `report_backlog` part (`0034:157-159,169`) is about 3x slower than before at this volume. |
| FE-01 (SQL) | APPROVE | `0034:383-385`: the guard sits after `begin_command`, so the raise also rolls back the receipt. Transfer-shortfall refusal is executed (test PASS: case stays open, no receipt). Exception-stock evidence `{eventId, lotId, reportedLot, problems}` (`0015:212`) has no `observed` or `locationId`, so it is refused too (inference from the evidence shape; no test). |
| DB-03 | APPROVE with follow-up | Clinic + version + SHA-256 keying (`0034:478-499`), acknowledging no longer creates a guardian, and the backfill is receipt-attributed (`0034:599-629`; the `now()` defaults it relies on are confirmed). Executed: the tests pass, and the probe shows a loner acknowledging an other-org clinic creates 0 guardian rows; the record carries clinic, profile and a 64-hex digest. Deviation from acceptance: "a user with no relationships gets `[]`" is not met. A loner still gets every org's notices (probe: 4, including the other org's C3), bounded at 100 and with their own clinics first (`0034:567-591`). This is intentional and documented in the SQL comment because the add/link forms choose any public clinic. Orchestrator must accept or reject the deviation; see RV2-C-08. |
| DB-04 | REWORK | Isolation is correct (executed: other-clinic identities are not named, other-org rows are not returned, foreign clinic is CV403). Two defects: the new `trace_lot_use` response shape crashes the existing lot-trace UI (RV2-C-01, P1), and `search_audit`'s clinic filter costs O(enrolled children) on every page (RV2-C-02, P2). |
| DB-05 | APPROVE | All five commands raise CV404 before writing anything, and the receipt rolls back (`0034:117,273,416,445,464`). Retry with the same key re-executes, which is correct because the first attempt had no effect. The full suite leaves 0 non-completed receipts (executed). Minor loss of the `denied` audit row in `issue_certificate`: RV2-C-05 (P3). |
| DB-06 | REWORK | The index matches the WHERE and ORDER BY (`0034:19` ↔ `0034:756-765`). The keyset is correct and gap-free with a tie-breaker (test PASS; with constants the inner query is an `Index Scan using audit_org_time_idx`, `Index Cond` includes `ROW(server_time,id) < ROW(...)`, 0.09 ms). The acceptance "a page completes in under 10 ms at 1M rows" fails: 388-396 ms per page. With the same index present, the pre-0034 body takes 6.7 ms. Cause: RV2-C-02. Also, neither the API route nor the audit page passes `p_before_id`, so the UI still pages on `server_time` alone (RV2-C-04, P3). |
| Migration ordering, rerun, PG15/17, live upgrade | APPROVE with follow-up | `0000` sorts first. The demo launcher applies missing files by name, so `0000` is a no-op there (`scripts/demo-runtime.ts:87-101`; inference, demo DB not touched). 0034 is not rerunnable (`create function`, `add column`, `drop function`); that matches the other migrations and the installer refuses reruns. Grep of 0000 and 0034 for PG16-18-only syntax found none; `materialized` CTEs and `sha256()` exist since PG12 and PG11. Live-upgrade locking and README accuracy: RV2-C-06 (P3). |

## Executed evidence (key outputs)

Volume DB timings (ms). Everything ran as the authenticated lead unless noted. C1 has 50k enrolled children; the org holds 1M audit rows.

```
child_eval_inputs (definer)          12.3 cold / 1.7 warm
list_child_history                    9.1 / 2.1
search_audit page 1                   NEW 396 / 388   OLD body (same index present) 6.7   ALT (lazy per-row check) 20.4 cold / 3.6
search_audit rare action ('zz.none')  NEW 2007        OLD 135                             ALT 173
search_audit deep keyset page         NEW 397-493     OLD 1.9                             ALT 2.2
  (ALT returns identical rows to NEW: equality check `same = t`)
auto_explain: v_kids := array(... child_ids_with_aliases ...) alone = 413 ms of 433 ms (Function Scan loops=49897)
report_backlog pendingOutsideDoses    NEW 625   OLD 216   ALT (drive from pending revisions) 30
trace_lot_use (20k uses)              NEW 615   OLD 656
create index audit_org_time_idx, 1M rows (396 MB table)   661 ms
```

Isolation probe (`probe-isolation.sql`):

```
org2 search own clinic: rows from org1 = 0
org2 trace org1 lot at own clinic: []
search_audit / trace_lot_use on an org1 clinic as org2 staff: ERROR forbidden (CV403)
loner pending count = 4, includes other-org C3 = true
ack C3 -> {"version": "v9", "acknowledged": true}; guardian rows for loner = 0
privacy record: (org2, guardian NULL, clinic C3, profile loner, v9, sha256 length 64)
```

## New defects

### RV2-C-01 — `trace_lot_use` now returns other-clinic summary rows in the same array, so the lot-trace panel crashes whenever another clinic used the lot
- Priority: P1
- Class: Reproduced defect. The SQL output is reproduced; the client crash is a deterministic code trace and was not run in a browser.
- Location:
  - `supabase/migrations/0034_integrity_performance.sql:723-733` (`return v_res || v_other`, where entries carry `scope:'other_clinic', clinicId, clinicName, records`)
  - `src/app/clinic/[clinicId]/inventory/forms.tsx:213-220` (`TraceRow` requires `eventId, childName, recordNo, status, eventStatus`)
  - `src/app/clinic/[clinicId]/inventory/forms.tsx:304-306` (`trace.map(t => … t.status.replace("_", " "))`)
  - API pass-through: `src/app/api/v1/clinics/[clinicId]/stock/lots/[lotId]/trace/route.ts:4`
- Evidence:
  - `tests/db/integrity-0034.test.ts:315-319` (PASS) asserts that the array contains `{scope:"other_clinic", clinicId, records:1}`.
  - For that element, `t.status` is `undefined`, so `t.status.replace` throws `TypeError` during render, and `key={t.eventId}` is `undefined`.
  - Lots belong to the organization and move between clinics by transfer (`send_stock_transfer`), so a lot used at two clinics is the normal case.
- Impact: an inventory approver or lead pressing "Who received this lot" for a recall gets the segment error page instead of the list. That breaks the recall trace exactly when the lot was used at more than one clinic.
- Root cause: 0034 changed the RPC's response contract (a mixed-shape array) without updating its only consumer.
- Solution: pick one.
  1. Keep the SQL. In `forms.tsx`, make `TraceRow` a discriminated union on `scope`, render `scope === "this_clinic"` rows as today, and render `other_clinic` rows as "N doses from this lot were recorded at <clinicName>; ask that clinic for its list".
  2. Change the SQL to return `{ "records": [...], "otherClinics": [...] }` and update the UI accordingly. This is cleaner, but `tests/db/administration.test.ts:428` and `integrity-0034.test.ts:315-319` must change too.
- Acceptance: with a lot used at the caller's clinic and at another clinic, the panel lists the caller's children plus one summary line per other clinic, shows no `undefined`, and does not throw.
- Verification: a component or unit test that renders `LotActions` trace output from a fixture containing both scopes. The DB test keeps asserting that no other-clinic identity appears.

### RV2-C-02 — `search_audit` expands the alias set of every child enrolled at the clinic on every call: about 400 ms per page at a 50k-child clinic, versus 6.7 ms for the old body
- Priority: P2
- Class: Reproduced defect (synthetic volume)
- Location: `supabase/migrations/0034_integrity_performance.sql:750-752` (`v_kids := array(… cross join lateral private.child_ids_with_aliases(e.child_id) …)`), `:763`
- Evidence: `cvsrs_audit_review2sql_vol`, files `perf.sql`, `perf-old.sql`, `perf-alt.sql`, `ae-search.out`.
  - `auto_explain` attributes 413 ms of a 433 ms call to building `v_kids` (`Function Scan on child_ids_with_aliases … loops=49897`).
  - The indexed audit query itself takes under 1 ms.
  - Rare-action searches take 2.0 s, against 135 ms for the old body.
  - Cost grows linearly with clinic enrollment, roughly 8 µs per child, and is paid on every page and every filter change.
- Impact: audit search, the DB-06 target, gets slower rather than faster for any sizeable clinic. Every call also writes an `audit.searched` row while holding the request open.
- Root cause: eager materialization of the whole clinic's child set to serve the minority of rows that have `clinic_id is null`.
- Solution:
  - Drop `v_kids`. For `a.clinic_id is null and a.entity_type = 'child'`, use the per-row predicate `private.child_in_clinic(private.canonical_child(a.entity_id), p_clinic_id)`, or route every null-clinic row through `private.audit_row_in_clinic`, which already encodes the same rule. With `LIMIT` and index order, the predicate runs only on rows actually scanned.
  - Measured with exactly that change (`alt-fn.sql`): 3.6 ms per warm page, 2.2 ms for a deep keyset page, 173 ms for a rare action, and rows identical to the current body.
- Acceptance: at 1M audit rows and a 50k-child clinic, a page completes in under 10 ms warm, results are unchanged, and all DB-04 tests pass.
- Verification: rerun `perf.sql` and `perf-alt.sql` from the scratch folder. Run `integrity-0034.test.ts` and `config.test.ts`.

### RV2-C-03 — `report_backlog.pendingOutsideDoses` is about 3x slower after the DB-02 rewrite
- Priority: P3
- Class: Reproduced defect (synthetic volume)
- Location: `supabase/migrations/0034_integrity_performance.sql:157-159`, `:169`
- Evidence (`perf-backlog.sql`, 50k children at C1, 400k revisions in total):

  | Version | Time |
  |---|---|
  | New (0034) | 625 ms |
  | Old (0033) | 216 ms |
  | Alternative below | 30 ms |

  The cost is the same alias expansion as RV2-C-02, plus `child_id = any(<50k-element array>)`.
- Impact: the Reports page (`src/app/clinic/[clinicId]/reports/page.tsx:69`) loads slower for large clinics. The old cost grew with total system volume; the new one grows with clinic size and is already worse at this scale.
- Solution: start from the few pending revisions instead of from all enrollments. This is equivalent, because an event whose latest revision is pending has a pending revision:
  ```sql
  select count(*)
    from (select distinct on (r.event_id) r.*
            from public.vaccination_revisions r
           where r.event_id in (select event_id from public.vaccination_revisions
                                 where verification_status = 'pending_verification')
           order by r.event_id, r.revision_no desc) cr
   where cr.verification_status = 'pending_verification'
     and cr.event_status = 'active'
     and private.child_in_clinic(private.canonical_child(cr.child_id), p_clinic_id)
  ```
  Optionally add a partial index on `vaccination_revisions (event_id) where verification_status = 'pending_verification'`.
- Acceptance: same count as the 0033 definition (test `integrity-0034.test.ts:183-186`), and under 50 ms at the volume above.
- Verification: `perf-backlog.sql` and the existing DB-02 equivalence test.

### RV2-C-04 — The gap-free keyset exists in SQL but neither caller uses it
- Priority: P3
- Class: Missing required behavior
- Location:
  - `src/app/api/v1/clinics/[clinicId]/audit/route.ts:5-13` (no `p_before_id`)
  - `src/app/clinic/[clinicId]/audit/page.tsx:35` (no `p_before_id`) and `:93-95` (next link carries only `before`)
- Evidence: code read. With `p_before_id` null, `0034:759` keeps the old `server_time < p_before` meaning, which skips rows that tie with the last row on a page. `server_time` defaults to `clock_timestamp()`, so ties are rare but possible.
- Impact: DB-06's "no skipped rows at equal timestamps" holds only for direct SQL callers.
- Solution: pass `p_before_id` from a `beforeId` query parameter in the route and the page, and put `nextBeforeId` into the next-page link. Validate it as a UUID.
- Acceptance: paging through 3 rows with identical `server_time` at page size 2 returns all 3, both through the route and through the page.
- Verification: a route unit test with a mocked RPC that asserts `p_before_id` is forwarded. The DB keyset test already exists.

### RV2-C-05 — `issue_certificate` no longer audits a denied cross-clinic attempt
- Priority: P3
- Class: Reproduced defect (catalog diff)
- Location: `supabase/migrations/0034_integrity_performance.sql:117`. The 0033 body wrote `audit(... 'certificate.issue', 'child', p_child_id, ..., 'denied')` and then returned null.
- Evidence: base vs full `pg_get_functiondef` diff. The raise rolls back the denied row together with the receipt.
- Impact: probing certificate issue for children outside the clinic leaves no audit trace. The equivalent read paths, such as `list_child_history:74`, still audit denials.
- Solution: either accept this and record it in known-limitations, or use DB-05's other option for this one command: write the denied audit, call `finish_command(v_org, p_operation_key, 'null'::jsonb)` and return null. The receipt is then completed, so the DB-05 acceptance still holds.
- Acceptance: a denied cross-clinic issue leaves one `denied` audit row and no non-completed receipt.
- Verification: extend the `integrity-0034.test.ts` DB-05 case.

### RV2-C-06 — Live-upgrade notes are missing for 0034: blocking index build on the audit table, rewrites of immutable rows, dropped functions
- Priority: P3
- Class: Inspection risk (index build measured)
- Location:
  - `supabase/migrations/0034_integrity_performance.sql:17-19,485,593,599-629,634,738`
  - `supabase/install/README.md:48-62` (the "risky steps" table has no 0034 row and says "No migration … deletes or rewrites rows")
- Evidence:
  - A non-concurrent `create index` on `private.audit_logs` took 661 ms at 1M rows (396 MB). Every RPC writes an audit row, so the build blocks all writes, including reads that audit, for a time that grows with table size.
  - 0034 also takes `ACCESS EXCLUSIVE` on `audit_logs` (`add column`) and `privacy_records`.
  - It updates `clinical_holds.child_id` and the append-only `privacy_records`, with its immutability trigger disabled inside the backfill.
  - It drops `search_audit(…7 args)` and `guardian_ack_version`.
- Impact: an operator upgrading a populated database gets no warning. The README statement about row rewrites becomes false.
- Solution:
  - Add a 0034 row to the README table: index builds, the `privacy_records` backfill with its trigger disabled in-transaction, the hold re-point, and the two dropped functions. Callers using the old 7-argument `search_audit` keep working through the defaulted 8th argument.
  - Advise pre-creating `audit_org_time_idx`, `children_merged_into_idx` and `vaccination_revisions_lot_idx` with `create index concurrently` under the same names before applying 0034 on a large live database. The migration uses `if not exists` for these three.
- Acceptance: the README lists the 0034 operations and the concurrent pre-build option.
- Verification: doc review.

### RV2-C-07 — Bootstrap audit does not identify the operator; rerun after all staff are revoked creates a second organization
- Priority: P3
- Class: Optional improvement
- Location: `supabase/migrations/0034_integrity_performance.sql:783`, `:800-802`
- Evidence: code read and test `integrity-0034.test.ts:393-420`. The guard only looks at `active` and `pending_approval` memberships. `system_job_id = 'system'`, and `session_user` is not recorded.
- Impact: low. Only the database owner can run it. Recovering from "every grant revoked" silently forks the tenant instead of restoring access, and the audit row cannot say which DB login ran it.
- Solution: add `'operator', session_user` to the audit `after` JSON. Either refuse when `exists (select 1 from public.organizations)`, or document that a rerun after full revocation creates a new organization.
- Acceptance: the audit row names the DB role, and the documented behaviour matches the code.
- Verification: extend the SUP-02 test.

### RV2-C-08 — `get_pending_privacy_notices` intentionally misses DB-03's "unrelated user gets []" acceptance; truncation at 100 is silent
- Priority: P3
- Class: Missing required behavior (needs an orchestrator or product decision)
- Location: `supabase/migrations/0034_integrity_performance.sql:567-591`; consumer `src/app/children/page.tsx:33-41`
- Evidence: probe output `loner pending count = 4, includes other-org C3 = true`.
  - The list is capped at 100 and nothing tells the caller it was truncated.
  - If a family's chosen clinic falls outside the first 100, the add/link form cannot show its notice, yet the server returns CV409 "please read and accept the clinic's privacy notice first" (`0034:562-563`).
- Impact: the material DB-03 harms are fixed: no cross-clinic false acceptance, no guardian rows in unrelated orgs. What remains is a documented scope trade-off, plus a dead end above 100 notice-bearing clinics.
- Solution: either accept the deviation and record it, or follow the SQL comment's own plan: show the chosen clinic's notice through `get_privacy_notice(p_clinic_id)` in the forms, then narrow the pending list to related clinics.
- Acceptance: the decision is recorded. If the list is narrowed, an unrelated user gets `[]`.
- Verification: `integrity-0034.test.ts:255-271` adjusted to the decision.

## Rework list

1. **RV2-C-01 (P1). Files: `src/app/clinic/[clinicId]/inventory/forms.tsx`, plus a component or unit test.** Frontend owner; the SQL can stay as is.
   - Change `TraceRow` (`:213-220`) to a union on `scope`: `"this_clinic"` keeps the current fields; `"other_clinic"` has `clinicId`, `clinicName` and `records`.
   - In the render (`:304-306`), list `this_clinic` rows as today, keyed by `eventId`, and add one line per `other_clinic` entry keyed by `clinicId`.
   - Alternative: return `{records, otherClinics}` from SQL. That changes `0034:723-733` and both DB tests, and `0034` may still be edited in place.
2. **RV2-C-02 (P2). File: `supabase/migrations/0034_integrity_performance.sql`.** In `search_audit` (`:742-765`):
   - Delete `v_kids` and its assignment (`:742`, `:748-752`).
   - Replace `:763` with `or (a.entity_type = 'child' and private.child_in_clinic(private.canonical_child(a.entity_id), p_clinic_id))`. Equivalently, collapse `:762-764` into `private.audit_row_in_clinic(p_clinic_id, null, a.entity_type, a.entity_id)`.
   - Rerun `npx tsx scripts/build-supabase-install.ts`, then `--check`.
3. **RV2-C-03 (P3). Same file.** Replace `v_ids` (`:154`, `:157-159`) and `:169` in `report_backlog` with the pending-driven count in RV2-C-03's Solution.
4. **RV2-C-04 (P3). Files: `src/app/api/v1/clinics/[clinicId]/audit/route.ts`, `src/app/clinic/[clinicId]/audit/page.tsx`.** Forward `p_before_id` and emit `beforeId` from `nextBeforeId` in the next-page link.
5. **RV2-C-05, -06, -07 (P3).**
   - `0034:117`: either audit-and-finish, or a known-limitations note.
   - `supabase/install/README.md`: add a 0034 risky-steps row and the concurrent index pre-build advice.
   - `0034:800-802`: add `session_user` to the bootstrap audit, and decide the "organization already exists" behaviour, updating `docs/engineering/manual-setup.md` §7 to match.
6. **RV2-C-08.** Orchestrator decision only; no code change until then.

Caution for any in-place edit of 0034. It is only safe while no persistent database has applied it. The demo launcher refuses a changed checksum for an already-applied file (`scripts/demo-runtime.ts:91`). I did not inspect the demo cluster, so check whether `cvsrs_demo` already recorded `migrations/0034_integrity_performance.sql`. If it did, either put the fixes in `0035_*.sql` or rebuild the demo DB.

## Coverage

| Item | Status |
|---|---|
| 0000_extensions | Inspected; executed (no-ext DB, idempotent rerun) |
| 22 replaced functions + `search_audit` (ACL, definer, search_path, body diff vs 0033 final) | Inspected; executed catalog diff |
| 8 new private functions (grants, search_path) | Inspected; executed catalog |
| DB-01 holds across merge, backfill, concurrent-placement reasoning | Inspected; executed tests |
| DB-02 plans and timings at volume | Executed (`EXPLAIN ANALYZE`, `auto_explain`); defect RV2-C-03 |
| DB-03 keying, backfill attribution, guardian-row creation, pending scope | Executed tests and probe; RV2-C-08 |
| DB-04 cross-clinic and cross-org isolation | Executed probe; defects RV2-C-01, RV2-C-02 |
| DB-05 receipts after full suite, retry semantics | Executed; RV2-C-05 |
| DB-06 index, keyset correctness, page latency | Executed; RV2-C-02, RV2-C-04 |
| SEC-05 ordering and no-lock | Executed test |
| FE-01 SQL refusal (transfer executed, exception by evidence shape) | Executed / inferred |
| SUP-02 grants, rerun, audit, docs (`manual-setup.md` §7, install README) | Executed test + inspected; RV2-C-07 |
| PG15/17 syntax | Inspected by grep only (not executed on 15/17; SUP-03 remains) |
| Live-upgrade locking | Index build measured locally; RV2-C-06 |
| Demo DB applied-migration state | Not inspected (out of bounds) |
