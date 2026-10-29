# eVacTrack Parents Portal, Clinics Portal and Developer Console Implementation Plan

Execution update: implementation is integrated on `codex/three-portals`; final browser and visual acceptance are in progress. Current results and baseline exceptions are recorded in the [implementation evidence report](../../audit/2026-10-17-three-portals-completion.md). The original checklist below describes the planned gates and must not be treated as proof that an unrecorded baseline check occurred.

> **For agentic workers:** Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task after the user requests implementation. Steps use checkbox syntax. Read the linked design brief first. Do not execute this plan merely because it exists.

**Goal:** Deliver three clearly separated, professional workspaces with complete, verified local vaccination workflows while protecting the landing page and sign-in/create-account experience.

**Architecture:** Reuse the current Next.js application, Supabase identity, capability-authorized RPCs and database. Separate portal composition and navigation; add a clinic-scoped Developer Console around existing technical operations. Extend shared contracts only for a demonstrated gap, preserving clinical approval and historical records.

**Tech stack:** Installed Next.js 16.3/React 19, TypeScript, Tailwind, existing UI components/Lucide, Supabase/PostgreSQL, Zod, Vitest, Playwright and axe. Node >=22; local Supabase requires Docker Desktop/WSL2 on Windows.

**Spec:** [Three-portal design and research brief](../specs/2026-10-17-three-portals-design.md).

## Global constraints

- No landing-page or sign-in/create-account page/handler/authentication changes. Preserve automatic confirmation, immediate signup access, staff MFA, recovery, cookies and existing sign-in destinations.
- Existing account password/security components and commands are reused unchanged. Staff provisioning is a separate existing administration command; no new auth implementation.
- Shared root-layout changes are limited to authenticated workspace composition and must demonstrate identical protected-page output/behavior. Keep global tokens, public navigation, footer, brand and public assets unchanged.
- Preserve the current working tree, including uncommitted work. Capture a baseline before editing; never use reset/checkout to discard it. No normal-local-database reset.
- Keep current URLs and record anchors functional. Preserve legacy admin destinations with authorization-aware compatibility behavior.
- Developer means active assigned-clinic `tech_admin`, not database owner or global superuser. Every mutation still checks capability, clinic, MFA and database rules.
- No verification/confirmation email, new dependency, duplicate datastore, cloud requirement or incomplete placeholder feature.
- Clinical schedule and care content stay clinic-approved. Synthetic local fixtures are labeled; do not manufacture clinical rules from research.
- Every essential exposed action must work locally, persist correctly, recover from failure and have evidence. Unavailable SMS and other integrations are not active product actions.

## Review focus

1. A user has two clinics or both clinical and technical roles: selected portal/clinic remains explicit; data and permissions never follow the first array item accidentally. Tests: Tasks 2, 3, 6.
2. Access expires or is revoked while a page is open: the next read/write is denied and no stale patient information is newly fetched. Tests: Tasks 3, 6, 9.
3. A request succeeds but its response is lost: retry produces one child, staff account, appointment or vaccination event, not duplicates. Tests: Tasks 4, 6, 9.
4. A data read fails or yields an invalid null: it appears as a recoverable error, not zero children, no appointments or unpublished guidance. Tests: Tasks 4, 5, 8.
5. Dates, long names, identical message timestamps and narrow/zoomed screens: ordering, paging, clinic time and action access remain correct. Tests: Tasks 5, 10.

## Delivery units and agent ownership

Use GPT-6.1 Sol for the requested agent roles. This is an execution assignment, not a claim that all agents completed planning. Initial planning delegation hit a usage limit; remaining source review and plan consolidation were done by the primary agent.

| Agent | Responsibility | Exclusive write scope during its task |
| --- | --- | --- |
| Lead/integration | Freeze baseline, define shared interfaces, integrate and verify | Root layout, shared portal helper, docs and final checks |
| UI/UX agent — GPT-6.1 Sol | Parents layouts, clinic navigation, responsive behavior | Assigned page/components/CSS files only |
| Flow agent — GPT-6.1 Sol | Registration, bookings, clinic-day continuity, retry/error states | Assigned workflow components and their tests |
| Access/console agent — GPT-6.1 Sol | Developer Console, technical audit and role boundaries | Developer routes, scoped server helper, approved SQL and tests |
| Reviewer — GPT-6.1 Sol | Independent review of diff, scenarios and evidence | Read-only; issues returned to owner |

Only three workers plus coordinator may be active at once. Shared files have one owner. After shared interfaces land, family UI and console work can proceed independently; clinic workflow verification waits for the affected navigation and console changes. The reviewer runs after each deliverable and once over the integrated result. If a model is unavailable, report it and complete the work directly; never count a failed agent as a review.

## Task 1 — Freeze the baseline and establish local evidence

**Files:** create `docs/audit/2026-10-17-three-portals-baseline.md`; evidence under `tmp/three-portals/`; inspect `package.json`, `scripts/dev.ts`, `scripts/e2e.ts`, `scripts/setup-first-staff.ts`, `docs/operations/runbook.md`.

**Produces:** protected-file manifest, source/test inventory and reproducible local test commands. No product interface changes.

- [ ] Record `git status --short` and hashes of current protected files: `src/app/page.tsx`, `src/app/_landing/**`, sign-in/sign-up/auth trees, staff entry/create-account trees, auth helpers, security/recovery modules, public components/assets and global CSS. Record current bytes, not HEAD.
- [ ] Read installed Next guides for layouts, route handlers, dynamic params and navigation from `node_modules/next/dist/docs/`; follow the current version.
- [ ] Establish the local stack and identify normal-dev versus isolated E2E ports/databases before any mutation. Use synthetic accounts only in the isolated stack.
- [ ] Run baseline `npm run check`, `npm run build` and relevant existing browser tests through `npm run test:e2e -- tests/e2e/27-family-destinations.spec.ts tests/e2e/16-card-intake-admin.spec.ts`. Retain logs; label existing failures separately. Coordinate builds with dev output directories as existing scripts support.
- [ ] Capture current six family pages plus clinical Today/admin at desktop/mobile, including the existing user's screenshot problem. Inventory every action and destination rather than judging only the initial viewport.

**Acceptance:** existing changes are protected, commands are reproducible, baseline failures are explicit. Do not claim the baseline is green without outputs.

## Task 2 — Establish portal navigation without changing authentication

**Files:** create `src/lib/portal-context.ts`, `src/components/portal-navigation.tsx`; modify authenticated composition in `src/app/layout.tsx`, `src/components/workspace-sidebar.tsx`, `src/components/mobile-nav.tsx`, `src/components/workspace-nav-link.tsx`; test `tests/unit/portal-context.test.ts`, `tests/e2e/29-portal-separation.spec.ts` (new filenames).

**Interfaces:** `PortalKind = "parents" | "clinic" | "developer"`; `PortalContext = { kind: PortalKind; clinicId: string | null }`; `resolvePortalContext(pathname: string, query: URLSearchParams, memberships: readonly MembershipLike[]): PortalContext`. Reuse `activeClinicAccess` and `clinicAccessFor`. The helper selects presentation only; server guards own access enforcement.

- [ ] Write failing unit cases for each route family, expired membership, unknown/foreign clinic, multiple roles, shared Account/Messages explicit context, and stable fallback without a parameter.
- [ ] Run `npx vitest run tests/unit/portal-context.test.ts`; confirm new cases fail for the intended missing behavior.
- [ ] Implement explicit route-to-shell mapping. `/children`, records, appointments and help always use Parents; `/clinic/*` uses Clinics; `/developer/*` uses Developer. Shared account/messages use validated context with a deterministic available-workspace default. Reject arbitrary external return URLs.
- [ ] Render portal switch links only to admitted destinations. Pass context on shared-page links. Do not persist an authorization decision in browser storage.
- [ ] Keep public/auth rendering unchanged; no login redirect/helper edits. Test direct URLs, client navigation, browser Back, reload and signed-out access.
- [ ] Run focused unit and E2E tests. Compare protected public/auth pages to baseline, including an already-signed-in visit to `/`.

**Acceptance:** a parent cannot see a developer/clinic tool; a multi-role user can select the correct workspace; shared pages identify their context; existing login destinations work unchanged.

## Task 3 — Add the Developer Console shell and guard

**Files:** create `src/lib/server/developer.ts`, `src/app/developer/layout.tsx`, `src/app/developer/page.tsx`, `src/app/developer/[clinicId]/layout.tsx`, `src/app/developer/[clinicId]/page.tsx`, loading/error boundaries; modify clinic `admin/page.tsx` compatibility branch; tests `tests/unit/developer-access.test.ts`, `tests/e2e/30-developer-console.spec.ts`.

**Interface:** `requireDeveloper(clinicId: string)` returns the existing `requireClinicStaff` result after additionally requiring an active, unexpired `tech_admin` membership at that clinic. Individual actions continue to require their own capabilities. Missing/foreign access denies without exposing clinic data.

- [ ] Write tests: parent, clinical-only user, revoked/expired technical user and foreign clinic denied; technical user with valid MFA admitted; existing MFA completion path preserved.
- [ ] Implement assigned-clinic selection at `/developer`; console navigation: Staff, Clinic settings, Operations, Technical audit. Do not query global clinic/patient lists.
- [ ] Keep clinical-lead approvals on existing clinic admin/access pages. For technical-only users, legacy admin URL redirects to the corresponding developer page after authorization. A multi-role user receives an explicit workspace link without a redirect loop.
- [ ] Run `npx vitest run tests/unit/developer-access.test.ts` and the new console browser tests with existing staff fixtures.

**Acceptance:** three identifiable workspaces, no new login, no global privilege, no broken staff landing path. Zero unauthorized data reads before guard success.

## Task 4 — Make My Children a records page with focused registration tasks

**Files:** modify `src/app/children/page.tsx`, `forms.tsx`, `privacy-notice.tsx` only as required; create `src/app/children/register/page.tsx`, `src/app/children/link/page.tsx`; extend `tests/e2e/22-child-registration-address.spec.ts`, `27-family-destinations.spec.ts`; add `tests/unit/child-task-pages.test.tsx`.

**Consumes:** existing `AddChildForm`, `LinkRequestForm`, `PrivacyNotices` and existing commands; no new child registration API. **Produces:** `/children/register` and `/children/link` task pages; old anchors remain useful entrances.

- [ ] Add failing cases for direct register/link visits with unacknowledged privacy notices, no clinic, restricted guardian and failed privacy reads.
- [ ] Reuse current form components on dedicated pages. Keep all fields, exact/estimated/unknown DOB behavior, address validation and relationship selection. Add clear Back/Cancel navigation and submission outcome.
- [ ] Replace permanently expanded forms on My Children with clear action entrances. Keep anchor targets `add-h` and `link-h` as compact action sections so external/deep links still work.
- [ ] Show identity/status/next action per child with no duplicate explanatory badges. Preserve QR controls and restricted guardian guidance.
- [ ] Verify registration/link success, duplicate/retry behavior, validation focus, privacy acceptance, reload persistence and pending access. Do not loosen privacy gating to simplify layout.

**Acceptance:** child records are visible immediately; either long task opens deliberately; every previous registration field and protected flow still works.

## Task 5 — Complete the other five Parents Portal layouts

**Files:** `src/app/vaccination-records/page.tsx`, `appointments/page.tsx`, `help/page.tsx`, `messages/page.tsx`, `messages/text-settings.tsx`, `account/page.tsx`; existing child record/visit components only where layout integration needs it; new `tests/e2e/31-parent-portal-flows.spec.ts`; extend `tests/unit/family-destinations.test.tsx`.

**Interfaces:** keep existing RPC contracts and `BookVisit`/`AppointmentItem` props. Shared contact-preferences form is reused in Account. `/messages#txt-h` retains a visible link to `/account#contact-h` for compatibility.

- [ ] Add tests for child switching, unavailable content, equal-timestamp pagination, restricted records and contact preference persistence.
- [ ] Arrange Records around child identity and existing history/next-steps/certificates links. Keep direct child anchors and authorization checks.
- [ ] Arrange Appointments around current bookings and booking availability; keep recent history reachable and explain its existing 60-day window. Preserve selected child in success/error navigation.
- [ ] Add a compact Care Info topic index using actual published titles, with source/review details. Follow the established RPC empty-value contract; unexpected null/failure must reach an error boundary rather than a false empty state.
- [ ] Keep Messages an inbox. Move contact preferences to Account using the same component/commands. Gate SMS enablement by actual server capability; phone contact remains usable with SMS off. Never advertise sandbox delivery as real delivery.
- [ ] Group Account sections and retain existing password/MFA components unchanged. Keep truthful language-preference wording. No new email-change/recovery implementation.
- [ ] Test booking, duplicate refusal, reschedule, cancellation, record/PDF links, care read, inbox paging/mark-read and account save/reload through the real local stack.

**Acceptance:** all six parent destinations have clear task hierarchy, no dead control, and a complete successful/error journey. No authentication behavior changed.

## Task 6 — Finish developer staff provisioning and access management

**Files:** create `src/app/developer/[clinicId]/staff/page.tsx`; reuse/extract presentation from clinic `admin/create-staff-account.tsx`, `admin/application-decision.tsx`, `access/staff-forms.tsx`; inspect existing `src/app/api/v1/clinics/[clinicId]/staff-accounts/route.ts` and `src/lib/validation/staff.ts`; tests `tests/db/admin-staff-creation.test.ts`, `staff-applications.test.ts`, `tests/e2e/30-developer-console.spec.ts`.

**Consumes:** `prepare_staff_account_creation`, `complete_staff_account_creation`, existing staff application/membership commands, existing roles. **Produces:** new console presentation, not a second provisioning backend.

- [ ] Add end-to-end cases for create nurse/midwife/BHW, duplicate email, lost-response retry, invalid role, no MFA, foreign clinic and pending approval.
- [ ] Build list/status/filter and dedicated create form from existing controls. Explain that an account exists immediately while staff privileges may await independent approval. Do not automatically grant clinical authority.
- [ ] Keep temporary password in memory only; never display it after creation or include it in logs/audit/URLs. Clear it on successful completion. Reuse current password/security handling.
- [ ] Prove application acceptance, independent approval, rejection reason, reloading pending state and effective revocation. Last-approver protection remains enforced in the database.
- [ ] Expose membership expiry in the list. If needed extend the existing membership read in a new migration; show a seven-day expiry warning for approval-capable roles and link the existing recovery runbook. Do not create automatic privilege renewal.
- [ ] Run focused DB and browser tests, including stale version and simultaneous decisions. Update fixtures/callers affected by presentation extraction.

**Acceptance:** a developer creates a local staff account, the correct independent person activates authorized access, and that person can complete their role's work through unchanged sign-in. No duplicate identity on retry; no self-approval.

## Task 7 — Separate technical configuration, operations and audit

**Files:** new developer `settings/page.tsx`, `operations/page.tsx`, `audit/page.tsx`; reuse clinic settings forms; new forward migration `0062_technical_console_reads.sql` if that number is still free at execution; update `src/lib/db/port.ts` for new typed RPC; tests `tests/db/technical-console.test.ts`, console E2E. Regenerate install SQL only through `npm run db:install-sql` if a migration is added.

**Contracts:** reuse `get_clinic_profile`, `get_ops_status` and existing configuration/operations-check commands. Add `list_technical_audit(p_clinic_id uuid, p_limit integer default 50, p_before timestamptz default null, p_before_id uuid default null)` only for a sanitized technical projection. Return `{ items: [{ id, action, actorName, createdAt, targetType, outcome }], nextCursor }`; validate limit 1–100 and cursor pairing. Derive outcome only from stored facts; use null when not recorded.

- [ ] Test technical-role access to own clinic, denial for parent/foreign/expired/no-MFA access, and absence of child identifiers, health details, passwords and configuration secrets from audit responses.
- [ ] Implement settings and operations views with existing authorized commands. Label backup checks as recorded evidence; errors are not green status. Add refresh, timestamp and backlog age.
- [ ] Implement the technical audit projection with an explicit allowlist of existing staff-access, clinic-configuration and operations-check audit actions, selected by inspecting current emitters. Do not grant broad `audit.read` to technical roles or return raw payloads. Unknown event types remain excluded.
- [ ] Test paging at identical timestamps, denied arbitrary event types, and durable audit entries after staff/configuration actions.
- [ ] Verify restore using the existing CLI drill in its disposable database. The UI records evidence; it does not execute arbitrary server commands or pretend to restore a database.

**Acceptance:** developers can diagnose local operational failures and manage technical settings without clinical records or secrets. Every displayed status has a real source.

## Task 8 — Organize Clinics Portal around the clinic day

**Files:** `src/lib/auth/clinic-navigation.ts`, clinic `staff-nav.tsx`, `workspace.tsx`, `today/page.tsx`, `today/board.tsx`, `[clinicId]/page.tsx`, `children/[childId]/page.tsx`; shared styles in `src/components/application.css` scoped to operational portals; tests `tests/e2e/28-staff-record-layout.spec.ts`, new `32-clinic-workflows.spec.ts`.

**Interfaces:** extend `NavItem` with `group: "daily" | "records" | "management"`; update every caller. Keep each existing href and capability predicate. Clinical approval remains in the clinic management group; technical-only navigation links to Developer Console.

- [ ] Test role-specific groups for nurse, midwife, BHW, assistant, inventory clerk, clinical lead, technical-only and multi-role accounts.
- [ ] Implement grouped desktop/mobile navigation and persistent clinic identity. Do not remove seldom-used correction, transfer or stock safety tools.
- [ ] Prioritize Today session/queue actions; prioritize child identity/current visit/recording on the clinical record. Keep review/history tools reachable without an overwhelming first viewport.
- [ ] Exercise search → registration or existing child → guardian verification → appointment/walk-in → check-in → supported visit outcome → history and next action.
- [ ] Test cancelled sessions, no sessions, duplicate check-in, stock unavailable, API failure, stale version, finishing without a dose, long names and reload of the current workflow.

**Acceptance:** each worker reaches permitted daily tasks quickly, retains all authorized secondary tools and cannot cross clinic/role boundaries.

## Task 9 — Close demonstrated clinical and operational flow gaps

**Files:** change only failing shared implementations after tracing their callers; primary targets are existing visits/administration, card review, corrections, transfer, follow-up, inventory and worker modules. Tests: `tests/db/{visits,administration,card-workflows,guardian-merge-integrity,record-transfer,followup,inventory,reminder-freshness,runtime-security}.test.ts`, existing E2E 04/06/07/08/12/16/19 and new clinic suite.

**Interfaces:** preserve current command signatures unless the failing scenario needs a documented additive field. Every schema change gets a forward migration, install-script update and upgrade test.

- [ ] Trace and exercise concurrent final-slot booking, duplicate retries, lost-response vaccination retry, cancelled session and transfer during a pending booking. Verify database state, not just toast text.
- [ ] Exercise reported dose → staff verification → eligible history/certificate, card rejection/withdrawal, duplicate child resolution and vaccination correction with original/audit preserved.
- [ ] Exercise lot receipt → usable stock → vaccination consumption; expired/quarantined lot refusal; counts/approval and cold-chain review. Preserve atomic stock/event behavior.
- [ ] Exercise overdue follow-up → recorded contact attempt → appointment → completed visit → refreshed follow-up status. Verify BHW data minimization.
- [ ] Exercise certificate issue/download/verification using actual generated PDFs; reject reported-only doses and verify revoked/invalid certificate behavior. Compare report exports and printable paper tallies with seeded administrations across clinic-timezone date boundaries. Do not add coverage percentages without valid denominators.
- [ ] Exercise outbox delay/failure → visible backlog → worker restart → one in-app message. Keep external SMS disabled.
- [ ] For each real failure, write a regression, prove it fails, fix the root shared implementation, rerun targeted checks. Record already-passing scenarios as verified rather than rewriting them.

**Acceptance:** core care journeys succeed locally with trustworthy records and recoverable failures. No additional clinical automation or invented medical policy is introduced.

Include `tests/db/certificates.test.ts` and `tests/db/reports.test.ts` in this task's focused test set. Existing reports and certificate routes remain authoritative; fix shared logic only when these scenarios fail.

## Task 10 — Accessibility and responsive verification

**Files:** affected portal components and `application.css` only; extend `tests/e2e/13-interaction-accessibility.spec.ts`, `24-application-quality.spec.ts`, and new portal suites.

- [ ] Capture all six parent destinations and representative clinic/developer tasks at 390/768/1440px; include open forms, errors and restricted access, not only empty dashboards.
- [ ] Run axe and keyboard journeys: skip link, sidebar, portal switch, forms, errors, focus return, Escape where relevant, and all primary actions.
- [ ] Verify 200% zoom, long names/record numbers, reduced motion, readable status labels, 44px targets and no horizontal page overflow. Tables may have a labeled local scroll region.
- [ ] Inspect one batched screenshot round, correct material issues together, then confirm once. Use a fresh reviewer for remaining findings instead of endless cosmetic iteration.
- [ ] Compare protected landing/auth visuals and behavior with baseline after shared-shell changes. Hash-check protected source files; any unauthorized drift blocks completion.

**Acceptance:** all essential tasks remain reachable on phone, tablet and desktop; automated accessibility results and manual keyboard evidence are saved. Do not claim full accessibility conformance from axe alone.

## Task 11 — Integrated local acceptance and persistence

**Files:** tests/documentation only unless a demonstrated regression requires a scoped fix. Evidence under `tmp/three-portals/`.

- [ ] Run `npm run check`, `npm run test:db`, `npm run matrix:check`, `npm run build`.
- [ ] Run `npm run test:e2e` on the isolated local stack. No mocked successful mutations in acceptance tests.
- [ ] Run `npm run drill:restore` and `npm run drill:upgrade` against their disposable targets after confirming script target guards. Save outputs and verify source data is intact.
- [ ] Restart normal local services without reset and confirm synthetic acceptance records/bookings/preferences persist. Test core operations with external network unavailable after local dependencies are prepared; localhost remains available.
- [ ] Reconcile the acceptance matrix below with test names, logs, screenshots and defect resolutions. No skipped essential test is a pass.
- [ ] Have the reviewer check the final diff, role matrix, protected baseline and evidence; fix blocking findings and rerun their focused checks.

**Acceptance:** all essential scenarios pass on the real local stack, no unresolved blocking defect, and data survives restart. Build success alone does not satisfy this task.

## Task 12 — Handoff and truthful readiness documentation

**Files:** update `PRODUCT.md` operational-surface description, `docs/engineering/family-destinations.md`, `docs/implementation/known-limitations.md`, relevant operations docs; create `docs/audit/2026-10-17-three-portals-completion.md`. Preserve historical audit evidence.

- [ ] Document the three portal URLs, role-specific tasks, local bootstrap, staff approval path, worker startup, outage-paper path and restore procedure.
- [ ] Record each check actually run, its result and evidence location. Reconcile stale limitation entries against current source/tests.
- [ ] State excluded integrations and any remaining device/clinical acceptance limits. Do not expose a placeholder for an excluded feature.
- [ ] Produce a small walkthrough using synthetic identities: parent registration, developer provisioning, independent clinical approval, BHW follow-up and nurse/midwife visit completion.
- [ ] Stage only task-owned changes for any requested commit; never bundle pre-existing work. Do not deploy or publish as part of local completion.

## Required acceptance matrix

| ID | Journey / failure | Evidence required | Owner task |
| --- | --- | --- | --- |
| A01 | Protected landing and all sign-in/create-account routes | Baseline hash and behavior/visual comparison | 1, 2, 10 |
| A02 | Parent sees only own authorized children; foreign IDs denied | UI + direct API/DB denial | 4, 5, 9 |
| A03 | Register/link with privacy gate, validation, pending/approved access | Actual writes and reload | 4 |
| A04 | Book, reschedule, cancel, final-slot race and retry | Correct capacity/history in DB | 5, 9 |
| A05 | No clinic/session/content/record versus failed data read | Distinct actionable states | 4, 5, 8 |
| A06 | Developer provisions nurse/midwife/BHW; independent approval activates | Auth identity, application, membership and real sign-in | 6 |
| A07 | Self-approval/foreign clinic/expired/revoked/no-MFA refused | Server/DB tests; stale open page | 3, 6, 9 |
| A08 | Multiple roles/clinics and shared Account/Messages navigation | Direct navigation, reload, Back | 2, 3 |
| A09 | Walk-in and booked arrival through visit completion | Actual queue/visit/history state | 8, 9 |
| A10 | Vaccination with lot checks and atomic stock change | DB race/retry and UI journey | 9 |
| A11 | Reported card/dose review, correction and duplicate resolution | Original/history/audit retained | 9 |
| A12 | Record transfer and guardian access change | Source/destination scope and booking handling | 9 |
| A13 | Follow-up outcome and refreshed overdue status | BHW scope, persisted outcome | 9 |
| A14 | In-app messages, worker failure/restart, paging, read state | Exactly-once user-visible outcome after retry | 5, 9 |
| A15 | Certificate download and authenticity check | Actual valid local PDF/QR; reported-only refusal | 5, 9 |
| A16 | Profile/contact preferences and existing security links | Save/reload; auth regression remains green | 5 |
| A17 | Developer configuration/operations/technical audit | Real status, redacted projection, no secrets | 7 |
| A18 | Clinic reports and paper fallback | Export matches seeded records and time range | 8, 9 |
| A19 | Responsive, keyboard, error focus, zoom and reduced motion | Screenshots + axe + interaction tests | 10 |
| A20 | Local restart, backup restore, migration upgrade | Disposable drill evidence and persistence | 11 |

## Dependencies and stopping rules

Sequence: 1 → 2 → 3; 4–5 and 6–7 may then proceed independently; 8 follows shared navigation decisions; 9 integrates flows; 10–12 close the release. No cosmetic task may bypass an authorization/data-integrity failure.

If a required improvement would alter protected auth behavior, do not silently expand scope: keep existing behavior, document the exact conflict and obtain a separate instruction before that change. If a local dependency is unavailable, report its actual error and leave affected acceptance rows unverified. Do not replace real flows with mocks to claim completion.

This is a complete execution plan for the defined local scope, not proof of completed software. Completion means all required rows have current passing evidence and every included user-facing action is functional; it is not a mathematical guarantee of zero defects.
