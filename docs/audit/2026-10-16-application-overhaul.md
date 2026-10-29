# Application overhaul and essential workflow audit — 16 October 2026

Status: implementation and local verification complete, finalized 17 October 2026. Hosted integrations and physical-device/clinical acceptance remain partially verified. This report distinguishes this task's changes from the substantial existing working-tree work.

## Scope and baseline

The repository has 39 page routes; 30 directly consume the shared UI. The application uses Next.js 16.3, React 19, Tailwind 4, locally hosted fonts, Zod, Supabase Auth/PostgREST, PostgreSQL commands/RLS and Vitest/Playwright. Existing modules already cover registration/guardian verification, booking/queue, vaccination/correction/card review, certificates, stock/cold chain/transfers, follow-up, clinical setup, staff approvals, reports, messages and account/security.

Preserved the initial Git status and binary diff in `tmp/overhaul-2026-10-16/`. No normal database reset, destructive production operation, dependency addition or new clinical rule was performed. Baseline `npm run check` passed (666 unit tests, typecheck and lint).

The landing route `/`, `src/app/_landing/*`, root layout/global styles, shared landing dependencies and public assets were hashed before editing. Final comparison: all 43 protected files retain their baseline hashes. Fresh full-page Chromium captures at 390 and 1440 pixels matched the pre-edit captures byte-for-byte; final client-navigation captures also match at both widths, excluding only the transient Next development badge.

## Design and implementation

Applied Emil Design Engineering (restraint in repeated operational interactions, state feedback), Impeccable Operate guidance (scanability, task-first layout), UI Styling (reuse existing semantic controls and responsive composition), and UI/UX Pro Max (touch, accessible naming, hierarchy and contrast). The generic search returned a marketing/neumorphic direction, which was rejected as unsuitable for a clinical operating tool. The existing civic-blue brand, light theme and local Jakarta font remain.

`src/components/application.css` is explicitly excluded from any body containing `.landing-page`, including after client navigation. It unifies operational heading/section spacing, corners, active navigation, textarea behavior, readable tables and focus-row feedback. Existing controls, reduced-motion policy, keyboard menus, permissions and business operations remain. Family records use divided semantic list rows, clear identity/status and accessible next actions; inventory uses plain summary counts and a less nested lot list. This is a shared visual refresh across the application, with deeper changes to family records, inventory and recovery screens; it does not claim all existing workflows were rewritten.

Design detail: `docs/engineering/application-design.md`. Existing `DESIGN.md` and its protected landing specifications remain intact. The pre-existing Impeccable sidecar is stale; it was not regenerated as an unrelated side effect.

## Findings and dispositions

| Priority | Observed evidence and user impact | Implementation | Verification |
| --- | --- | --- | --- |
| P2 | Failed GET/HEAD requests in `callApi` said an attempted save was unconfirmed. Clinic discovery and read-only views gave misleading recovery instructions. | Separate read recovery wording from mutation uncertainty. Preserve safe mutation retry keys and original write behavior. | New tests failed before implementation; all read/write and retry tests pass. |
| P2 | Root, family and clinic error views lacked a primary heading, leaving screen-reader heading navigation without a page identity. | Use the existing shared PageTitle in these boundaries and not-found. Keep private exception text out of UI and preserve retry actions. | New semantic rendering tests failed first, then passed. |
| P2 | Clinic error recovery linked every role to `/clinic/:id`, a patient-search route that some administrators/inventory roles cannot access. | Link through `/clinic`, which already chooses each role's valid clinic destination. | Regression test failed first, then passed; source trace confirms chooser calls clinicLandingRoute. |
| P2 | Family records repeated heavy panels and verification prose; inventory nested lot panels inside another panel. | Readable family list with named next actions; flatter stock counts and lot list. | Family screenshot review approved; actual family registration/record flows pass. Final inventory evidence below. |
| P2, caught during review | The initial general table rules shrank printed outage rows from the existing 12px vertical cell padding to 4px and changed paper headers. | Exclude all three paper tables with `data-paper-form`; remove blanket print override. | Real Chromium style probe reproduced 4px before the correction and 12px after; actual-route screen/print assertions added. Independent reviewer confirmed code fix. |
| Test infrastructure | First staff enrollment test selected the first clinic-name text, which was the hidden mobile-navigation copy. | Scope the assertion to the visible Workspace sidebar. | Failed original selector preserved in initial traces; restarted test passes. |
| Test infrastructure | Staff-application acceptance returned an HTML 404 despite an existing route; the isolated generated route manifest omitted it. | Clear only `.next-e2e` after checking the test port is free. Preserve normal development cache and authorization. | Clean-cache API returned JSON validation, then actual staff onboarding passed. |
| P2, caught during review | Inheriting `overflow-wrap:anywhere` made narrow Reports headers break into letters. | Restore normal word wrapping within tables and retain their existing keyboard-accessible horizontal scroll regions. | Chromium probe reproduced 207px header height before, 73px after; actual-route geometry checks added. |
| Test reliability | Three existing tests raced asynchronous clinic privacy acceptance or assumed casing different from existing person-name formatting. A new screenshot assertion attempted an enormous byte-array diff; later pixel diagnosis isolated intermittent differences to Next's transient development Rendering badge (x1–153, y936–1019 at 390px). | Wait for selected-clinic privacy results; use case-insensitive unique record matching and formatted fixture names; settle images, hide only `nextjs-portal` in screenshot capture and compare buffers with a bounded boolean. | Original failures retained in main-run traces; targeted final-source results below. No landing source or application pixels were masked. |

No optional modules, invented statistics or speculative clinical functionality were added. P0/P1 conclusions are limited to the actual audited code and executed checks; passing compilation alone is not functional completeness.

## Workflow verification coverage

- Real signup without confirmation email; sign-out/wrong-password/password-reset; staff MFA and independent access approval.
- Family child registration/linking, privacy acknowledgment, protected records, visits and QR; clinic intake/search and guardian verification.
- Session/queue changes, vaccination recording/corrections and clinic-authored care fields.
- Card scan/manual intake, reviewed evidence, withdrawal/resubmission; staff notes and account creation.
- Stock receipt/wastage/count approval, quarantine and cold-chain review; certificates/download/verification/revocation.
- Care publication, questions/plans, follow-up contacts, reports/CSV, audit, settings and outage forms.
- Existing automated axe and 320/768/1440 responsive suites, plus secondary modules at 390/768/1440, paper media checks and landing stylesheet isolation.

These workflows were executed in the isolated suite. Final results below distinguish the main command from corrected targeted reruns.

## Verification results

| Check | Current evidence |
| --- | --- |
| Baseline typecheck/lint/unit | Passed: 666 tests in 99 files |
| Final `npm run check` | Passed: typecheck, lint, 674 unit tests in 100 files (17 October continuation) |
| Disposable PostgreSQL suite | Passed: 449 tests in 36 files |
| Capability matrix | Passed: 287 rows |
| Production dependency audit | Passed: zero reported vulnerabilities |
| Initial Impeccable detector | No findings in selected changed UI targets |
| Incremental whitespace check | Passed on changed source/tests; whole-tree check reports an inherited blank line at the end of protected `src/app/globals.css`, preserved |
| `npm run build` | Passed: Next 16.3.8 optimized compilation, TypeScript and 21 static pages. Used `.local/overhaul-build`; exact original tsconfig/next-env bytes restored afterward. This proves buildability, not clinical completeness. |
| Main isolated browser suite | Completed: 69 passed, 4 failed out of 73. Three fixture/timing failures and one screenshot worker failure were corrected; targeted outcomes below. The main command itself did not pass. |
| Targeted workflows | Passed: guardian-link refusal/privacy acknowledgment, keyboard/merge cancellation and saved child address (`targeted-browser.log`: those three plus secondary screens passed, landing initially failed). Final `24-application-quality.spec.ts` rerun: 3/3 passed, including all authorized secondary screens, screen/print table geometry, axe, overflow, runtime-error checks, landing client-navigation equality and unavailable-page recovery (`quality-final.log`). All 73 distinct scenarios now have passing evidence across main and targeted runs; this is not a claim of a clean single full-suite invocation. |
| Public/auth accessibility | Passed: 14 fresh Chromium cases at 390/1440px, no axe violations or document overflow (`public-accessibility.json`). Automated axe is not human screen-reader verification. |
| Landing preservation | Passed: 43 unchanged protected-file hashes; pre/post-edit full-page captures match at 390/1440px; final client-navigation equality passes at both widths. |
| Current screenshot review | Independent reviewer approved family/auth and 24 final full-page staff captures, with Reports wrapping resolved. Admin-audit captures showed access recovery and were excluded; subsequent actual lead-audit phone/desktop captures passed review, closing that coverage gap. Final verdict: ship the reviewed surfaces, no material visual findings outstanding. |

Raw logs and hash manifest: `tmp/overhaul-2026-10-16/`. Browser traces/screenshots: Playwright test-results and report output. Test accounts and clinical fixtures are synthetic and isolated from normal development data.

## Limits and readiness

Hosted Supabase deployment, real SMS transport, real cameras/handwriting, physical device ergonomics, human screen-reader testing, clinical policy/sign-off, backup recovery on the real hosted system and actual printer pagination are not established by local automation. Existing configuration and operational limitations remain in `docs/implementation/known-limitations.md`.

**Verified:** shared non-landing visual implementation, named local workflows, all 73 distinct browser scenarios across main/targeted runs, 674 unit tests, 449 disposable PostgreSQL tests, capability matrix, production build and protected landing preservation. The main 73-case browser invocation remains recorded as failed; targeted reruns provide the corrected evidence rather than replacing its history.

**Partially verified:** production deployment and real-world operation. The reviewed build is ready for local acceptance/use with synthetic workflows and for staging acceptance. Hosted integration validation, physical devices/printers, human accessibility and clinical sign-off are required before a stronger production-readiness claim. No demonstrated unresolved P0/P1 defect was found within the traced and executed scope; this is not a guarantee for untested cases.

**Blocked/failed at handoff:** no remaining blocker or failing check in the final targeted local checks. Historical failed/interrupted runs and the inherited whole-tree whitespace finding remain documented. No deployment or commit was performed; unrelated initial changes remain intact.

## Independent essential-feature audit

A separate read-only reviewer traced the following existing end-to-end paths and found no demonstrated P0/P1 missing core action in those paths. This is source/test review, not a claim that the reviewer reran the suites.

| Area | Evidence | Result |
| --- | --- | --- |
| Immediate access | `supabase/config.toml:239`, `scripts/local-stack.ts:48`, `src/app/auth/sign-up/route.ts:73` | Automatic confirmation and immediate-session checks; no signup confirmation email. |
| Clinic entry/navigation | `src/lib/auth/clinic-navigation.ts`, `src/lib/auth/destination.ts`, `src/lib/server/viewer.ts:76`, `src/lib/auth/clinic-access.ts:31` | Capability-based routes, merged active roles, expiry and staff MFA checks. |
| API trust boundary | `src/lib/api/handler.ts:53`, `src/lib/db/supabase.ts:22`, foundation/integrity migrations | Same-origin mutations, bounded/validated input, UUID retry keys, revalidated Auth and database capability checks. |
| Registration/guardian verification | Child and guardian-link API routes; privacy migration 0022 | Privacy acceptance and provisional identity-only access remain authoritative DB checks. |
| Booking/arrival/recording | Appointment and encounter administration API routes; migration 0060 | Existing commands connect bookings, queues, doses, stock and care fields transactionally. |
| Staff approvals | Staff-account API, clinic access page, staff-application/foundation DB tests | Existing account creation and independent approval paths; self-approval remains blocked. |
| Certificates/transfers | Certificate download/public verify API routes; certificate/record-transfer tests | Authorized downloads, limited public verification and governed release/acceptance remain. |

## Principal files changed in this task

| Files | Purpose |
| --- | --- |
| `src/components/application.css` (new), `src/components/ui.tsx` | Isolated operational styling through existing UI APIs. |
| `src/app/children/page.tsx` | Semantic family record list, clearer actions and less repeated verification prose. |
| `src/app/clinic/[clinicId]/inventory/page.tsx` | Flatter stock summaries and lot list. |
| `src/app/clinic/[clinicId]/outage-forms/page.tsx` | Explicit paper-table opt-out from general table styling. |
| `src/app/error.tsx`, `src/app/not-found.tsx`, `src/app/children/error.tsx`, `src/app/clinic/[clinicId]/error.tsx` | Primary headings and role-aware error recovery. |
| `src/lib/client/api.ts` | Accurate read-error wording while retaining mutation safety. |
| `scripts/e2e.ts` | Clear only the test runner's generated `.next-e2e` cache after checking its port is free. |
| `tests/unit/client-api.test.ts`, `tests/unit/application-errors.test.tsx` (new) | Read/write outcomes, primary headings, private-error suppression and clinic recovery regressions. |
| `tests/e2e/02-first-staff.spec.ts`, `04-first-visit.spec.ts`, `12-full-flow.spec.ts` | Replace hidden/ambiguous/style-dependent selectors with visible landmarks, exact labels and semantic record list selectors. |
| `tests/e2e/07-records.spec.ts`, `13-interaction-accessibility.spec.ts`, `22-child-registration-address.spec.ts` | Await selected-clinic privacy acceptance and match existing name formatting in guardian-link, keyboard and saved-address workflows. |
| `tests/e2e/24-application-quality.spec.ts` (new) | Secondary-module axe/overflow checks at three widths, print geometry, unavailable-page recovery and landing client-navigation isolation. |
| `docs/superpowers/plans/2026-10-16-application-overhaul.md`, `docs/engineering/application-design.md`, this report | Scope, durable design decisions, findings and verification record. |

No files were removed. Existing unrelated changes remain. Protected landing source, global CSS/root layout, assets and shared landing dependencies were not edited by this task.

## Continuation: filter and history recovery — 17 October 2026

The user requested further improvements after the first completed pass. This bounded increment keeps the existing visual direction and data rules.

| Finding | Change | Evidence |
| --- | --- | --- |
| Audit silently ignored malformed/repeated dates, potentially widening the requested search; reversed ranges looked like an empty result. | Validate date/action filters before the RPC, show accessible field errors and a recovery notice; retain clinic-day timezone boundaries and authorization. | Failing tests first, then passing invalid/calendar/repeated/reversed/length cases. Browser corrects a bad date and obtains real results at 390/1440px; invalid state has no results region. |
| Filtered audit searches lacked a reset; older pages lacked a direct return to newest matching entries, including when history was exhausted. | Shared controls, Clear filters, and 44px Newest/Older links preserving action/date constraints; accurate empty older-page wording. | Unit cursor/filter assertions; actual older-page navigation, filter-preserving recovery and reset pass at both widths. |
| An empty older Messages page claimed the inbox had no messages yet. | Distinguish “No older messages” and explain how to return to recent messages. | Empty-first/empty-older unit regression; actual family inbox navigation passes at both widths. |

Principal additional files: `src/app/clinic/[clinicId]/audit/page.tsx`, `src/app/messages/page.tsx`, new `tests/unit/audit-page.test.tsx`, expanded `tests/unit/worklist-pages.test.ts`, and new `tests/e2e/25-filter-recovery.spec.ts`. No schema, API contract, dependency, authentication or protected landing changes.

Verification: production build passed (`followup-build.log`). Final `npm run check` passed: typecheck, lint and **684 unit tests in 101 files** (`followup-check.log`). The new browser scenario passed, covering both widths, actual correction/reset/paging, axe checks on the audit error state and no document overflow (`filter-recovery-browser.log`). Independent source review found no introduced defect; independent review of all four screenshots approved the increment with no actionable layout findings. Captures are retained in `.impeccable/review/filter-recovery/`.

Landing recheck: all 43 protected files still match the original hashes. No SQL was changed; the earlier 449-test database result remains relevant and was not rerun for this display/read-validation increment. The original full browser command's historical 69/73 result remains unchanged; this increment adds one passing browser scenario rather than claiming a new clean full-suite run. External/human/physical-device limitations above remain.

Subsequent user-directed sidebar work is documented in `docs/engineering/family-destinations.md`. Its shared root-layout changes were explicitly requested after this audit's original hash checks; the historical 43-file statements above apply to their recorded verification point. Landing modules/global styles/assets remain unchanged, and the subsequent landing navigation equality check passes.
