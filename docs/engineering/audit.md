# Findings registry (iteration loop, started 2026-10-01)

Each row links to the full finding (evidence, root cause, solution, acceptance, verification) in the specialist report under `discovery/`. Status values: Open · Assigned · Implemented (awaiting review) · Reviewed · Verified · Rework · Deferred (reason) · External.

Prior registry items E01–E17 / G01–G06 live in [../audit/master-plan.md](../audit/master-plan.md); they are reconciled into this table as they are re-verified.

| ID | P | Class | Title | Owner | Status |
|---|---|---|---|---|---|
| SEC-01 | P1 | Reproduced | Rate-limit key collapses to one global bucket per route; one client can lock out sign-in, verify, displays, queue actions | Impl A → A2 | Rework (RV2-A-01, review/batch1-security.md) |
| SEC-02 | P2 | Reproduced | Sign-out leaves Supabase cookie when token refresh fails, still reports signed out | Impl A | Reviewed (APPROVE, batch1-security.md) |
| SEC-03 | P2 | Missing | Session cookies 400-day, not Secure; no staff idle lock; no step-up reauth | Impl A → A2 | Cookies APPROVED; idle sign-out Rework (RV2-A-02); step-up deferred |
| SEC-04 | P3 | Inspection | Store outage degrades to per-process memory for anonymous abuse-sensitive scopes | Impl A | Reviewed (APPROVE, batch1-security.md) |
| SEC-05 | P3 | Reproduced | `merge_children` wrapper checks/locks foreign-org children before ownership check | SQL batch | Reviewed (APPROVE) |
| SEC-06 | P3 | Reproduced | Configuration error text returned to anonymous clients | Impl A | Reviewed (APPROVE; follow-up RV2-A-05) |
| FE-01 | P1 | Reproduced | "Approve and post adjustment" falsely closes transfer-shortfall / exception stock cases | Impl B1 (UI) + SQL batch (refusal) | UI APPROVED; SQL refusal APPROVED (batch1-sql.md) |
| FE-02 | P1 | Inspection | `appointment` review cases have no action; oldest-50 cap hides newer cases | Impl B1 (UI) + SQL batch (paging) | UI APPROVED; paging → C2 (0035) then UI |
| FE-03 | P2 | Missing | Staff without MFA get a generic server-error page on every clinic route | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-04 | P2 | Reproduced | Follow-up links send BHW users to a page they cannot open | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-05 | P2 | Reproduced | Timestamps shown as UTC-sliced dates (off by one day before 08:00 Manila) | Impl B1 + B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-06 | P2 | Missing | No link from queue ticket to child record | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-07 | P2 | Inspection | Repeated auth lookups and sequential data waterfalls per page | Impl B1 + B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-08 | P2 | Missing | No loading.tsx / segment error.tsx; errors drop staff navigation | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-09 | P2 | Inspection | Administration/temperature times read in device zone, not clinic zone | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-10 | P2 | Missing | Follow-up (50) and child search (20) silently capped | SQL batch + UI | C2 (0035 totals) then UI |
| FE-11 | P3 | Reproduced | Guardian edit request always says no birth date on file | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-12 | P3 | Reproduced | Suspended memberships labelled "Waiting for approval" | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-13 | P3 | Inspection | Display board hydration mismatch; family messages shown in UTC | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-14 | P3 | Optional | Consequential one-click actions without confirmation | Impl B1 → B1R | Rework assigned (RV1-01) |
| FE-15 | P3 | Inspection | UI branches on SQL error message text | SQL batch + errors.ts | C2 (hints + errors.ts reason) then UI |
| FE-16 | P3 | Inspection | Staff PDF/CSV downloads are bare links; failures show raw JSON | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-17 | P3 | Missing | Irreversible merge audited with hard-coded reason | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-18 | P3 | Reproduced | Raw ISO DOBs on identity-decision screens | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-19 | P3 | Reproduced | Password minimum 8 at sign-up vs 12 at reset | Impl A | Reviewed (APPROVE; follow-up RV2-A-06) |
| FE-20 | P3 | Inspection | Swallowed privacy-notice batch error with N+1 fallback | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| FE-21 | P3 | Optional | Dead UI primitives, duplicate success announcements, 8 duplicate Outcome components | Later batch | Motion-class sweep done; rest batch 2 |
| DB-01 | P1 | Reproduced | Active clinical hold stops blocking administration after the held duplicate is merged | Impl C (0034) | Reviewed (APPROVE) |
| DB-02 | P1 | Reproduced (volume) | Child history/evaluation scans whole cross-tenant revisions table; >312 s at 100k children | Impl C (0034) | Reviewed (APPROVE w/ follow-up RV2-C-03) |
| DB-03 | P2 | Reproduced | Privacy ack keyed by org+label; other clinic's same-label notice counts; pending-notice RPC spans unrelated orgs and creates guardian rows there | Impl C (0034) | Reviewed (APPROVE w/ follow-up; RV2-C-08 user decision) |
| DB-04 | P2 | Reproduced (policy-dependent) | `trace_lot_use` / `search_audit` disclose other clinics' child identities within org | Impl C (restrictive reversible default) | Rework → 0035 (RV2-C-01 UI crash → B1R, RV2-C-02 perf → C2) |
| DB-05 | P3 | Reproduced | Five commands leave `in_progress` idempotency receipts; retried key re-runs | Impl C (0034) | Reviewed (APPROVE; RV2-C-05 → C2) |
| DB-06 | P3 | Measured | No audit_logs (org, time) index; paging can skip equal timestamps | Impl C (0034) | Rework → C2 (RV2-C-02 perf, RV2-C-04 wiring) |
| DB-07 | P3 | Missing (policy) | Child can hold confirmed bookings in several sessions on one day | **User/clinic policy decision** | Open |
| SUP-01 | P1 | Missing | Migrations use pg_trgm/unaccent in `extensions` but never create them; real Supabase install fails at 0003 | Installer handles; Impl C adds `0000_extensions.sql` | Reviewed (APPROVE, batch1-sql.md) |
| SUP-02 | P1 | Missing | No supported, audited way to create the first organization/clinic/staff on a real project | Impl C (operator-only bootstrap function) | Reviewed (APPROVE w/ follow-up RV2-C-07) |
| SUP-03 | P2 | Inspection | Migrations only ever executed on PostgreSQL 18; Supabase runs 15/17 | Orchestrator | Partly verified: all migrations + DB suite + fresh-install/verify.sql executed on vanilla PG 15.18 and 17.10 (verification.md); real Supabase still External |
| SUP-04 | P2 | Reproduced (docs) | `docs/deployment.md` names env vars the code does not read | Orchestrator (docs) | Fixed (docs rewritten 2026-10-02) |
| SUP-05 | P2 | Inspection | Auth callback handles only PKCE `?code=`; cross-device email links fail; no `token_hash` branch | Impl A2 | Assigned |
| SUP-06 | P3 | Optional | Three immutable private helpers lack pinned search_path (advisor noise; inlining trade-off) | Deferred (measure first) | Open |
| ORC-01 | P3 | Inspection | Untracked `.audit-generate-0026.py` appends to migration 0026 if re-run (would corrupt checksummed history) | User decision (not ours to delete) | Open |

Supabase packaging deliverables (fresh-install generator, verify.sql, install README, manual-setup) were implemented by the packaging agent: see `discovery/supabase-compat.md` for local execution evidence.

### Browser UI findings (`discovery/ui.md`, reproduced on local demo: 312 page loads, 7 personas, 1440/390, light/dark, axe-core)

| ID | P | Class | Title | Owner | Status |
|---|---|---|---|---|---|
| UI-01 | P2 | Reproduced | Unread sr-only text makes pages 383 px wide at 320–375 px | Impl D | Reviewed (APPROVE, batch1-shell.md; browser re-check pending) |
| UI-02 | P2 | Reproduced | Mobile header/clinic nav hide most destinations; sticky controls cover links | Impl D | Reviewed (APPROVE w/ follow-up RV2-D-05) |
| UI-03 | P2 | Reproduced | Focus ring clipped in scrolling navs | Impl D | Reviewed (APPROVE; browser re-check pending) |
| UI-04 | P2 | Reproduced | Visit cancel/move: no success notice, stale error, focus lost | Impl D | Reviewed (APPROVE w/ follow-up RV2-D-06) |
| UI-05 | P2 | Reproduced | Booked check-in shows no ticket at point of action; stale "Now calling" | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| UI-06 | P2 | Reproduced | "Finish visit" defaults to Vaccinated for any queue role | Impl B1 (UI); server rule → SQL batch 2 | UI implemented; server rule → batch 2 |
| UI-07 | P2 | Reproduced | Message times in UTC (same defect as FE-13) | Impl B2 | Reviewed (APPROVE, batch1-frontend.md) |
| UI-08 | P2 | Reproduced | Family schedule "Not Yet Eligible" inside due window with no explaining date | Impl D (UI); target>window question → scheduling owner | UI Reviewed (APPROVE); target>window question → user |
| UI-09 | P2 | Inspection | Theme pre-paint script lacks CSP nonce → production theme flash | Impl D | Reviewed (APPROVE; prod CSP console check pending) |
| UI-10 | P2 | Reproduced | 200 % text overflows guardian cards / Today | Impl B1, B2, D (per file) | Cards/Today APPROVED; brand Rework (RV2-D-04, globals.css px sizes — waits for user's style edits) |
| UI-11 | P3 | Reproduced | Sticky sidebar / child banner slide under header | Impl D | Reviewed (APPROVE w/ follow-up RV2-D-07) |
| UI-12 | P3 | Reproduced | Sign-out confirm drops focus, reflows header | Impl D | Reviewed (APPROVE) |
| UI-13 | P3 | Reproduced | Small touch targets ("Open record", "Back to top") | Impl B2, D | Reviewed (APPROVE) |
| UI-14 | P3 | Reproduced | "Expected today" lists cancelled bookings with raw status | Impl B1 | Reviewed (APPROVE, batch1-frontend.md) |
| UI-15 | P3 | Inspection | `.animate-in` collision, `transition-all`, entrance motion on work pages | Impl D | Reviewed (APPROVE w/ follow-up: unused src/components/ui/button.tsx) |
| UI-16 | P3 | Reproduced | axe `region` (demo banner) and `landmark-unique` (review cards) | Impl D, B1 | Review part APPROVED; banner Rework → user decision RV2-D-01 (layout.tsx is user-owned) |

Positive browser evidence: 0 console errors; 0 axe color-contrast violations in either theme (lowest text contrast 4.86:1 light); dark mode complete; reduced motion correct; skip link, single h1 and landmarks on every page; booking, check-in→finish, stock receipt journeys persisted after reload.

### New items raised during batch 1 implementation

| ID | P | Class | Title | Owner | Status |
|---|---|---|---|---|---|
| IMP-01 | P2 | Inspection | `resolve_review_case` with `no_action` sets status `rejected` for every kind (appointment/stock "handled" closes should be `resolved`); stock-kind close needs `review.resolve`, so inventory approvers cannot close exception-stock checks | Batch 2 SQL | C2 (0035) |
| IMP-02 | P3 | Inspection | Outgoing/incoming record-transfer list links on `/clinic/:id/transfers` not capability-gated (may 404 for roles without `child.search`) | B1R | Assigned |
| IMP-03 | P3 | Maintainability | `src/app/children/[childId]/download-button.tsx` kept as re-export shim for an existing test import | B1R | Assigned |
| IMP-04 | P3 | Consistency | `formatClinicDateTime` prints "Oct 2, 2026, 7:30 AM" while `formatClinicDate` now prints "2 Oct 2026" | Batch 2 | Open |
| IMP-05 | P3 | Inspection | Display board time shown in device zone after mount; `public_queue_display` / `my_messages` should return clinic timezone | Batch 2 SQL | C2 (0035) then UI |

### Review findings (batch 1 frontend review, `review/batch1-frontend.md`)

| ID | P | Title | Owner | Status |
|---|---|---|---|---|
| RV1-01 | P3 | Seven confirmation flows drop keyboard focus on open/cancel | B1 | B1R assigned (not done in iteration 1 — batch1-shell.md) |
| RV1-02 | P3 | Stock review case links shown to roles that cannot open target pages | B1 | B1R assigned (not done in iteration 1 — batch1-shell.md) |
| RV1-03 | P3 | Unreadable administration time can still be signed (DB records now) | B2 | B1R assigned (not done in iteration 1 — batch1-shell.md) |
| RV1-04 | P3 | Removal edit requests shown as "(left empty)" with raw field names | B1 | B1R assigned (not done in iteration 1 — batch1-shell.md) |
| RV1-05 | P3 | "Now calling" reappears after hold → requeue | B1 | B1R assigned (not done in iteration 1 — batch1-shell.md) |
| RV1-06 | P3 | `resolve_review_case` no_action stored as `rejected` (same as IMP-01) | Batch 2 SQL | C2 (0035) |
| RV1-07 | P3 | Kind-coverage test reads 0012 directly, not latest constraint | B1 | B1R assigned (not done in iteration 1 — batch1-shell.md) |

### Iteration 2 findings (orchestrator inspection, 2026-10-02)

| ID | P | Class | Title | Owner | Status |
|---|---|---|---|---|---|
| UI-17 | P3 | Inspection | Landing `InteractiveConstellation` (`src/components/interactive-constellation.tsx`): with reduced motion the single static frame is never redrawn after resize (canvas clears → blank) or theme switch; with motion it animates every frame while scrolled off-screen (O(n²) pair loop, up to 75 nodes) — no IntersectionObserver/visibility pause | Batch 2 UI | Open |
| ORC-02 | P3 | Inspection | `.github/workflows/quality.yml` never runs `test:demo` or `db:install-sql --check`, so a migration change can ship with a stale paste-ready `fresh-install.sql`; CI PostgreSQL comes from the runner image (`pg_config`), version unpinned | Batch 2 | Open |

### Review findings (iteration 2: `review/batch1-security.md`, `review/batch1-shell.md`)

| ID | P | Title | Owner | Status |
|---|---|---|---|---|
| RV2-A-01 | P1 | Ten addresses (or one IPv6 /64) exhaust the deployment-wide sign-in limit → everyone gets 429; list-valued client header spoofable | A2 | Assigned |
| RV2-A-02 | P2 | Idle monitor revives an expired period on late input; sign-out does not reach other tabs | A2 | Assigned |
| RV2-A-03 | P3 | Browser-SDK-written auth cookies lack Max-Age (session cookies until next server refresh) | A2 | Assigned |
| RV2-A-04 | P3 | Non-id dynamic segment gives fresh pre-auth bucket; in-process limiter map unbounded during outage | A2 | Assigned |
| RV2-A-05 | P3 | Schema-invalid config → generic "unhandled ZodError" log without variable name | A2 | Assigned |
| RV2-A-06 | P3 | manual-setup told operators Supabase min password 8; resets bypass server check | Orchestrator (doc) + A2 (comment) | Doc fixed (manual-setup.md §3 now 12) |
| RV2-D-01 | P2 | Sandbox/dev notice disabled with literal `false` in layout.tsx; test enforces absence; contradicts DESIGN.md | **User decision** (layout.tsx user-owned) | Open |
| RV2-D-02 | P2 | `globals.css:1` imports Google Fonts; own CSP blocks it (font never loads) | Batch 2 (after user's style edits settle) | Open |
| RV2-D-03 | P2 | Unit suite red after light-only change | User (fixed own test at 18:25) | Closed — user decision light-only; shell tests 10/10 pass |
| RV2-D-04 | P3 | Fixed px brand caption/name sizes override utilities (UI-10 brand) | Batch 2 (globals.css) | Open |
| RV2-D-05 | P3 | Mobile menu first-focus selects hidden sign-out Confirm | B1R | Assigned |
| RV2-D-06 | P3 | Visit notice announced three ways | B1R | Assigned |
| RV2-D-07 | P3 | Sticky sidebar / child banner can hide content on short screens | Batch 2 (clinic layout + ui.tsx) | Open |
| RV2-D-08 | P3 | Toasts follow stored theme instead of forced light | User | Closed — toaster.tsx changed by user 18:24 (to verify) |
| RV2-D-09 | P3 | Flag-colour ring + "eGOV.ph visual brand" CSS comment vs no-affiliation rule | **User decision** | Open |

Note: `src/components/interactive-constellation.tsx` changed at 18:22 by the orchestrator (UI-17), not by the user's light-only edit as batch1-shell.md assumed.

### Iteration 2: SQL review (`review/batch1-sql.md`) and API route audit (`discovery/api-routes.md`)

All SQL rework goes to a NEW migration 0035 (0034 is left byte-identical because the user's demo DB may have applied it; the demo launcher refuses changed checksums).

| ID | P | Title | Owner | Status |
|---|---|---|---|---|
| RV2-C-01 | P1 | Lot trace "Who received this lot" crashes (`t.status.replace` on 0034's other-clinic summary entries) | B1R (`inventory/forms.tsx`) | Assigned |
| RV2-C-02 | P2 | `search_audit` builds the clinic's whole children list per call: ~390 ms/page at 1M rows (target <10 ms) | C2 (0035) | Assigned |
| RV2-C-03 | P3 | `report_backlog` pending count 3x slower after 0034 | C2 | Assigned |
| RV2-C-04 | P3 | Audit route/page never pass `p_before_id` (same as API-03) | C2 | Assigned |
| RV2-C-05 | P3 | `issue_certificate` lost the "denied" audit row for foreign-clinic attempts | C2 | Assigned |
| RV2-C-06 | P3 | install README lacks 0034 risky steps (write-blocking index build, immutable-table backfill, dropped functions) | C2 (README/generator) | Assigned |
| RV2-C-07 | P3 | Bootstrap audit lacks DB login; rerun after all memberships revoked creates a 2nd org | C2 | Assigned |
| RV2-C-08 | P3 | Users with no relationships get every org's privacy notices (cap 100) — deliberate trade-off vs DB-03 acceptance | **User decision** | Open |
| API-01 | P3 | Certificate issue reports "saved, retry" for permanent render failures; CV503 → 500 | C2 (CV503 mapping); rest Open | Partly assigned |
| API-02 | P3 | 16 MB unused CJK font traced into 165/167 server bundles; `src/lib/certificates/fonts/` untracked (must be committed with the code) | Orchestrator | Fixed (next.config.ts exact routes + `tests/unit/build-tracing.test.ts` 2/2); bundle check at integration build; commit note for user |
| API-03 | P3 | Audit paging ignores `p_before_id`; invalid dates → 500 | C2 | Assigned |
| API-04 | P3 | Review resolve / resolve-link / staff approve / revoke reveal foreign ids (lock/403 before tenant check) | C2 (0035) | Assigned |
| API-05 | P3 | `check_in` wrapper (0025) same ordering leak | C2 (0035) | Assigned |
| API-06 | P3 | Anonymous calls to signed-in routes parse up to 5 MB body before 401 | A2 (handler.ts) | Assigned |
| API-07 | P3 | Two Supabase Auth calls per API request (proxy + handler) before any rate limit | Later batch | Open |
| API-08 | P3 | `GET …/schedule?asOf=` persists evaluations for arbitrary dates (GET with writes) | Later batch | Open |
| API-09 | P3 | `GET …/checkins?status=answered|closed` unbounded | Later batch | Open |
| API-10 | P3 | Restore drill restores into the same cluster; doesn't prove fresh-server restore nor compare roles/policies/auth | Later batch | Open |

## Iteration 4 (2026-10-06)

Columns follow the iteration-4 brief: ID · severity · evidence · root cause · files · solution · dependencies · owner · acceptance · verification · migration/rollback · status. Older rows above still marked "Assigned" from iteration 2 (agents stopped by rate limits) are re-checked against the current code under I4-10 instead of being trusted.

| ID | P | Evidence / reproduction | Root cause | Files | Solution | Deps | Owner | Acceptance | Verification | Migration / rollback | Status |
|---|---|---|---|---|---|---|---|---|---|---|---|
| I4-01 | P2 | `.claude/launch.json`: `cvsrs-demo` runs `npm run demo` (script removed 2026-10-04); `cvsrs-dev` passes `-- --port 3100`, but `scripts/dev.ts` ignores arguments and binds 3000 (the Supabase redirect allowlist names 3000), and 3100 is the E2E app port | Launch config not updated when the sandbox was removed | `.claude/launch.json` | One `cvsrs-dev` entry: `npm run dev`, port 3000 | — | Orchestrator | Preview starts the real app on 3000 | preview_start + `/api/v1/health/ready` 200 | none | Open |
| I4-02 | P1 | coverage.md: staff visit changes, corrections, stock transfers/wastage/counts/cold chain, CSV export, record transfer, care content, settings, audit search, follow-up, review cases, certificate revoke and access revocation have DB evidence only; no browser journey drives their screens | Journeys 01–05 cover accounts, first staff, applications and the first visit | `tests/e2e/06+` | Browser journeys that use each screen's own controls and read results back after a reload and as the other affected role, plus refusals for roles without the capability | first-visit data (04) | QA agent | Each listed workflow: happy path persisted; at least one refusal or invalid-input case per screen; any defect reported with reproduction | `npm run test:e2e` | none (tests only) | Open |
| I4-03 | P2 | `revoke_staff_membership` (0002) has no last-holder check; known-limitations L50 | Two-person grants need two holders of `admin.users`/`grant.approve.clinical`; revoking the last holder leaves only the database owner able to restore access (approval deadlock) | new `0040_*`, `tests/db` | Refuse (CV409, plain reason) a revoke that would leave the clinic with no active `admin.users` holder; same for the last `grant.approve.clinical` holder | — | Backend agent | Last-holder revoke refused, others allowed, idempotent replay unchanged | DB tests | forward migration redefining one function; rollback = previous definition | Open |
| I4-04 | P3 | `acknowledge_privacy_notice`, `record_report_export` allow-listed and executable but never called (audit F55) | Superseded by `acknowledge_clinic_privacy_notice` and the `p_export` flag | `0040_*`, `src/lib/db/port.ts`, `tests/db/reports.test.ts`, `tests/db/sweep.test.ts`, `scripts/matrix.ts` | Revoke execute from `authenticated`, drop from the allowlist, update tests and matrix row | — | Backend agent | allowlist = executable set; no app caller | DB catalog test | revoke only; rollback = re-grant | Open |
| I4-05 | P3 | `src/app/children/[childId]/visits.tsx:76` matches SQL message text (audit F19) | No stable hint on the CV409 | `0040_*`, `src/lib/api/errors.ts`, `src/lib/client/api.ts`, `visits.tsx` | Raise with hint `cvsrs:duplicate_session_booking`, carry it to the client, branch on it | — | Backend agent | Changing the message text does not change the UI | unit + DB | function redefinition | Open |
| I4-06 | P2 | Brief requires proof that an applicant cannot pick a privileged role, approve themselves, choose unauthorized clinic access or escalate via the request body | Investigation | `tests/db/staff-applications.test.ts` (read), new tests | Add any missing negative DB tests; fix a hole if found | — | Backend agent | Each escalation attempt refused with a test | DB tests | — | Open |
| I4-07 | P2 | Upgrades were only exercised from an empty or fully migrated database (`migration up` with 0 pending); no populated older schema was upgraded | No drill | `scripts/upgrade-drill.ts`, `package.json` | Disposable DB: bootstrap + migrations up to an older version, populate through the real commands, apply the rest, check data preserved and catalog invariants (RLS on, no write grants, pinned definers, allowlist = executable) | I4-03/04/05 migration | Backend agent | Drill exits 0 and reports preserved counts | `npm run drill:upgrade` | none (disposable DB) | Open |
| I4-08 | P2 | Signed-in screens were scanned by axe but not visually reviewed with real data this iteration | — | per finding | Bounded rendered pass (375/768/1280) on the populated E2E stack; fix concrete defects in one batch | I4-02 | Orchestrator | Findings fixed or recorded | screenshots + re-run | none | Open |
| I4-09 | P2 | coverage.md and status docs predate this iteration | — | docs | Regenerate from the final tree and evidence | all | Orchestrator | Counts match the final tree | `matrix:check`, manual | none | Open |
| I4-10 | P3 | Rows RV2-C-04/05/07, API-03…06, API-08/09 above still read "Assigned"/"Open" | Iteration-2 agents stopped by rate limits | read-only | Re-check each against current code; mark Verified-fixed with file:line or keep open with a concrete fix | — | Backend agent | Each row has a current status with evidence | code read | — | Open |

Outside this repository's control (release blockers, not engineering defects): F01 work uncommitted with no remote and CI never run (needs the user's commit/remote decision); hosted Supabase project, SMTP sender, Redis REST store, hosting platform, deployed worker, TLS and monitoring; privacy notice/policy text; an approved clinical schedule and products; manual assistive-technology and real-device testing; deleting `.audit-generate-0026.py` and the stale worktree (user decisions).
| I4-11 | P2 | `scripts/worker.ts` awaited `runOutboxOnce` in a bare loop: one failed connect (ECONNREFUSED) was an unhandled rejection that ended the daemon, printed a raw stack instead of a JSON event, and SIGTERM killed it mid-wait | No error handling or signal handling in the loop | `scripts/worker.ts`, new `src/lib/worker/loop.ts`, `tests/unit/worker-loop.test.ts`, `docs/deployment.md` §4 | Loop module: structured `worker_pass` / `worker_pass_failed` events (code only, no driver message), capped exponential backoff, `--once` exit 1 on failure, stop between passes on SIGINT/SIGTERM | — | Orchestrator | Daemon survives failed passes; `--once` failure exits 1; no host in logs | unit 4/4; smoke against a closed port: one `worker_pass_failed` line, exit 1 | none | Implemented (awaiting review) |
| I4-12 | P3 | Final `list_review_cases` (0016) orders by `created_at` only; final `my_messages` (0017) by `created_at desc` only. `now()` is fixed per transaction, so rows written together (one review case per booking when a session is cancelled; all messages of one outbox pass) tie and their order and the limit boundary vary between calls | Missing id tie-breaker | `0040_*` | Add `id` as the final sort key, inner and outer | — | Backend agent | Repeated calls return identical order; equal timestamps sort by id | DB test | function redefinitions | Assigned |
| I4-13 | P3 | Review queue still caps at the oldest 50 open cases (FE-02 paging never landed); the page says "More cases may be waiting" | Paging deferred | — | Keep (honest cap notice, oldest first) for pilot scale; add cursor paging with I4 backlog item "paging" before multi-clinic load | — | — | Recorded | code read | — | Accepted (P3 backlog) |
| I4-14 | P1 | Production `next start` without Supabase settings answered **500 "Service Configuration Error" on every path, including liveness `/api/v1/health` and readiness** (smoke, port 3300); the runbook promises liveness 200, readiness 503 and a generic 503 | `src/proxy.ts` returned 500 before any route ran | `src/proxy.ts`, `tests/unit/csp.test.ts` | Health paths (exact) pass through the proxy untouched; missing/invalid configuration answers 503 `Service unavailable`, `no-store` | — | Orchestrator | Liveness 200, readiness 503 with `readiness_failed` logged, pages/API 503 generic | unit 5/5 (old 500 assertion replaced by the documented 503); production smoke | none | Implemented (awaiting review) |
| I4-15 | P2 | Configured production without `CVSRS_RATE_LIMIT_URL/_TOKEN`: readiness said 200 `ready` while every rate-limited API answered 503 `misconfigured` (`/api/v1/clinics`) — a load balancer would route traffic to an instance that cannot serve its API | Readiness validated `getConfig()` only; store settings are checked lazily per request | `src/lib/security/rate-limit.ts` (`assertRateLimitStoreConfigured`), `src/app/api/v1/health/ready/route.ts`, `tests/unit/health-ready.test.ts` | Readiness also requires valid store settings in production (HTTPS origin + token); reachability is not probed (an unreachable store degrades as documented) | — | Orchestrator | Missing store → ready 503 without a database probe; settings present → 200 | unit 7/7; production smoke both ways | none | Implemented (awaiting review) |
| I4-16 | P2 | API-03 + RV2-C-04 re-checked by the backend agent: `GET …/audit?from=2026-02-30` reached PostgreSQL and came back 500; the route and page never passed `p_before_id`, so "Older entries" could skip or repeat entries sharing one timestamp | Raw query strings passed to SQL; cursor half-wired | `src/lib/api/query.ts` (`auditSearchArgs`), `src/app/api/v1/clinics/[clinicId]/audit/route.ts`, `src/app/clinic/[clinicId]/audit/page.tsx`, `tests/unit/audit-query.test.ts` | Zod-validated instants (ISO 8601 with zone), uuids and a both-or-neither cursor → 422; page passes `nextBeforeId` and ignores malformed cursor values | — | Orchestrator | Malformed input 422, never 500; paging uses `(before, beforeId)` | unit 2/2 | none | Implemented (awaiting review) |

### Iteration 4 status updates (2026-10-07 00:10)

- I4-03, I4-04, I4-05, I4-06, I4-07, I4-12: **Implemented** by the backend agent (MODEL `claude-opus-5-5`) in `supabase/migrations/0040_iteration4_integrity.sql`, `tests/db/iteration4.test.ts` (15), `tests/unit/iteration4-hints.test.ts` (7), `scripts/upgrade-drill.ts` (`npm run drill:upgrade`). Orchestrator checks: the 0040 booking bodies differ from 0013 only by the hint (diff); no later migration redefines the touched functions; default `npm run test:db` 23 files / 383 pass; `npm run drill:upgrade` PASSED (0030 → 0040 on populated data, 67 tables row-preserved, catalog invariants, allowlist = executable set 168). I4-06 found no escalation hole (applications are requests; acceptance needs the accepter plus a different, qualified approver; bodies are strict schemas). Awaiting independent review.
- I4-10 outcome (re-checked against current code): RV2-C-04 and API-03 → fixed as I4-16. Still open, all P3, concrete fixes recorded in the backend report and carried to the backlog: RV2-C-05 (denied audit row lost for foreign-clinic certificate issue), RV2-C-07 (bootstrap audit lacks `session_user`; refuse when any organization exists), API-04 (resolve/resolve-link/approve/revoke answer 403 vs 404 for foreign ids — add clinic-scoped overloads), API-05 (`check_in` wrapper ordering), API-06 (body parsed before the session check on signed-in routes), API-08 (`GET …/schedule?asOf=` persists evaluations for arbitrary dates), API-09 (`list_checkins` unbounded for answered/closed).

### Independent review of iteration 4 (reviewer agent, MODEL `claude-opus-5-5`, read-only), 2026-10-07 ~00:40

Verdicts: I4-01 PASS · I4-11 PASS (P3 notes) · I4-14 PASS · I4-15 PASS (P3 test gap) · group A REVISE (F1) · I4-16 REVISE (F2, F3). Verified correct by the reviewer: revoke lock order (no deadlock cycle with approve/request/accept/bootstrap), holder rules equal `has_capability` semantics, re-check after the wait, `_prev` bodies identical to 0013 except the hint, hint → reason plumbing, I4-04 ACLs and allowlist = executable set, I4-12 bodies, proxy pass-through is exact-path and keeps CSP, audit cursor format accepted in four session time zones.

| Review finding | P | Disposition |
|---|---|---|
| F1 guard counts memberships, not people: A (tech_admin + extra `grant.approve.clinical`, or two memberships) can revoke the only other approver L, after which nobody can approve (approver ≠ requester ≠ grantee) | P2 | Returned to the backend agent (implementer); 0040 corrected in place (never applied outside disposable/E2E databases) — pending |
| F2 zod accepts year 0000 and offsets beyond ±15:59; PostgreSQL answers 22008/22009 → 500 | P3 | Fixed: `instant` refined; 22008/22009 → 422 in `errors.ts`; tests |
| F3 page cursor check let `2026-02-30T…` through (`Date.parse` rolls over); repeated `?action=` (array) threw | P3 | Fixed: `isAuditInstant`; single-value params only; `from`/`to` validated with `z.iso.date()` (impossible dates used to roll over silently) |
| F4 pg client had no `'error'` listener (idle disconnect crashes the daemon); `throw null` broke the catch | P3 | Fixed in `outbox.ts` / `loop.ts`; tests (the first draft of the idle-error test passed without the fix, so it was rewritten to emit after the pass) |
| F5 readiness "settings present → 200" untested; mocks not unmocked in `finally` | P3 | Fixed |
| F6 0040 rollback comment omits `service_role` | P3 | Backend agent, with F1 |
| I4-17 | P3 | After any failed E2E run, `npm run lint` failed with 3,054 problems: Playwright's trace viewer (`playwright-report/trace/*.js`, bundled third-party code) was linted | `eslint.config.mjs` ignored `.next*`, `.local` etc. but not `playwright-report/` or `test-results/` (both already git-ignored) | `eslint.config.mjs` | Add both folders to `globalIgnores` | — | Orchestrator | Lint is independent of local test artifacts | `npm run lint` exit 0 with the report present | none | Fixed |

- F1 (07:20): the backend agent's corrected 0040 (written 00:00:06, before the rate-limit stop; the orchestrator misread the timestamp at first) replaces `clinic_keeps_holder` with `private.clinic_can_grant(clinic, approver_cap, except)`: capabilities combined per person; a grant path exists when one person can approve and a different person can request (0002 rules). A revoke is refused only when it turns a working path into a broken one. 19 tests in `iteration4.test.ts` (5 of 9 guard tests fail against the previous 0040); full DB suite 23/387 on `cvsrs_audit_backend`; drill PASSED; install up to date. F6 header corrected. → focused re-review requested.

### Focused re-review (reviewer, MODEL `claude-opus-5-5`), 2026-10-07 ~07:40

F1–F6 and I4-17: **PASS**. The reviewer tried ten further ways to strand a clinic (departing admin, self-revocation, holders at another clinic, suspended account, concurrent revokes of different capabilities, …); all behaved correctly, and no legitimate departure is blocked once a replacement is approved.

| New | P | Finding | Disposition |
|---|---|---|---|
| N1 | P2 (gate) | `tests/unit/rate-limit-isolation.test.ts` flood tests (~1,000 sequential sign-in calls each) exceed vitest's 5 s default under full-suite CPU contention (6–7.8 s); 0.7 s alone | Fixed: explicit 30 s timeout on those two tests only; assertions unchanged (they test counting, not speed) |
| N2 / I4-18 | P2 | Removing a departed or compromised sole approver now needs the operator, and after an emergency suspension there was **no supported way to restore an approver** (bootstrap refuses once memberships exist; only hand-written INSERTs) | Operator break-glass `private.restore_clinic_approver` (owner-only, only while the clinic cannot approve through the app, confirmed email, audited with `session_user`) → backend agent, in 0040; runbook "Incidents" rows written; L50 updated |
| N3 | P3 | `valid_until` expiry is not guarded (an expiring grant can remove the last approval path) | Recorded as known limitation L51 with the operator recovery path |

### Flow defects found by the browser journeys (QA run 2026-10-06 23:59–00:02, artifacts in `test-results/`), fixed by the orchestrator 2026-10-07

| ID | P | Evidence | Root cause | Fix | Verification | Status |
|---|---|---|---|---|---|---|
| QA-01 | P1 | Journey 07: after a nurse sends a dose correction ("Send for approval"), no confirmation appears; the form simply closes (page snapshot shows "Request a correction" again). Staff cannot tell the request went in and may re-submit (the database then answers "a correction for this record is already waiting for review") | `CorrectionForm` called `setOpen(false)` on success, unmounting the `Outcome` inside the form; it also never passed the `ok` text, so even a mounted notice showed nothing | Persistent `ResultRegion` outside the form with a `role="status"` notice "Correction sent for approval"; errors stay next to the submit button; reopening the form clears the previous outcome | E2E journey 07 assertion (re-run pending); typecheck/lint | Implemented |
| QA-02 | P3 | Journey 06: changing session places below one booking shows "1 families are already booked" | SQL message in `update_session_capacity` (0037:261) shown verbatim | Singular/plural message in 0040 (backend agent); also "1 places left" (Today chip) and "Checked 1 children" (follow-up notice) fixed in the UI | DB test (pending), E2E 06 | In progress |
| QA-03 | — | Journeys 08/09: `page.goto` timed out after 60 s; trace shows the document answered 200 in 535 ms but the load event never fired (the HTML stream stalled), and the next journey's plain sign-in page stalled too | Under investigation: at that minute other agents ran DB suites and builds on the same machine (CPU starvation candidate); no app evidence yet | QA agent re-runs on a quiet machine and captures `pg_stat_activity` + server log if it recurs | next E2E run | Investigating |
| QA-04 | P2 | Code sweep after QA-01: the same "confirmation unmounts with its control" defect in certificate prepare/replace/retry/revoke (the "Saved, but the document is not ready" warning vanished with the Prepare button), hold place/release, guardian pause/remove (a removed guardian leaves the list), reported-dose verify/decline, staff visit cancel/move (no success text at all), and every review-queue decision (a decided case leaves the open list). Keyboard focus also fell to the page body when the focused control unmounted | Notices owned by components that the post-success `router.refresh()` removes | New `src/components/outcome-notice.tsx` (keyed store + `OutcomeNoticeView` that focuses the newest notice and clears on leaving); controls announce, views sit above each list; errors stay beside their form; messages checked against the SQL (suspended = no history; families are told by 0037 triggers) | unit `outcome-notice.test.ts`; 507 unit pass; E2E + review pending | Implemented |
| H-01 / I4-19 | P1 (test gate) | QA: the E2E web server froze ~8 minutes into every run (document 200, load event never fired; `pg_stat_activity` idle, no locks), so journeys 08–09 could never pass | `scripts/e2e.ts` ran Playwright with `spawnSync`, blocking the event loop that drains the server's piped stdout/stderr; on Windows a full pipe blocks `next dev`'s next log write | Async `spawn` + awaited exit; log tail capped at 2,000 chunks | E2E run in progress | Implemented |
| QA-03 | P1 | No supported way to add a second clinic (only bootstrap inserts clinics), so record transfer (W14) and inter-clinic stock transfers were unusable | Missing operator command | `private.add_clinic` (owner-only, audited) in 0040 + runbook step; first staff via `restore_clinic_approver` | DB 28 tests in iteration4; drill adds a clinic; review pending | Implemented |
| QA-02 | P3 | (see above) | — | 0040 `update_session_capacity` singular/plural | DB test | Implemented |
| I4-18 | P2 | (see re-review N2) | — | 0040 `private.restore_clinic_approver`; **deviation:** new column `staff_memberships.operator_restored_at` and the active-needs-approver check now also accepts it | DB tests; drill; review pending | Implemented |
