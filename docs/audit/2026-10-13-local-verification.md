# CVSRS local-use and presentation audit — 2026-10-13

## A. Executive summary

CVSRS, branded eVacTrack, manages children's vaccination records and clinic-supplied schedules. Families register/link children, book visits, view verified history and certificates, and receive messages. Staff manage registration, guardian verification, queues, vaccination recording, evidence/corrections, catch-up plans, inventory/cold-chain/transfers, approvals, reports and follow-up.

Target: one personal Windows laptop and a synthetic classroom demonstration. No public deployment, new major feature, account-confirmation email, dependency upgrade, main-database reset, commit or push was performed.

The current tree compiles and passes automated unit/database checks after targeted repairs. **The actual application is not yet verified ready for presentation:** Docker Desktop crashes during initialization, preventing the required Supabase Auth/PostgREST stack and the real browser rehearsal from running. An isolated Next server can render its failure shell; that is not functional application startup.

Earlier reports record successful local journeys, but those are historical results and receive no credit as today's end-to-end verification.

## Discovery and architecture

- Observed runtime: Node 24.16.0, npm 11.6.3; project requires Node >=22.
- Installed stack: Next 16.3.7, React 19, strict TypeScript, Tailwind 4, Zod 4, Supabase Auth/SSR/PostgREST, PostgreSQL, pdf-lib/fontkit, Vitest and Playwright Chromium. Versions verified from the manifest and executed tools.
- Inventory: 39 page files, 145 route-handler files and 47 SQL migrations (0000–0046). Pages/handlers include family, public, staff, administrative and auth routes; these counts are not proof of functional completeness.
- Data flow: page/client action → shared API validation/session checks → allowlisted authenticated RPC → SQL capability/MFA checks, transactions, RLS, audit and command receipts → database result → client feedback. Durable outbox processing produces in-app messages. Certificates freeze verified records and store HMAC-attested PDFs privately.
- Local development: Docker Supabase at API 54321/database 54322; `npm run dev` supplies public Auth settings and provisions local signing/worker secrets without resetting records; app port 3000. The separate plain PostgreSQL test harness uses 54329 and lacks Auth/PostgREST.
- Synthetic demo: `.local/e2e`, API 55321/database 55322, app 3100. Demo/E2E share this disposable environment. Full E2E or demo preparation resets it; normal demo startup preserves it.
- No real SMS adapter is configured. In-app messages are implemented; optional external SMS and hosted deployment are outside this laptop acceptance scope.

Three independent reviewers examined backend/security/data integrity, frontend workflows and local tooling. Their audits were initially read-only; subsequent edits had distinct file ownership. The extensive pre-existing dirty tree was preserved. No exhaustive line-by-line or control-by-control audit is claimed.

Plan executed: establish baseline → reproduce data/workflow defects → forward SQL migrations and small shared UI/startup corrections → focused red/green tests → full regression → upgrade/restore and runtime probes → re-audit and document remaining blockers.

## B. Evidence-based readiness

**CVSRS Local-Use and Presentation Readiness: 63.5%**

This is conservative completion of the explicit verification checklist below, not a probability of correctness or a claim of bug-free software. Each criterion receives 1 only when current evidence satisfies it; blocked, untested and incomplete criteria receive 0. No partial-credit estimates are used. Broad end-to-end criteria remain open even when their SQL contracts pass. The original local-use acceptance target is retained.

| Category | Weight | Verified / eligible | Score | Weighted points |
|---|---:|---:|---:|---:|
| Feature functionality and workflows | 25% | 5 / 10 | 50% | 12.5 |
| Backend, APIs, database and integrity | 20% | 4 / 5 | 80% | 16 |
| Architecture and code quality | 15% | 4 / 5 | 80% | 12 |
| UI/UX, responsiveness and interactions | 15% | 2 / 5 | 40% | 6 |
| Security, validation and reliability | 10% | 4 / 5 | 80% | 8 |
| Testing, builds and regression | 10% | 4 / 5 | 80% | 8 |
| Local setup and presentation | 5% | 1 / 5 | 20% | 1 |
| **Total** | **100%** | | | **63.5** |

Criterion ledger (PASS = current evidence; OPEN = no credit):

- **Features, 10:** PASS SQL registration/guardian/privacy; PASS SQL visits/queue; PASS SQL clinical history/evidence/catch-up; PASS SQL inventory/cold-chain/transfers; PASS SQL certificates/messages/administrative reports. OPEN actual browser signup/login/recovery/MFA; OPEN family→assistant booking/arrival; OPEN nurse dose→stock→family history; OPEN PDF/public validity/messages journey; OPEN role approval/reports/follow-up browser journeys.
- **Backend, 5:** PASS fresh migrations; PASS database RLS/role boundaries; PASS transaction/ledger/concurrent-count integrity; PASS populated upgrade and restore integrity; OPEN live Supabase Auth/PostgREST/database integration on the target setup.
- **Architecture, 5:** PASS real entry-point/module/data-flow inventory; PASS shared API/RPC/client contracts reviewed and tested; PASS types/lint; PASS focused changes with preserved dependencies and documented cleanup boundaries; OPEN exhaustive module/caller coverage review.
- **UI, 5:** PASS tested search labels/feedback and download failure recovery; PASS failure-shell rendering/accessibility/overflow at phone/laptop widths; OPEN normal signed-in page usability/consistency; OPEN normal-page responsive presentation; OPEN complete keyboard/zoom/assistive-technology walkthrough. The existing layout deliberately forces light mode; restoring dark mode is not a requirement. Dark CSS token tests do not establish a working dark UI.
- **Security, 5:** PASS origin/identifier/body-validation unit contracts; PASS SQL capability/MFA/clinic/guardian boundaries; PASS receipts/retry and stock integrity contracts; PASS local Next loopback socket plus launch-command configuration; OPEN real Auth/signup/session enforcement on today's service. Confirmation email remains disabled in local config; live policy must be rechecked when Docker works.
- **Testing, 5:** PASS type/lint; PASS complete unit suite; PASS complete database suite; PASS build/install-artifact/matrix/upgrade/restore checks; OPEN complete browser regression/rehearsal.
- **Local setup, 5:** PASS documented prerequisites/commands with installed Node/npm/dependencies; OPEN Docker/Supabase startup; OPEN operational application/database connectivity; OPEN applying the new migrations to the intended local Supabase data; OPEN fresh demo preparation/rehearsal/restart persistence.

Hosted Redis/TLS/SMTP, public hosting, sensor integration, offline writes and future modules are not applicable to this defined local demonstration and were not added to the denominator. Current clinical workflows still require clinic-approved rules for real patient use; synthetic fixtures are only for classroom/testing.

## C–E. Issue register, implementation and cleanup

| ID | Priority | Verified problem/root cause | Correction and evidence | State |
|---|---|---|---|---|
| LOCAL-01 | P1 | Docker Linux engine absent; Desktop crashes initializing its inference socket | Startup attempted; log names inaccessible `AppData/Local/Docker/run/dockerInference`. PowerShell removal failed; Node lstat returned EACCES. No factory reset, settings edit, volume deletion or WSL reset attempted | **Blocked** |
| DATA-01 | P1 | Physical counts derive delta before locking book balance; concurrent counts of 12 from 10 produced 14; first counts/approvals produced 24 | `0045_stock_count_serialization.sql` materializes zero balance if necessary and locks it before deriving delta; regression observes actual lock contention, verifies projection and ledger equal 12 | Fixed; disposable DB verified |
| DATA-02 | P2 | A zero count for an unknown lot bypassed lot validation and returned success | 0045 validates organization-scoped lot before materializing balance; regression expects CV404 | Fixed |
| SEARCH-01 | P2 | Inactive record excluded from search although reactivation exists, encouraging duplicate registration | `0046_search_inactive_records.sql` includes inactive records; test searches name and record number, checks other-clinic denial, then reactivates. `workspace.tsx` reuses correct status chip | Fixed |
| SEARCH-02 | P2 | SQL limited arbitrary matches before ranking; exact name inserted after 26 similar records was omitted at limit 1 | 0046 orders candidates by existing score/name/id before LIMIT; late-exact-name regression failed before correction and passes after | Fixed |
| UI-01 | P2 | PDF/CSV fetch could wait indefinitely, leaving disabled controls | Shared `download-button.tsx` uses 15-second AbortSignal deadline; stalled-body regression checks abort, inline failure and retry enablement | Fixed; unit verified |
| LOCAL-02 | P2 | Next launch defaults listen on all interfaces, contrary to laptop-only target | `scripts/dev.ts`, `scripts/e2e.ts`, package `dev:next` and `start` bind localhost; actual dev:next socket observed at ::1:3000. Demo already bound localhost | Fixed |
| UI-02 | P3 | Search silently returns only first 20 results | UI asks staff to refine by DOB/record number when cap is reached; markup regression | Fixed; pagination deferred |
| DOC-01 | P3 | Rehearsal guide claimed step 5 could run alone, but its state is built by earlier steps | Removed invalid isolated-step example; require full rehearsal. Status now distinguishes current real-Auth demo from deleted persona sandbox | Fixed |
| VERIFY-01 | P3 | matrix:check validates generator rows, not equality of generated Markdown | Current artifact was independently compared and matches all 287 rows; command establishes traceability consistency only | Latent checker improvement deferred |

Migration 0045 replaces only the two existing count command bodies, preserving signatures, authenticated-only grants, command receipts, audit and two-person rules. Zero projection rows may now exist before the first movement; they represent no stock and provide the lock needed for first counts. Closed locations are refused.

Full regression caught an implementation mistake: the initial approval replacement omitted migration 0034's existing count-only evidence guard, returning CV404 instead of the required CV409 for transfer-shortfall cases. The latest guard was restored without weakening the test. Focused 49-test and final full-suite verification include this correction. This intermediate failure is retained in the evidence log.

Migration 0046 preserves clinic capability and enrollment scope, audit, API signature, limits and grants. Discovering an inactive child does not permit ordinary booking or vaccination; existing active-record gates remain.

Generated `supabase/install/fresh-install.sql` and `verify.sql` now reflect all 47 migrations. Existing migration history was not rewritten. README, implementation status, known limitations and professor-demo instructions were updated.

Cleanup manifest: **no files/folders/dependencies deleted; no broad refactor or new abstraction**. `tmp/activity2`, `output/activity2`, `.audit-generate-0026.py`, historical reports, assets, migrations, lockfile, local credential files and uncertain artifacts were preserved. Disconnected application imports alone do not establish permission to delete user outputs.

## F. Actual testing record

Logs are in ignored `.local/audit-2026-10-13-*`; they are not credentials or a replacement for the tests themselves.

| Executed command/check | Actual result |
|---|---|
| Baseline npm run check, retry with required host access | Types/lint pass; 581 unit tests / 78 files pass |
| Baseline npm run test:db, retry with local socket access | 418 tests / 28 files pass |
| npm run build (baseline and after UI/startup edits) | Both builds exit 0; Next compilation, types and route generation pass |
| Stock concurrency red | Four intended failures: 14 vs 12, 24 vs 12 twice, unknown-lot zero count accepted |
| Focused stock final | 49 tests / 4 files pass, including preserved transfer-shortfall guard |
| Search/UI/download red | Inactive DB search empty; inactive chip/cap notice/deadline unit cases fail before fixes |
| Ranked search red | Late exact match omitted at limit 1 |
| Focused search final | Inactive search + registry: 42 tests pass |
| Focused UI final | Search/download + clinic-search + staff-ui-actions: 20 tests pass |
| First integrated DB pass attempt | 1 failure / 422 pass: omitted count-only guard; repaired before final run |
| Final npm run check | Types/lint pass; **584 unit tests / 79 files pass** |
| Final npm run test:db | **424 tests / 30 files pass** |
| npm run matrix:check | 287 rows accepted; structural traceability only |
| npm run db:install-sql -- --check | Generated SQL current, 47 migrations |
| npm run drill:upgrade | Populated 0030→0046 passes; checks retained records, writes, RLS, pinned search paths and 168-RPC allowlist; disposable upgrade DB dropped |
| npm run drill:restore | Pass: 69 tables / 11,733 rows; 22 certificates; 2,389 audit rows; no integrity problems in restored disposable copy |
| npm run perf | 20,000 synthetic children, 37 MB database: name-search p95 249.5 ms; eight concurrent searches p95 347.5 ms; record/history p95 1.2 ms. Measurements include real SQL role switches on this machine, not browser/network latency or a performance SLA |
| npm run test:e2e | Exit 1 before browser journeys: Docker not running; no journey credited |
| npm run dev:next, socket and HTTP probes | Next starts; ::1:3000 only; liveness 200, readiness **503**, sign-in route 200 with configuration failure shell |
| Ad hoc Chromium shell scan | Six requested paths at 375/1280px: 12 light-theme combinations, no automated A/AA violations or overflow in the **unavailable-service shell only**; screenshots inspected |
| Initial ad hoc theme scan | Failed dark assertion: current layout intentionally forces light. Repeated dark requests rendered light; no dark UI pass claimed |
| git diff --check | Pre-existing extra EOF blank line in `src/app/children/[childId]/page.tsx`; this task did not edit that file. Whole working tree is not claimed clean |

Initial sandbox unit execution also failed with missing Vitest temporary compiled files; rerunning with host access passed. Initial DB execution failed EACCES on 127.0.0.1:54329. These were execution-environment failures, not silently dismissed application test failures.

Browser shell findings do not verify sign-in forms, clinical pages, theme switching or patient workflows. Manual screen-reader/zoom/camera work was not performed. No public deployment or real SMS/hosted-service test was run.

## G. Remaining risks and exact blocker

Docker's recorded initialization error is `starting services: initializing Inference manager ... dockerInference: The file cannot be accessed by the system`. WSL lists docker-desktop stopped. The artifact is a zero-byte reparse point dated 2026-10-11. Only the Desktop/backend processes started by this audit were stopped during recovery. The runtime socket could not be safely removed with available access and remains unchanged. No approval-review rejection occurred; the operation itself failed on Windows file access.

The laptop operator must repair Docker Desktop startup with appropriate Windows access, preserving existing containers/volumes. Do not use factory reset or an unqualified database reset as a shortcut. A Windows restart and normal Docker launch can be tried; if the same error persists, address that exact Desktop runtime-file problem with an administrator/support. Then require `docker info` to succeed before rerunning the application checks.

`.env.local` contains only the retired `CVSRS_LOCAL_DB_URL` setting (value not exposed). `dev:next` is intended for a configured hosted development project; it cannot supply missing local Supabase settings. For this laptop use `npm run dev` after Docker is repaired, which supplies the correct current settings. No real credentials were copied into documentation or changed.

New migrations are verified on disposable PostgreSQL and through populated upgrade, **not applied to the main Docker Supabase database**, which was inaccessible. Auth, all current UI/API/data journeys, demonstration preparation and restart persistence remain unverified. These blockers outweigh passing static checks and prevent a ready-for-presentation conclusion.

## H. Local laptop setup guide

1. Install Node >=22/npm and Docker Desktop with its WSL2 Linux engine. Dependencies are already installed here; from a fresh checkout run `npm install`, then `npx playwright install chromium` for browser testing.
2. Start Docker Desktop and confirm `docker info` succeeds. Resolve the recorded startup error first.
3. From the repository run `npm run dev`. It starts/uses local Supabase, applies only missing migrations (including 0045/0046), provisions ignored local secrets and starts the app/worker. No local environment variables are required for this command.
4. Open `http://localhost:3000`; staff entry is `/evactrackstafflogin`. Check `/api/v1/health/ready` returns 200 before presenting. Studio is `http://127.0.0.1:54323`; password-recovery inbox is `http://127.0.0.1:54324`.
5. Preserve existing local accounts/data. On a genuinely empty setup only, follow README's first-staff sequence: both people sign up with immediate access, then `npm run setup:first-staff -- --org "<organization>" --clinic "<clinic>" --timezone Asia/Manila --admin <email> --lead <email>`. Staff MFA and two-person access approval remain mandatory.
6. Configure clinic details, clinic-owned privacy notice, antigens/products, approved schedule, staff roles, stock and sessions through existing screens as described in README. Do not put synthetic rules into real patient setup.
7. For class use ensure port 3100 is free: stop only an identified earlier demo/E2E process; preserve unrelated processes and consult the port-conflict recovery guide. Run `npm run demo:prepare`, then `npm run demo`. Preparation replaces only synthetic E2E data. Accounts/credentials remain in ignored `.local/e2e/demo-accounts.json`; do not project or commit it.
8. In separate terminals use `npm run demo:code` for staff MFA and `npm run demo:rehearse` for the complete talk. Later rehearsal steps depend on earlier ones; rerun the whole sequence after failure.
9. Run `npm run check`, `npm run test:db`, `npm run build`, `npm run matrix:check`, `npm run db:install-sql -- --check`; use `npm run test:e2e` after Docker works. E2E resets the same disposable demo environment, so prepare demo again afterward.
10. Ctrl+C stops app startup. `npm run dev:stop` stops the main Supabase stack while keeping its data. Restart with `npm run dev`. For the demo, Ctrl+C then `npm run demo` preserves prepared data; stop its containers with `npx supabase stop --workdir .local/e2e` if needed, without `--no-backup`.

See [professor-demo.md](../operations/professor-demo.md) for the full synthetic presentation and recovery procedure. The current audit has not reverified that procedure while Docker is broken.

## I. Professor presentation checklist — pending live verification

- [ ] Docker engine healthy; app readiness 200; new migrations applied to intended local stack.
- [ ] Prepare isolated synthetic demo for the presentation day; protect private credentials and use separate role browser profiles.
- [ ] Rehearse immediate signup, sign-in/out, staff MFA, role denials and guardian verification; no signup confirmation mail.
- [ ] Demonstrate child registration → verification → booking → arrival/service → signed fictional dose → stock decrement → family history/message.
- [ ] Download real PDF and verify its public authenticity while signed out.
- [ ] Show reports/CSV/audit, staff approvals and health-worker follow-up; confirm persistence after reload/restart.
- [ ] Check normal family/staff screens on laptop/narrow widths, keyboard navigation, zoom and contrast; test camera if demonstrating it, otherwise use the supported typed-code fallback.
- [ ] Keep main local patient records untouched; explain synthetic schedule, optional SMS off and documented limitations honestly.

## J. Optional future improvements intentionally not implemented

Generated-matrix drift enforcement; search pagination if the existing refine filters become insufficient; manual assistive-technology/device acceptance; validated SMS transport; hosted deployment and monitoring only under a separate request. No new major module or public infrastructure was added.

## K. Conclusion

**Not yet ready for local presentation. Verified checklist completion: 63.5%.** The code and disposable-database gates pass after reproduced fixes, but Docker startup and current end-to-end evidence remain blocking. Resume with service recovery and the existing full browser/rehearsal procedures, rather than claiming 100% from test counts or a successful build.
