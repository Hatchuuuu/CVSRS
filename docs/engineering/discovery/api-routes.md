# API route handler discovery (DISC-2-API, iteration 1)

Owner: backend/API security specialist (read-only). Scope: every route handler under `src/app/api/v1/**` (125 files), the shared `api()` wrapper, the SQL function behind each route (latest definition across `supabase/migrations/0000`–`0034`), certificate PDF generation and download, `/api/v1/health`, and the backup drill. Application source was not modified. Everything below was checked against the current dirty tree on 2026-10-02.

Scratch artifacts (gitignored, not part of the suite) are in `.local/audit-scratch/disc2-api/`:

| File | What it does | Command |
|---|---|---|
| `sigs.mjs` → `sigs.txt` | Latest signature of every `public.*` function across all migrations | `node .local/audit-scratch/disc2-api/sigs.mjs` |
| `bodies.mjs` → `fn/`, `fn/all/` | Latest (and every earlier) body of every `public`/`private` function, so wrapper `_prev`/`_base` chains can be followed | `node .local/audit-scratch/disc2-api/bodies.mjs` |
| `argcheck.mjs` | Compares every `rpc.rpc("fn", { p_* })` call site in `src/` (195 sites) with the SQL signature: unknown argument names and missing required arguments | `node .local/audit-scratch/disc2-api/argcheck.mjs` → `call sites 195`, no mismatch |
| `api-routes.unit.ts` | Repros for API-01, API-03, API-06 against the real route modules (only the RPC client is simulated) | `npx vitest run --config .local/audit-scratch/disc2-api/vitest.unit.scratch.config.ts --silent=false api-routes` (4/4 pass = defects reproduced) |
| `pdf-cost.unit.ts` | Render time and memory of `renderCertificatePdf` | same config, `pdf-cost` |
| `table.mjs`, `annotate.mjs` | Generate the coverage table below | `node …/table.mjs > table.txt && node …/annotate.mjs` |

## Method

For each route: the `api()` options (auth default, rate limit, body limit, Idempotency-Key), the Zod schema against the SQL argument types and the JSON keys the SQL reads (`p_admin ->> 'lotId'` etc.), the path parameters passed to the RPC (the URL clinic id is the one checked, not a body field), the allowlist, the response mapping (`null` → 404, `fromDbError`), pagination bounds, response projection (PII), side effects on GET, and the client caller where one exists. For each SQL function: the authorization helper and whether the object id is scoped to the path clinic before anything is locked or revealed.

Contract sweep results (mechanical, all pass): every one of the 195 `rpc.rpc` call sites passes only argument names the latest SQL signature has and every required argument (`argcheck.mjs`). Every JSON key read by the SQL from a jsonb argument (`p_admin`, `p_product`, `p_session`, `p_child`, `p_guardian`, `p_patch`, `p_dose`, `p_items`, `p_proposal`) matches the strict Zod schema; extra keys the SQL accepts but Zod refuses (`administeredBy`, `doses`) are additionally guarded in SQL (`record_administration`: named vaccinator must hold `vaccination.record`; `doses <> 1` refused). No public API-callable function is declared `STABLE`/`IMMUTABLE` while writing (PostgREST would run it read-only on Supabase): only `get_my_context`, `list_public_clinics`, `my_appointments`, `my_children` are `STABLE`, and they do not write. Every mutation passes the Idempotency-Key to a receipt (`begin_command`, `scheduling_replay`, or a wrapper whose `_prev`/`_base` uses one), except the deliberately read-like `qr/resolve` and the naturally idempotent `me/messages/read`.

## 1. Coverage

"new" = route body read for the first time in this iteration; "re-read" = also listed as read in `security.md` "Object authorization" / custom routes (re-read here for the route-level checks above). 125 files: 98 new, 27 re-read.

| Route file (`src/app/api/v1/…`) | Methods | RPC | Read | Status |
|---|---|---|---|---|
| `appointments/[appointmentId]/cancel/route.ts` | POST | cancel_appointment | re-read (prior: security.md) | Inspected |
| `appointments/[appointmentId]/reschedule/route.ts` | POST | reschedule_appointment | new | Inspected |
| `appointments/route.ts` | GET, POST | my_appointments, book_appointment | re-read (prior: security.md) | Inspected |
| `certificates/[certificateId]/download/route.ts` | GET | get_certificate_pdf | re-read (prior: security.md) | Inspected |
| `children/[childId]/catchup-plan/route.ts` | GET | guardian_get_catchup_plan | new | Inspected |
| `children/[childId]/certificates/route.ts` | GET | guardian_list_certificates | re-read (prior: security.md) | Inspected |
| `children/[childId]/checkins/route.ts` | GET, POST | my_checkins, create_checkin | new | Inspected |
| `children/[childId]/edit-requests/route.ts` | POST | request_child_edit | new | Inspected |
| `children/[childId]/history/route.ts` | GET | guardian_child_history | re-read (prior: security.md) | Inspected |
| `children/[childId]/outside-doses/route.ts` | POST | report_outside_dose | new | Inspected |
| `children/[childId]/qr/route.ts` | POST, DELETE | issue_qr_pass, revoke_qr_pass | re-read (prior: security.md) | Inspected |
| `children/[childId]/queue-status/route.ts` | GET | guardian_queue_status | new | Inspected |
| `children/[childId]/record-transfers/[transferId]/cancel/route.ts` | POST | cancel_record_transfer_guardian | re-read (prior: security.md) | Inspected |
| `children/[childId]/record-transfers/route.ts` | GET, POST | my_record_transfers, request_record_transfer_guardian | re-read (prior: security.md) | Inspected |
| `children/[childId]/schedule/route.ts` | GET | guardian_get_schedule | new | Inspected |
| `children/route.ts` | GET, POST | my_children, create_child_provisional | new | Inspected |
| `clinics/[clinicId]/administrations/[eventId]/corrections/route.ts` | POST | request_correction | new | Inspected |
| `clinics/[clinicId]/administrations/[eventId]/exception-decision/route.ts` | POST | resolve_administration_exception | new | Inspected |
| `clinics/[clinicId]/appointments/route.ts` | GET | list_appointments | new | Inspected |
| `clinics/[clinicId]/audit/route.ts` | GET | search_audit | re-read (prior: security.md) | Defect found (API-03) |
| `clinics/[clinicId]/available-sessions/route.ts` | GET | guardian_list_sessions | new | Inspected |
| `clinics/[clinicId]/catchup-items/[itemId]/status/route.ts` | POST | set_catchup_item_status | new | Inspected |
| `clinics/[clinicId]/catchup-plans/[planId]/cancel/route.ts` | POST | cancel_catchup_plan | new | Inspected |
| `clinics/[clinicId]/catchup-plans/[planId]/review/route.ts` | POST | review_catchup_plan | new | Inspected |
| `clinics/[clinicId]/catchup-plans/[planId]/submit/route.ts` | POST | submit_catchup_plan | new | Inspected |
| `clinics/[clinicId]/catchup-reviews/route.ts` | GET | list_catchup_reviews | new | Inspected |
| `clinics/[clinicId]/certificates/[certificateId]/retry/route.ts` | POST | begin_certificate_render, store_certificate_pdf | re-read (prior: security.md) | Defect found (API-01, API-02) |
| `clinics/[clinicId]/certificates/[certificateId]/revoke/route.ts` | POST | revoke_certificate | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/checkin-policy/route.ts` | GET, POST | get_checkin_policy, set_checkin_policy | new | Inspected |
| `clinics/[clinicId]/checkins/[checkinId]/answer/route.ts` | POST | answer_checkin | new | Inspected |
| `clinics/[clinicId]/checkins/route.ts` | GET | list_checkins | new | Defect found (API-09) |
| `clinics/[clinicId]/children/[childId]/administration-exceptions/route.ts` | POST | record_administration_exception | new | Inspected |
| `clinics/[clinicId]/children/[childId]/catchup-plans/route.ts` | GET, POST | list_catchup_plans, save_catchup_draft | new | Inspected |
| `clinics/[clinicId]/children/[childId]/certificates/route.ts` | GET, POST | list_child_certificates, issue_certificate, begin_certificate_render, store_certificate_pdf | new | Defect found (API-01, API-02) |
| `clinics/[clinicId]/children/[childId]/confirm-identity/route.ts` | POST | confirm_child_identity | new | Inspected |
| `clinics/[clinicId]/children/[childId]/followup-attempts/route.ts` | POST | log_followup_attempt | new | Inspected |
| `clinics/[clinicId]/children/[childId]/history/route.ts` | GET | list_child_history | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/children/[childId]/holds/route.ts` | GET, POST | list_clinical_holds, place_clinical_hold | new | Inspected |
| `clinics/[clinicId]/children/[childId]/outside-doses/route.ts` | POST | record_outside_dose_staff | new | Inspected |
| `clinics/[clinicId]/children/[childId]/qr/route.ts` | POST, DELETE | issue_qr_pass, revoke_qr_pass | new | Inspected |
| `clinics/[clinicId]/children/[childId]/record-transfer/route.ts` | POST | initiate_record_transfer_out | new | Inspected |
| `clinics/[clinicId]/children/[childId]/route.ts` | GET, PATCH | staff_get_child, update_child_identity | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/children/[childId]/schedule/route.ts` | GET | evaluate_child | new | Defect found (API-08) |
| `clinics/[clinicId]/children/route.ts` | GET, POST | staff_search_children, register_child_staff | new | Defect found (FE-10 (known)) |
| `clinics/[clinicId]/clinical-master/antigens/route.ts` | POST | create_antigen | new | Inspected |
| `clinics/[clinicId]/clinical-master/products/route.ts` | POST | create_vaccine_product | new | Inspected |
| `clinics/[clinicId]/clinical-master/route.ts` | GET | list_clinical_master | new | Inspected |
| `clinics/[clinicId]/clinical-master/status/route.ts` | POST | set_master_status | new | Inspected |
| `clinics/[clinicId]/content/[versionId]/retire/route.ts` | POST | retire_content | new | Inspected |
| `clinics/[clinicId]/content/[versionId]/review/route.ts` | POST | review_content | new | Inspected |
| `clinics/[clinicId]/content/[versionId]/submit/route.ts` | POST | submit_content | new | Inspected |
| `clinics/[clinicId]/content/route.ts` | GET, POST | list_content, save_content_draft | new | Inspected |
| `clinics/[clinicId]/corrections/[caseId]/approve/route.ts` | POST | approve_correction | new | Inspected |
| `clinics/[clinicId]/corrections/[caseId]/reject/route.ts` | POST | reject_correction | new | Inspected |
| `clinics/[clinicId]/encounters/[encounterId]/administrations/route.ts` | POST | record_administration | new | Inspected |
| `clinics/[clinicId]/evidence/[eventId]/verify/route.ts` | POST | verify_outside_dose | new | Inspected |
| `clinics/[clinicId]/followup/refresh/route.ts` | POST | refresh_followup | new | Inspected |
| `clinics/[clinicId]/followup/route.ts` | GET | list_followup_worklist | re-read (prior: security.md) | Defect found (FE-10 (known)) |
| `clinics/[clinicId]/guardians/[guardianId]/verify-contact/route.ts` | POST | verify_guardian_contact | new | Inspected |
| `clinics/[clinicId]/holds/[holdId]/release/route.ts` | POST | release_clinical_hold | new | Inspected |
| `clinics/[clinicId]/merges/route.ts` | POST | merge_children | re-read (prior: security.md) | Defect found (SEC-05 (fixed in 0034)) |
| `clinics/[clinicId]/ops/route.ts` | GET, POST | get_ops_status, record_ops_check | new | Inspected |
| `clinics/[clinicId]/paper-tallies/route.ts` | POST | record_paper_tally | new | Inspected |
| `clinics/[clinicId]/privacy-notice/acknowledge/route.ts` | POST | acknowledge_clinic_privacy_notice | new | Defect found (DB-03 (known)) |
| `clinics/[clinicId]/privacy-notice/route.ts` | GET, POST | get_privacy_notice, set_privacy_notice | new | Inspected |
| `clinics/[clinicId]/profile/route.ts` | GET, POST | get_clinic_profile, update_clinic_profile | new | Inspected |
| `clinics/[clinicId]/qr/resolve/route.ts` | POST | resolve_qr | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/queue/[entryId]/priority/route.ts` | POST | set_queue_priority | new | Inspected |
| `clinics/[clinicId]/queue/[entryId]/transition/route.ts` | POST | queue_transition | new | Inspected |
| `clinics/[clinicId]/queue/call-next/route.ts` | POST | call_next | new | Inspected |
| `clinics/[clinicId]/queue/check-in/route.ts` | POST | check_in | new | Defect found (API-05) |
| `clinics/[clinicId]/queue/display/route.ts` | GET | public_queue_display | new | Inspected |
| `clinics/[clinicId]/queue/route.ts` | GET | list_queue | new | Inspected |
| `clinics/[clinicId]/record-transfers/[transferId]/accept/route.ts` | POST | accept_record_transfer | new | Inspected |
| `clinics/[clinicId]/record-transfers/[transferId]/decline/route.ts` | POST | decline_record_transfer | new | Inspected |
| `clinics/[clinicId]/record-transfers/[transferId]/release/route.ts` | POST | approve_record_transfer_release | new | Inspected |
| `clinics/[clinicId]/record-transfers/route.ts` | GET | list_record_transfers | new | Inspected |
| `clinics/[clinicId]/relationships/[relationshipId]/status/route.ts` | POST | set_relationship_status | new | Inspected |
| `clinics/[clinicId]/relationships/[relationshipId]/verify/route.ts` | POST | verify_relationship | new | Inspected |
| `clinics/[clinicId]/reports/[name]/export/route.ts` | GET | report_* (catalog) | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/reports/[name]/route.ts` | GET | report_* (catalog) | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/review-cases/[caseId]/resolve-link/route.ts` | POST | resolve_link_case | new | Defect found (API-04) |
| `clinics/[clinicId]/review-cases/[caseId]/resolve/route.ts` | POST | resolve_review_case | new | Defect found (API-04 (also IMP-01)) |
| `clinics/[clinicId]/review-cases/route.ts` | GET | list_review_cases | new | Defect found (FE-02 (known)) |
| `clinics/[clinicId]/schedules/[versionId]/activate/route.ts` | POST | activate_schedule | new | Inspected |
| `clinics/[clinicId]/schedules/[versionId]/approve/route.ts` | POST | approve_schedule | new | Inspected |
| `clinics/[clinicId]/schedules/[versionId]/discard/route.ts` | POST | discard_schedule_draft | new | Inspected |
| `clinics/[clinicId]/schedules/[versionId]/impact/route.ts` | GET | preview_schedule_impact | new | Inspected |
| `clinics/[clinicId]/schedules/[versionId]/retire/route.ts` | POST | retire_schedule | new | Inspected |
| `clinics/[clinicId]/schedules/[versionId]/route.ts` | GET | get_schedule_version | new | Inspected |
| `clinics/[clinicId]/schedules/[versionId]/submit/route.ts` | POST | submit_schedule_for_review | new | Inspected |
| `clinics/[clinicId]/schedules/route.ts` | POST | import_schedule_draft | new | Defect found (API-06 (repro)) |
| `clinics/[clinicId]/sessions/[sessionId]/cancel/route.ts` | POST | cancel_session | new | Inspected |
| `clinics/[clinicId]/sessions/route.ts` | GET, POST | list_sessions, create_session | new | Inspected |
| `clinics/[clinicId]/staff/[membershipId]/approve/route.ts` | POST | approve_staff_membership | re-read (prior: security.md) | Defect found (API-04) |
| `clinics/[clinicId]/staff/[membershipId]/revoke/route.ts` | POST | revoke_staff_membership | new | Defect found (API-04) |
| `clinics/[clinicId]/staff/route.ts` | GET, POST | list_staff_memberships, find_profile_for_grant, request_staff_membership | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/stock/adjustments/[caseId]/approve/route.ts` | POST | approve_stock_adjustment | new | Inspected |
| `clinics/[clinicId]/stock/adjustments/route.ts` | POST | propose_stock_adjustment | new | Inspected |
| `clinics/[clinicId]/stock/locations/route.ts` | POST | create_stock_location | new | Inspected |
| `clinics/[clinicId]/stock/lots/[lotId]/disposition/route.ts` | POST | set_lot_disposition | new | Inspected |
| `clinics/[clinicId]/stock/lots/[lotId]/ledger/route.ts` | GET | list_lot_ledger | re-read (prior: security.md) | Inspected |
| `clinics/[clinicId]/stock/lots/[lotId]/trace/route.ts` | GET | trace_lot_use | new | Defect found (DB-04 (known)) |
| `clinics/[clinicId]/stock/lots/route.ts` | POST | register_lot | new | Inspected |
| `clinics/[clinicId]/stock/receipts/route.ts` | POST | receive_stock | new | Inspected |
| `clinics/[clinicId]/stock/reconcile/route.ts` | POST | reconcile_stock | new | Inspected |
| `clinics/[clinicId]/stock/route.ts` | GET | list_stock | new | Inspected |
| `clinics/[clinicId]/stock/temperature/[readingId]/review/route.ts` | POST | review_temperature_excursion | new | Inspected |
| `clinics/[clinicId]/stock/temperature/limits/route.ts` | POST | set_cold_chain_limits | new | Inspected |
| `clinics/[clinicId]/stock/temperature/route.ts` | GET, POST | list_temperature, record_temperature | new | Inspected |
| `clinics/[clinicId]/stock/transfers/[transferId]/cancel/route.ts` | POST | cancel_stock_transfer | new | Inspected |
| `clinics/[clinicId]/stock/transfers/[transferId]/receive/route.ts` | POST | receive_stock_transfer | new | Inspected |
| `clinics/[clinicId]/stock/transfers/[transferId]/resolve/route.ts` | POST | resolve_transfer_shortfall | new | Inspected |
| `clinics/[clinicId]/stock/transfers/route.ts` | GET, POST | list_stock_transfers, send_stock_transfer | new | Inspected |
| `clinics/[clinicId]/stock/wastage/route.ts` | POST | record_wastage | new | Inspected |
| `clinics/route.ts` | GET | list_public_clinics | new | Inspected |
| `guardian-links/route.ts` | POST | request_guardian_link | re-read (prior: security.md) | Inspected |
| `health/route.ts` | GET | — | re-read (prior: security.md) | Inspected |
| `me/care-content/route.ts` | GET | guardian_care_content | new | Inspected |
| `me/contact-preferences/route.ts` | GET, POST | get_contact_preferences, set_contact_preferences | re-read (prior: security.md) | Inspected |
| `me/messages/read/route.ts` | POST | mark_messages_read | re-read (prior: security.md) | Inspected |
| `me/messages/route.ts` | GET | my_messages | new | Inspected |
| `me/route.ts` | GET | get_my_context | new | Inspected |
| `verify/[token]/route.ts` | GET | verify_certificate | re-read (prior: security.md) | Inspected |
| `webhooks/sms/route.ts` | POST | private.record_sms_event | re-read (prior: security.md) | Inspected |

Shared code also read end to end: `src/lib/api/{handler,errors,body,query}.ts`, `src/lib/db/{port,index,supabase,local}.ts`, `src/lib/validation/*.ts` (13 files), `src/lib/reports/catalog.ts`, `src/lib/client/api.ts` (`callApi`/`useMutation` key rotation), `src/lib/sms/webhook.ts`, `src/proxy.ts`, `next.config.ts`, `src/lib/certificates/{pdf,service}.ts`, `scripts/backup-drill.ts`, `scripts/backup-integrity.ts`, `scripts/db.ts` (`assertProjectCluster`).

## 2. Findings

No P0, P1 or P2 defect was found in the route layer. The SQL layer behind the routes is consistently scoped: every object-id route checks the object against the path clinic (`clinic_id = p_clinic_id`, `child_in_clinic`, `from/to_clinic_id = p_clinic_id`) or against the organization for org-level objects (schedule versions, lots, master data), and raises the same CV404 for "absent" and "not yours". The findings below are the exceptions and the route-level gaps.

### API-01 — Certificate issue reports a deterministic render failure as "saved, retry", and retry can never succeed
- Priority: P3
- Class: Reproduced defect
- Location: `src/app/api/v1/clinics/[clinicId]/children/[childId]/certificates/route.ts:16-22` (catch-all → `{status:"pending", needsRetry:true}`, HTTP 200); `src/lib/certificates/pdf.ts:52-58` (glyph check → 422 "…Edit the source record and try again."); `supabase/migrations/0027_certificate_attestation.sql:9-22` (`begin_certificate_render` re-uses the frozen `c.snapshot`), `:42` (`CV503`); `src/lib/api/errors.ts:43-58` (`CV503` not in `BY_STATE`); `src/lib/certificates/service.ts:47-54`; UI `src/app/clinic/[clinicId]/children/[childId]/certificates.tsx:69-72`.
- Evidence: `api-routes.unit.ts` "API-01" (real route modules, simulated RPC client; snapshot child name `Ana 🙂 Santos`):
  `issue: 200 {"certificateId":"3333…","certificateNo":"CERT-000009","status":"pending","needsRetry":true}` → `retry 1 : 422 childName contains a character the certificate font cannot display. Edit the source record and try again.` → `retry 2 : 422` (same). `store_certificate_pdf` is never called. `fromDbError({code:"CV503"})` → `500 internal` (renderer secret missing in the database answers "Something went wrong on our side" instead of "The service is not configured").
- Impact: Staff are told "The certificate record was saved. Use 'Generate document again'"; every retry fails. The 422 tells them to edit the source record, but the snapshot was frozen by `issue_certificate`, so editing the child/clinic/issuer record cannot fix this certificate; the only way out is "Discard certificate" and issue again, which nothing tells them. Same dead end for an oversized document (`CV422 the document is too large`) and a missing renderer secret (`CV503`, shown as an internal error). Rare in practice (the bundled Noto Sans SC covers Latin, Filipino diacritics and CJK; emoji and some scripts are not covered), hence P3.
- Root cause: The issue route treats every post-prepare failure as transient, and the glyph error message assumes a live source.
- Solution: In the issue route, catch only transient failures (network/5xx, `conflict` from a superseded render) as "pending, retry"; for `AppError` 422 return `{status:"pending", needsRetry:false, problem:<message>}` (or the 422 itself with the certificate id) so the UI can say "This certificate cannot be printed: <field> contains a character the certificate font cannot show. Discard it, correct the record, then issue a new one." Reword the `pdf.ts` message accordingly. Add `CV503: ["misconfigured", 503]` to `BY_STATE`. Optional: in `renderAndStore`'s replay path, read the certificate number from `list_child_certificates`/a light RPC instead of `get_certificate_pdf`, which transfers the whole PDF and writes a false `certificate.downloaded` audit row on every replayed issue.
- Acceptance: Issuing with an unsupported character returns a non-retryable outcome naming the field and the discard-and-reissue path; retry is not offered for it; a missing renderer secret answers 503 `misconfigured`.
- Verification: Promote the scratch test into `tests/unit/` with inverted expectations; unit test `fromDbError({code:"CV503"}).status === 503`.

### API-02 — Unused 16 MB font is traced into 165 of 167 server bundles; the required certificate font is untracked in git
- Priority: P3
- Class: Reproduced defect (packaging)
- Location: `next.config.ts:8-10` (`outputFileTracingIncludes: { "/*": ["./src/lib/certificates/fonts/*"] }`); `src/lib/certificates/fonts/` (`NotoSansCJKsc-Regular.otf` 16,437,364 B, unreferenced; `NotoSansSC.ttf` 10,582,472 B, used by `pdf.ts:21`); `git status`: `?? src/lib/certificates/fonts/`.
- Evidence: `grep -rn NotoSansCJK` over the project (excluding `node_modules`/`.next`) finds no reference. In the current `next build` output (`BUILD_ID` 2026-10-02 18:12), `find .next/server -name "*.nft.json" | xargs grep -l NotoSansCJKsc | wc -l` → 165 of 167 traces, e.g. `.next/server/app/api/v1/me/route.js.nft.json` lists the OTF, the TTF and the license although `/api/v1/me` never renders a certificate. The fonts directory is untracked (not ignored).
- Impact: ~27 MB of font files ship with every route on per-function hosts (slower deploys/cold storage, closer to function size limits) when only three certificate routes need 10.6 MB. If the working tree is committed without `src/lib/certificates/fonts/NotoSansSC.ttf`, every clean checkout (CI `certificate-pdf.test.ts`, deployments) fails certificate generation (`ENOENT` → issue answers "pending, retry" forever, see API-01).
- Solution: Delete the unused OTF (or move it out of `src/`), commit `NotoSansSC.ttf` + license + README, and narrow the trace include to the two routes that render, pointing at the TTF only. Keys are picomatch route globs (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md:80-101`), so brackets must be escaped or wildcarded, e.g. `"/api/v1/clinics/*/children/*/certificates"` and `"/api/v1/clinics/*/certificates/*/retry"` → `["./src/lib/certificates/fonts/NotoSansSC.ttf"]`.
- Acceptance: After `next build`, only the two certificate-rendering routes' `.nft.json` reference a font, and only `NotoSansSC.ttf`; `git ls-files src/lib/certificates/fonts` lists the TTF and its license.
- Verification: `find .next/server -name "*.nft.json" | xargs grep -l NotoSans` lists exactly those routes; CI runs `certificate-pdf.test.ts` green from a clean clone.

### API-03 — Audit search API: 0034 keyset paging is not wired through, and malformed date filters return 500
- Priority: P3
- Class: Reproduced defect
- Location: `src/app/api/v1/clinics/[clinicId]/audit/route.ts:9-12` (raw `from`/`to`/`before` strings, no `p_before_id`); `src/app/clinic/[clinicId]/audit/page.tsx:35` and `:93-95` (same: `p_before` only, "Older entries" link carries `before` only); `supabase/migrations/0034_integrity_performance.sql:739-768` (`search_audit` now takes `p_before_id` and returns `nextBeforeId`); `src/lib/api/errors.ts:43-58` (SQLSTATE `22008` unmapped).
- Evidence: `api-routes.unit.ts` "API-03": `GET …/audit?from=2026-02-30&before=2026-10-02T00:00:00Z&beforeId=<uuid>` sends `{"p_from":"2026-02-30",…,"p_before":"2026-10-02T00:00:00Z","p_limit":50}` (no `p_before_id`). PostgreSQL raises `22008 date/time field value out of range` for `'2026-02-30'::timestamptz`; `fromDbError({code:"22008"})` → `500 internal`. In SQL, `p_before_id is null` selects the old `server_time < p_before` branch, so rows sharing the boundary timestamp are still skipped between pages (the DB-06 tie-break exists but no caller uses it).
- Impact: Auditors paging through bursts (one command writes several rows in one transaction with the same `server_time`) silently miss entries at page boundaries, which defeats the purpose of DB-06's fix. API clients sending an impossible date get "Something went wrong on our side" (logged as an unhandled error) instead of a 422.
- Root cause: 0034 changed the function contract; the route and page were not updated. Query parameters are passed through unvalidated.
- Solution: Route: validate `from`/`to` with `z.iso.date()` (convert with `clinicDateBoundary` like the page) and `before` with `z.iso.datetime({ offset: true })`, accept `beforeId` (`z.uuid()`), pass `p_before_id`, and return `nextBeforeId`. Page: pass `p_before_id: sp.beforeId` and put `beforeId: data.nextBeforeId` in the "Older entries" link. Optionally map `22008` to 422 in `BY_STATE`.
- Acceptance: With 60 audit rows sharing one `server_time`, paging 50 + rest via the API and the page returns all 60 exactly once; `?from=2026-02-30` returns 422.
- Verification: DB test in `tests/db/` (owner of `config.test.ts`) inserting tied rows and paging through `search_audit` with `p_before_id`; unit test on the route's query validation.

### API-04 — Four mutation routes ignore the clinic in their URL; the SQL locks the target row and answers 403 vs 404 before any clinic/organization check
- Priority: P3
- Class: Inspection risk
- Location: routes `src/app/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve/route.ts:5`, `…/review-cases/[caseId]/resolve-link/route.ts:5-12`, `…/staff/[membershipId]/approve/route.ts:5`, `…/staff/[membershipId]/revoke/route.ts:5` (no `p_clinic_id` passed); SQL `supabase/migrations/0003_registry.sql:787-789` (`resolve_review_case`: `select … where id = p_case_id for update` → `require_capability(v_case.clinic_id, …)`), `:659-661` (`resolve_link_case`, same), `0002_staff_access.sql:60-64` (`approve_staff_membership`), `:90-93` (`revoke_staff_membership`).
- Evidence (code, not executed): the functions take no clinic argument. For any case/membership UUID they take `FOR UPDATE` on the row, then raise `CV403 forbidden` if it belongs to a clinic where the caller lacks the capability, or `CV404` if it does not exist. A caller with `review.resolve` at clinic A can therefore post `…/clinics/A/review-cases/<id of clinic B or another organization>/resolve` and learn whether that id exists (403 vs 404) while briefly locking another tenant's row; a caller who does hold the capability at clinic B succeeds through clinic A's URL, so the URL and the audited clinic disagree. Same class as SEC-05 (fixed for `merge_children` in 0034), at lower stakes because the ids are random v4 UUIDs.
- Impact: Cross-tenant existence oracle and lock on review cases and staff memberships; URL-scoped API contract not enforced (log/monitoring by clinic path is misleading).
- Root cause: These functions predate the clinic-in-path convention; the routes cannot pass a clinic the functions do not accept.
- Solution: Forward migration adding `p_clinic_id` overloads (or wrappers) that resolve the row with `id = $1 and clinic_id = p_clinic_id` (CV404 otherwise) after `require_capability(p_clinic_id, …)` and before `FOR UPDATE`; routes pass `params.clinicId`; revoke the old signatures from `authenticated` once the routes switch.
- Acceptance: For a case/membership of another clinic or organization the routes answer 404 regardless of the caller's capabilities elsewhere, and no lock is taken on that row.
- Verification: DB tests mirroring `.local/audit-scratch/security/idor.dbtest.ts` (foreign case id → CV404; same-clinic → success).

### API-05 — `check_in` wrapper inspects and locks a foreign child's appointment/session before the clinic ownership check (SEC-05 sibling left unfixed)
- Priority: P3
- Class: Inspection risk
- Location: `supabase/migrations/0025_scheduling_integrity.sql:53-75` (`require_capability(p_clinic_id,'queue.manage')` → `scheduling_replay` → `select … from children where id = v_child for update` (`:62`) → appointment/session lookup with `for update` and `CV409 'this session was cancelled'` (`:64-67`) → `check_in_prev` whose `child_in_clinic` check is at `0013_visit_commands.sql:206`); route `src/app/api/v1/clinics/[clinicId]/queue/check-in/route.ts:6-12` passes `body.childId`/`body.appointmentId`.
- Evidence (code, not executed): with `queue.manage` at clinic A, `check_in(op, A, <foreign child>, <its appointment>)` returns `CV409 this session was cancelled` when that appointment's session is cancelled and `CV404` otherwise, and takes `FOR UPDATE` locks on the foreign child and session rows first. 0034 fixed exactly this ordering in `merge_children` (`0034:322-336`) but not here; `book_appointment`, `reschedule_appointment`, `queue_transition` and `accept_record_transfer` wrappers authorize or scope before locking.
- Impact: Low-grade cross-tenant state oracle and lock contention (requires knowing UUIDs).
- Solution: In a forward migration, redefine the wrapper to raise CV404 unless `private.child_in_clinic(private.canonical_child(p_child_id), p_clinic_id)` (and, when given, the appointment belongs to that child and a session of `p_clinic_id`) before any lock or state check.
- Acceptance: Foreign child/appointment → CV404 regardless of session state; no lock taken on foreign rows.
- Verification: DB test alongside the SEC-05 regression in `tests/db/registry.test.ts`.

### API-06 — Unauthenticated requests to authenticated routes are read, parsed and validated (up to 5 MB) before the 401; with the shared-bucket opt-in they are not rate limited at all
- Priority: P3
- Class: Reproduced defect
- Location: `src/lib/api/handler.ts:70-71` (pre-authentication limit skipped when `client.shared`), `:88` (body read and `JSON.parse`), `:91-96` (Zod), `:103-104` (session, 401); `src/app/api/v1/clinics/[clinicId]/schedules/route.ts:4` (`maxBodyBytes: 5_000_000`).
- Evidence: `api-routes.unit.ts` "API-06", anonymous client (no session) on `POST /api/v1/clinics/<id>/schedules`: malformed JSON → **400**, schema-invalid body → **422** with field errors, 4.9 MB valid body → **401** only after `4900022 bytes parsed in 15.3 ms`. In development or with `CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET=1` (production opt-in, `src/lib/env.ts:49-60`), `clientAddress()` is `shared`, so authenticated routes apply no limit before `session()`; the code comment ("unauthenticated requests are simply refused below (401)") understates the work done first. With a trusted client header the pre-auth ceiling is 10 × the route limit per address per route (100/min × 5 MB on `schedules`).
- Impact: Cheap CPU/memory amplification against any instance for anonymous clients (most severe in the documented shared-bucket mode); schema details are disclosed to unauthenticated callers (minor).
- Root cause: Body handling precedes authentication so that malformed requests never construct an RPC client (`tests/unit/api-handler.test.ts` asserts that order).
- Solution: For `auth !== false` routes, resolve the session before reading the body (constructing the RPC client is cheap; `getUser()` without a cookie makes no network call), or at minimum reject requests without a Supabase/dev session cookie with 401 before reading the body; in shared mode charge a deployment-wide pre-auth ceiling for anonymous requests to authenticated routes. Update `api-handler.test.ts` to assert "no body read for anonymous callers" instead.
- Acceptance: An anonymous POST with any body to an authenticated route returns 401 without the body being read; the existing malformed-body tests still pass for authenticated callers.
- Verification: Promote the scratch test with inverted expectations (spy on `readBoundedText`).

### API-07 — Every authenticated API call makes two Supabase Auth network calls, both before the per-user rate limit
- Priority: P3
- Class: Inspection risk (performance/availability; Supabase not available locally)
- Location: `src/proxy.ts:52` (`supabase.auth.getUser()` for every matched request, matcher `:67-69` includes `/api/*`); `src/lib/db/supabase.ts:17-21` (`session()` calls `getUser()` again); `src/lib/api/handler.ts:103-106` (per-user limit after `session()`); auth-js `GoTrueClient.js:2698-2720` (`getUser` always `GET /auth/v1/user`).
- Evidence (code): one API request in Supabase mode = proxy `getUser` + handler `getUser` = 2 Auth round trips, plus a refresh call when the access token is expired. Neither is preceded by a rate limit, so a client replaying a bogus or expired session cookie makes the web server call Supabase Auth (`/user` or `/token`) on every request; Auth sees the web server's address, so its per-IP limits apply to all users together. FE-07 covers the same duplication for pages and accepts "one getUser plus the proxy refresh"; API routes were not included.
- Impact: Doubled Auth latency on every API call over slow clinic links; an anonymous flood with forged cookies consumes the deployment's shared Auth allowance (outcome depends on Supabase project limits, External).
- Solution: In the proxy, skip `/api/v1/*` (API routes re-authenticate and the cookie refresh happens in `session()`), or use `auth.getClaims()` there (local JWT verification with asymmetric signing keys) and keep `getUser()` only where a revocation-checked identity is required. Consider charging the pre-auth limit before `session()` when a session cookie is present.
- Acceptance: In Supabase mode an authenticated API request makes at most one Auth network call (zero with `getClaims` and asymmetric keys).
- Verification: Unit test with a counting `fetch` stub through `proxy()` + `api()` (pattern of `.local/audit-scratch/security/signout.unit.ts`); external: Supabase Auth logs during a staging load test.

### API-08 — `GET …/children/:childId/schedule?asOf=` persists an evaluation (and dose-credit rows) for any caller-chosen date, and with today's date re-assigns the child's programme
- Priority: P3
- Class: Inspection risk
- Location: `src/app/api/v1/clinics/[clinicId]/children/[childId]/schedule/route.ts:5-12` (`asOf` any ISO date, rate 120/min); `supabase/migrations/0007_schedule_engine.sql:278-292` (`evaluate_child` → `compute_child_schedule(…, true)`); `private.compute_child_schedule` (latest: `0025_scheduling_integrity.sql:305`) inserts `schedule_evaluations` keyed by `as_of_date` + `dose_credits`, and updates `child_programs` when `p_as_of` is today.
- Evidence (code): no UI caller passes `asOf` (the clinic child page calls `evaluate_child` with `p_as_of: null`); the API accepts any date, and each distinct date inserts a new evaluation plus one credit row per requirement. A user with `child.read_clinical` (or a script using their session) can create up to ~170k evaluations (plus their credit rows) per child per day within the 120/min limit by walking dates.
- Impact: A GET that writes clinical-history tables without bound; storage growth and noise in evaluation history; GET semantics violated (side effects beyond audit).
- Solution: Persist only for `asOf` = clinic today (or within the active schedule's window); for other dates call `compute_child_schedule(…, false)` and return a preview without `evaluationId`; or drop the `asOf` parameter from the API until a caller needs it.
- Acceptance: `GET …/schedule?asOf=1990-01-01` returns a preview and inserts no `schedule_evaluations`/`dose_credits` rows.
- Verification: DB test counting `schedule_evaluations` rows before/after a historical-date call.

### API-09 — `GET …/checkins?status=answered|closed` returns the clinic's entire question history (messages and replies) with no limit
- Priority: P3
- Class: Inspection risk
- Location: `src/app/api/v1/clinics/[clinicId]/checkins/route.ts:3`; `supabase/migrations/0021_catchup_checkins.sql:337-345` (`list_checkins`: no `limit`, filter `status = p_status`).
- Evidence (code): open check-ins are naturally bounded (3 per child), but answered/closed ones accumulate forever; the route exposes them with message bodies, guardian questions and answers, and writes an audit row per call. The UI only requests `open` (`questions/page.tsx:46`).
- Impact: Response size and query time grow without bound; bulk disclosure of sensitive free text in one call to anyone with `child.read_clinical`.
- Solution: Add `p_limit` (≤ 100) and a keyset cursor to `list_checkins` for non-open statuses, or restrict the route to `open` until a history view exists.
- Acceptance: Non-open listings are capped and pageable.
- Verification: DB test with > 100 answered check-ins.

### API-10 — The restore drill restores into the same local cluster, so it does not prove a restore onto a fresh server
- Priority: P3
- Class: Inspection risk (evidence gap)
- Location: `scripts/backup-drill.ts:63-101`; `docs/implementation/decisions.md:61` (D57 "restore to a fresh database"); `docs/implementation/known-limitations.md:33,40` (L27, L34: Supabase restore unverified).
- Evidence (code): `pg_dump -Fc` excludes cluster globals; the target `cvsrs_drill_restore` is created in the same cluster, where `anon`, `authenticated`, `cvsrs_outbox_worker`, `cvsrs_sms_webhook` and the `auth` shim already exist, so `GRANT … TO authenticated` succeeds and the grant hash matches trivially. `facts()` compares row counts in `public`/`private` only (not `auth`), API-role grants on `public` functions only (not the runtime roles' grants on `private.record_sms_event`/worker functions), and RLS flags but not policy definitions. No application-level read is executed against the restored copy. Safety is fine: destructive steps run only after `assertProjectCluster` (data-directory match) and only drop `cvsrs_drill_restore`; the source must match `cvsrs_*` and is only dumped.
- Impact: "Restore drill passed" is weaker evidence than D57 and the README imply: a disaster restore onto a new cluster/project (roles missing, extensions in `extensions`, auth users) is untested even locally.
- Solution: Restore into a throwaway second cluster (`initdb` on a temp data dir and port; create only the roles the migrations create, plus the Supabase role shim) with `pg_dumpall --globals-only` replayed first; compare `auth.users` counts, `pg_policies` definitions and every role's function privileges; run one authenticated RPC (`get_my_context` as a seeded profile) against the copy. Keep L34 for Supabase PITR.
- Acceptance: The drill fails if globals are not restored, if any policy or runtime-role grant differs, or if the smoke RPC fails.
- Verification: CI `drill:restore` run with the second-cluster mode.

## 3. Checked and found sound (no finding)

- **Wrapper `api()`**: same-origin on every non-GET, UUID path params (`*Id`), Idempotency-Key UUID on every mutation, bounded UTF-8 body (1 MB, 5 MB for schedule import), strict Zod, auth by default (only `clinics`, `queue/display`, `verify/[token]` opt out), per-user post-auth limit, safe error envelope, `cache-control: no-store`. All success responses are `200 {data}`; `null` → 404 is used deliberately for "not visible" reads. No mutation can return SQL NULL after committing (every mutation returns `finish_command(...)` or raises), so a saved mutation never surfaces as 404.
- **Path parameters**: in all 98 newly read routes the URL `clinicId` is the clinic passed to the SQL and checked by the SQL, except the four routes in API-04 and the clinic-less certificate retry (whose SQL checks the certificate's own clinic and returns NULL for absent and forbidden alike). Body-supplied foreign references are scoped in SQL: `send_stock_transfer` (receiving clinic must be another active clinic of the same organization; source location must belong to the path clinic), `check_in`/`book_appointment` (child), `resolve_link_case` (child must be in the case's clinic), `record_administration` (lot in organization, encounter in path clinic, named vaccinator authorised there).
- **SQL object scoping** for every newly read route with an object id (holds, relationships, guardian contacts, evidence, catch-up items/plans, corrections, stock adjustments/transfers/readings, content versions, schedule versions, sessions, queue entries, record transfers, check-ins, encounters): object resolved against the path clinic or organization and CV404 otherwise.
- **Error mapping**: every authored raise in API-reachable functions uses `CV400/401/403/404/409/422` except `CV503` (API-01) and `begin_command`'s reuse message (CV409 + hint → `already_saved`). Only CV409/CV422 text reaches clients.
- **Pagination**: `my_messages`, `search_audit`, `list_followup_worklist` capped at 100; `list_sessions`/`guardian_list_sessions` ≤ 92 days; `list_temperature` ≤ 90 days; `list_stock_transfers` 50 closed + all pending; `list_record_transfers` 90 days; `list_queue`/`list_appointments` one day. Exceptions: API-09; FE-02/FE-10 (known caps).
- **PII projection**: `staff_get_child` returns guardian phone/email only with `guardian.verify`; `public_queue_display` returns ticket labels and stations only; `list_public_clinics` non-sensitive fields; `get_contact_preferences` masks the phone; `verify_certificate` (prior) no PII.
- **Certificate PDF** (`pdf.ts`): untrusted text is drawn as glyph runs only (no markup/links/JavaScript); every snapshot string, the issuer, the verify URL and the date text are checked against the embedded font before rendering; all text wraps inside margins and paginates; TrueType subset embedding; storage is bounded in SQL (`≤ 2.8 MB base64`, `%PDF-` magic, SHA-256 and HMAC attestation, superseded-render detection). Measured render: 61–154 ms and ~35–90 MB transient RSS for a 12-entry certificate (`pdf-cost.unit.ts`), acceptable.
- **Certificate download** (`certificates/[certificateId]/download`): two-tier rate limit, session required, `get_certificate_pdf` authorises staff (`certificate.issue` at the certificate's clinic) or a full-access guardian of an issued certificate, `attachment` by default, `private, no-store`, `nosniff`, filename from the server-generated certificate number.
- **Health** (`/api/v1/health`): static JSON (`status`, `timestamp`, `service`, `version: "0.1.0"`), no configuration, database or dependency detail; it is a liveness probe only (it reports `ok` with the database down). Not a finding; a separate authenticated or internal readiness check would be needed for load-balancer health.
- **GET handlers and Next.js 16**: no `cacheComponents`, no `dynamic = 'force-static'`; per `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` Route Handlers are not cached by default, and `.next/prerender-manifest.json` lists no `/api` route. GET side effects are audit rows only, except API-08.
- **Client callers**: `useMutation` sends one key per logical submission and rotates it only after a definitive outcome; body keys match the schemas (also `frontend.md` sweep). Report routes call `def.rpc` from a closed catalog of four ranged reports, all with `(p_clinic_id, p_from, p_to, p_export)`.

## 4. Not verified

- **Live Supabase / PostgREST / Auth behaviour** (argument marshalling of `uuid[]`/`text[]`/jsonb, PostgREST error codes such as `PGRST202`/`PGRST301` reaching `fromDbError` as 500, Auth per-IP limits relevant to API-07): no project or credentials; code-level only.
- **Database execution**: the brief for this role excluded `test:db`, so API-04, API-05, API-08, API-09 and API-10 are inferred from the latest function bodies (followed through `_prev`/`_base` wrappers), not executed. API-03's 22008 relies on documented PostgreSQL behaviour plus the reproduced mapping.
- **Concurrency** (two retries of one pending certificate, concurrent check-ins): reasoned from locks and the superseded-render check, not executed.
- **Hosting packaging** (standalone vs per-function bundling for API-02): measured on the local `.next` traces only.
- **`npx tsc --noEmit`** was not needed for these findings and was not run.
