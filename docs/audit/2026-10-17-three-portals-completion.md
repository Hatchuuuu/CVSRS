# Three-portal implementation evidence

Updated19October2026. **Implementation is delivered; verification resumed on the user's instruction. All90distinct retained browser cases passed across retained phases.** Actual worker recovery, normal PostgreSQL/application restart, current production build and source checks passed. A fresh uninterrupted canonical full-suite pass remains unverified; do not describe this as zero-defect or universally complete acceptance.

The09:33 fresh run passed18cases before the user requested “finish it asap and stop.” Only the task-owned test runner and its descendants were stopped; `browser-current-full-user-stop.json` records the interruption. No canonical full pass is claimed. The normal port3000 application was left running. Read-only requests to readiness and all three portal entries returned200 (`normal-handoff-readiness.json`). Final protected-source reconciliation checked55files with zero drift; strictUTF8 decoding checked755source/test/script/SQL/document files with no invalid text. The pre-existing protected global stylesheet EOF warning remains.

The latest canonical launcher started19October14:43:44 (archived `browser-warmup-sleep-2026-10-19-process.json`, PID45904) and ended14:52:29 with a warmup timeout before browser cases began. Windows recorded Button or Lid sleep14:45:09 and resume14:45:12; events are preserved in `browser-warmup-sleep-power-events.json`. No uninterrupted canonical pass is claimed. This attempt followed after fresh source780/119, database456/37, build and matrix287 passes. The10:02 run passed75cases before the database stopped11:24:01; it ended11:24:27 with75passed/1failed/10skipped. Windows recorded an Explorer shutdown request11:25:40. Its original phase reports remain in `phases-2026-10-19T02-03-14.404Z` and launcher artifacts in `browser-service-interruption-2-2026-10-19.*`, with container/power-event evidence retained. The same application source remains unchanged. The09:33 user-stopped launcher artifacts are archived as `browser-user-stopped-2026-10-19.*`. The preceding run ended02:17:54 with70passed,1failed and4skipped after the isolated database stopped at02:17:15; the failed page returned service unavailable and the worker recorded ECONNREFUSED. Its original phase reports remain in `phases-2026-10-18T17-21-25.752Z`, with launcher artifacts archived as `browser-service-interruption-2026-10-19.*` and container state separately preserved. Docker services recovered before the fresh run. The earlier23:58:42 launcher disappeared without a terminal result before browser cases started; its log, manifest and observed interruption are preserved in `browser-current-full-interrupted*` and `browser-current-full-interruption-evidence.json`. None of these interrupted or failed invocations is claimed as a canonical pass.

## Scope and baseline

Parents, Clinics and the assigned-clinic Developer Console have separate navigation. Parents use dedicated registration/link tasks and Account contact settings. Clinic tasks remain capability-filtered. Technical staff provisioning reuses existing identity/access commands, independent approval, configuration and operations; its audit excludes clinical records and raw payloads.

Pre-existing work was preserved against the captured working-tree baseline, not HEAD. The baseline check overlapped new failing tests: **no pristine pre-edit build or screenshot set exists**. The [baseline report](2026-10-17-three-portals-baseline.md) records that exception. Later hashes/screenshots do not retroactively establish it.

Protected landing, sign-in, signup, recovery, MFA, auth handlers and global source matched55captured files with zero drift; the23:38 reconciliation also passed UTF8 validation for758files. Repeat final reconciliation after documentation updates. The whitespace report identifies only the pre-existing protected `globals.css` EOF warning at line612; that file was not cleaned up as part of this task.

The narrow Account password-form readiness change adds POST and disables controls until hydration. Password validation, pending/double-submit protection, `changePassword` and Auth calls remain unchanged. Profile, contact and staff-creation forms use equivalent readiness protection. Signup still gives immediate access without verification/confirmation email. No normal database reset, deployment or publication occurred; migration0062 was applied forward.

## Recorded acceptance evidence

All paths below are under `tmp/three-portals/` unless otherwise stated.

| Gate | Actual result | Evidence |
| --- | --- | --- |
| TypeScript/lint/units | Passed19October14:43:35:780tests in119files | `check-current-harness.log` |
| Current production build | Exit0 at19October14:39:49 | `build-release-final-exit.json`, associated release-final build log |
| Database contracts/workflows |456tests/37files passed | `database-current-final.log`, `database-current-final-exit.json` |
| Requirements matrix |287rows passed | `matrix-current-final.log`, `matrix-current-final-exit.json` |
| Disposable restore / upgrade | Both passed; upgrade0030→0062 | `restore.log`, `upgrade.log` |
| Retained browser acceptance | **90passed,0failed,0skipped**, six completed phases; final invocation exit0 at23:48:54 | `phases-final-four-report-2026-10-18/summary.json`, per-phase referenced reports, `browser-final-four.log`, `browser-final-four-exit.json` |
| Fresh canonical full command | **14:43 attempt failed during warmup after a recorded lid/button sleep; zero browser cases ran. Awaiting an uninterrupted environment.** | `browser-warmup-sleep-2026-10-19.log`, `browser-warmup-sleep-2026-10-19-process.json`, `browser-warmup-sleep-2026-10-19-exit.json`, `browser-warmup-sleep-power-events.json` |
| Actual worker failure/restart | Passed; real failed delivery and retry, Operations backlog and exactly-once visible inbox recovery | `worker-restart-proof/proof.json`, screenshots, `final-closure-exit.json` |
| Normal-data service restart | Passed: verified PostgreSQL54322 restarted; task-owned web runtime3200 started twice; data/secret retained | `normal-runtime-restart-proof/proof.json`, `normal-current-restart-exit.json` |
| Populated isolated restart | Passed with existing records/bookings and isolated PostgreSQL restart | `restart-populated-final.log`, `restart-check.ts` |
| Visual/interaction review | Reviewed representative desktop/phone and actual200%Chromium zoom captures; page/width, keyboard and axe evidence retained | `broad-all-pages-results/`, `closure-focused-results/`, final browser reports; zoom measured640CSS pixels/DPR2 |

The90-case result combines verified successful retained phases; it does **not** rewrite earlier unsuccessful commands as passes. Earlier summaries/logs remain preserved, including the83/4full87run and failed final-four/context/recheck attempts. The successful aggregate is specifically **`phases-final-four-report-2026-10-18`**, not the similarly named earlier failed directory.

Worker evidence records scopedP0001failure, queuedattempt1, real persisted retry deadline, displayed Operations queuedcount1, no parent result before restart, a distinct worker PID completing attempt2, and one visible message after reload/another pass. Original secret remained unchanged and cleanup reported no errors. The initial probe failed because its context lacked baseURL; that failure is archived under `final-closure-context-error` and the initial proof. The corrected existing-context wrapper then passed. Browser external requests were blocked; the ordinary worker still runs its standard global maintenance on the isolated stack.

Normal restart proof verified exact project/workdir/container and54322binding, refused other active client transactions, and checked changed postmaster start time. Full child/appointment/guardian/profile counts and digests plus existing secret were retained: **2children,0appointments,2guardians,8profiles**. No normal bookings were invented; populated booking persistence is covered separately on the isolated stack. The probe restarted normal PostgreSQL and its own3200application instance; it never stopped/restarted the user's original3000process or other Supabase services.

## Verification method and defect closure

Source regressions cover native-GET/hydration risks, minute-boundary clinical timestamps, occupied-port guards and harness lifecycle. Clinical version, authorization and future-time validation remain enforced. Test28 waits for the identity-confirmation refresh before submitting corrections. Test34 waits for actual selected context/URL before browser Back. Test35 selects its fixture clinic before MFA return. These are caller synchronization changes, not changes to MFA or access policy.

Test35 uses a discriminating timezone oracle: Manila-day count3 differs from UTC-day count2. Daily report, downloaded CSV and paper reconciliation verify matching counts, deliberate discrepancy, correction and reload. Test36 verifies actual profile/password persistence, cleared password fields, fresh new-password sign-in and rejection of the old password for its own synthetic account.

Development diagnostics found compilation/chunk stalls and memory pressure. The current isolated Webpack runner releases its process after **at most six files** while preserving one isolated database/state/secrets across phases; this is memory management, **not a hard memory cap**. Current E2E-only compiled-entry retention is **one hour**, with four focused red/green configuration tests and unchanged normal/production defaults. The earlier15minute setting allowed an entry to expire during a16minute57second warmup; that failed experiment is preserved. Anonymous warmup uses empty-invalid auth submissions and automatic OPTIONS/denied reads rather than successful commands. Application request deadlines and clinical/authentication logic were not weakened to obtain a pass.

Earlier runtime `SyntaxError`/`ChunkLoadError` and failed requests remain diagnostic evidence. The90-case retained closure passed; the fresh canonical command is the remaining clean-run gate. Keyboard scans retain every axe rule, normalize/restore document scroll without moving focus, and distinguish that canonical viewport from a cropped target. Privacy-task scans wait for enabled controls at opacity1 rather than sampling the disabled-to-enabled transition. These limits are explicit rather than universal accessibility claims.

## A01–A20 trace

Coverage below includes the successful retained cases; every row remains subject to the pending canonical-command caveat.

| ID | Evidence |
| --- | --- |
| A01 protected pages |55-file baseline/hash comparison; browser01/11/15/20/24; missing pristine-baseline exception above |
| A02 own-child scope | DB authorization; browser04/07/29 |
| A03 registration/link/privacy | Privacy/form units; browser04/12/22/31 |
| A04 appointments/capacity/retry | DB appointments; browser04/12/27 |
| A05 empty versus failed reads | Parent/Today/developer units; unavailable-page recovery |
| A06 staff creation/independent approval | Staff-account DB/API; browser30 |
| A07 foreign/expiry/revocation/MFA | DB authorization/technical-console; browser02/03/29/30 |
| A08 multiple roles/clinics/shared context | Portal units; browser29/34 including reload/Back |
| A09 arrivals/visit completion | DB visits; browser04/06/12 |
| A10 vaccination/atomic stock | DB administration/inventory; browser04/08/12 |
| A11 reported records/corrections | DB record/card; browser07/16/28 |
| A12 transfers/guardian access | DB transfer/access; browser07/12 |
| A13 follow-up | DB follow-up; browser12/32 |
| A14 worker/messages/paging | DB outbox/messages; browser12/27; actual worker-process proof above |
| A15 actual PDF/authenticity | DB certificates; browser04/09 |
| A16 profile/contact/password | Browser11/27/31/36; actual fresh sign-in |
| A17 technical operations/audit | Technical-console DB; browser30; sanitized projection |
| A18 reports/paper/time boundaries | DB reports; browser09/24/35; distinguishing timezone oracle |
| A19 responsive/keyboard/error/zoom/motion | Browser05/10/13/14/24/28/30/31/32/33 and reviewed captures |
| A20 restart/restore/upgrade | Normal actual PostgreSQL/own-runtime proof, populated isolated restart, disposable drills |

## Remaining gates and operating limits

- A successful uninterrupted canonical `npm run test:e2e` remains unverified. Multiple attempts encountered actual database shutdown or recorded Windows sleep/shutdown events. Further full verification requires the laptop to remain awake with Docker running; the user has been asked to confirm that condition. Retained successful phases and interrupted/failed invocations are distinguished above.
- Final source/hash/UTF8 checks and normal-app read-only readiness were reconciled above. The normal application remains available at `http://localhost:3000`; its existing process and data were preserved.

The [local portal operation guide](../operations/three-portals.md) documents bootstrap, independent staff approval, worker operation, care, outage-paper paths and recovery. Nonclinical grants need another access administrator; clinical grants require their independent clinical approver. Existing last-approver controls and owner-only CLI recovery remain intact.

Core journeys need the prepared local Next/Supabase/worker stack; initial dependencies/images need a connection. Local does not mean browser-offline synchronization. SMS/cloud delivery is excluded and not advertised as enabled. Clinical content requires clinic approval; synthetic schedules are not medical guidance. Chromium/axe coverage does not establish physical-device, assistive-technology, regulatory or universal clinical acceptance, or zero defects.

Final19October15:00 checkpoint: source780/119, database456/37, matrix287 and build passed freshly before the last browser attempt. The phase-specific warmup change has focused red/green and independent review evidence (2e-selective-warmup-*); all148listed modules exist, no test/assertion/deadline or application authorization changed, and unknown selections use full warmup. Its current full browser run did not reach tests. Protected55files still have zero drift; strictUTF8 checked755files with zero invalid text. Normal app had stopped after interruption, so only after confirming3000free the ordinary 
pm run dev was started (task launcher24024), with no reset. Fresh15:00 readiness and all three entry requests returned200; these anonymous entry checks do not replace authenticated acceptance. Normal-app bootstrap uses its existing retained secrets/worker contract. Original data and earlier restart/restore proofs were preserved.
