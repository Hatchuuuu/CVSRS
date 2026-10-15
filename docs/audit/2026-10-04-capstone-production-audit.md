# eVacTrack (CVSRS): capstone and production readiness audit

Date: 2026-10-04 · Scope: audit and plan only (no application code changed) · Branch: `master` at `0e1c4a7` plus a large uncommitted working tree.

Every claim below carries one of these evidence labels:

| Label | Meaning |
|---|---|
| **Verified** | A command, query or HTTP request was run in this session and its output is quoted or summarized. |
| **Defect (confirmed)** | Reproduced at runtime, or proven by reading the exact code path with no environmental assumption. |
| **Risk (suspected)** | A plausible defect whose reproduction needs an environment that was not available. |
| **Partial** | Some layers verified (for example the database), others not (for example the browser). |
| **Not tested / blocked** | Not run, with the reason. |

---

## 0. Method, skills and limits

### Skills used

| Skill | Why | What it informed |
|---|---|---|
| `using-superpowers` | Workflow: read skills before acting | Order of work: instructions → skills → map → baseline checks → findings → plan |
| `graphify` (AST mode, no LLM) | Structure and dependency map | 1,257 nodes / 3,130 edges / 50 communities over `src/`; **no import cycles**; hub functions `api()` (138 edges) and `useMutation()` (118). Output kept in the session scratchpad, not the repo |
| `systematic-debugging` | Root causes, not symptoms | F02 (`npm run dev` cannot sign in), F04 (build deletes sandbox output), F05 (orphaned database) were each traced to a single cause before a fix was proposed |
| `impeccable` (`context` + `audit` playbook) | UI, accessibility, responsive, theming, integrity scoring | Section D health score, P0–P3 tags, the "never fabricate" integrity check against PRODUCT.md |
| `design-system` (`validate-tokens.cjs`) | Token drift | 68 hard-coded hex values, all in the landing system, image generators, brand mark and the shared footer (F28). Operational pages are token-clean |
| `emil-design-eng`, `review-animations` | Motion review | Section D.4 Before/After/Why table |
| `brainstorming` | Substantial behaviour changes | Two decisions are left to you instead of being decided here: the local-development path (D-1) and the hosting target (D-2) |
| `writing-plans` | Dependency-ordered plan | Section E. Kept in this file (not `docs/superpowers/plans/`) because you asked for one A–G deliverable |
| `verification-before-completion` | No unsupported claims | Every "passes" below has its command and count; nothing is called production-ready |

`ui-ux-pro-max` was available but not used: `impeccable` already carries this project's PRODUCT.md/DESIGN.md context, and using both would mix two design vocabularies. No requested skill was missing.

### Baseline checks run (Verified)

| Check | Command | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 (26 s) |
| Lint | `npm run lint` | exit 0, no findings (50 s; also lints `.worktrees/`, see F24) |
| Unit tests | `npm run test:unit` | **59 files, 489 tests passed** |
| Database tests (fresh DB: bootstrap + 37 migrations, real role switches) | `npm run test:db` | **21 files, 350 tests passed** (37 s) |
| Production build, default folder | `npm run build` | **failed**: `ENOTEMPTY ... .next\sandbox\dev\logs` (F04) |
| Production build, isolated folder | `CVSRS_DIST_DIR=.local/audit-build npx next build` | exit 0 (24 s): 35 pages, 135 route handlers, proxy |
| Database catalog (on the disposable `cvsrs_test`) | SQL in session scratchpad | see B.6 |
| API authorization probes (sandbox, port 3200) | `curl` | see B.5 |
| Browser crawl, 10 personas × desktop/phone, with axe-core | Playwright script in scratchpad | ran (anon 14 pages, family 20, family2 10, assistant 24, nurse 53, lead 73 on desktop); **results not reviewed**, see limits |

### Limits of this audit (Not tested / blocked)

1. **Browser results are not in this report.** Partway through, the permission classifier began refusing browser-pane actions and reads of the crawl's result file (it labelled them "irreversible local destruction"; they were read-only). I did not work around that. The crawl output is at the session scratchpad path `crawl-report.json`; with your permission I can fold its axe, overflow, touch-target and console-error results into Section D. Until then, every UI finding below comes from code reading, the token validator and the earlier documented scans, not fresh screenshots.
2. **No Supabase project exists**, so live sign-up, email confirmation, password recovery, MFA enrollment, PostgREST argument marshalling and session refresh were not tested by anyone (the repo's own docs say the same: `docs/engineering/manual-setup.md` line 3).
3. **Manual accessibility** (keyboard-only, screen reader, 200 % zoom, colour-vision) was not performed.
4. **Dark mode was not audited**, by your 2026-10-02 decision (light theme forced app-wide). Section D.3 covers only what that decision leaves behind.
5. **SMS, email and Redis rate-limit store** were not exercised (no accounts; SMS is off by design).

### Side effects of this audit (for transparency)

- The failed default build deleted most of the running sandbox's compile cache (`.next/sandbox`, 1.9 GB → 12 MB) and the sandbox began answering 500. I stopped the sandbox and shut its database down with `pg_ctl stop -m fast` (clean checkpoint). Your own `npm run dev` on port 3000 was not affected (`.next/dev` intact, still 200). The next `npm run demo` recompiles the cache. The sandbox **database files were not touched**; a byte copy taken before testing is in the session scratchpad (`demo-pgdata-backup`, 74 MB).
- Signing in personas and opening clinical pages appended read-audit rows (`history.view`, `audit.searched`) to the sandbox database. No records were created or edited (the only write probes were rejected: invalid body, missing idempotency key, cross-origin).
- `next build` rewrote `tsconfig.json` and `next-env.d.ts`; both were restored from copies taken immediately before. `graphify` wrote a cache folder into `src/`; it was removed. `git status` shows the same 307 entries as at the start.

---

## A. Readiness verdict

### Capstone testing: **Not ready via `npm run dev`; ready for a guided demo via `npm run demo` once three blockers are fixed**

What is strong (Verified): a real PostgreSQL schema with row-level security on every public table and **no direct table write grants** to API roles; every privileged operation is a `SECURITY DEFINER` command with a pinned `search_path`; the server's RPC allowlist matches the 159 functions the `authenticated` role can execute exactly; CSRF origin checks, idempotency keys, bounded bodies and rate limits are enforced (B.5); 839 automated tests pass; the production build compiles.

Blockers:

| # | Blocker | Finding |
|---|---|---|
| C-1 | All work since 2026-09-30 is uncommitted, has no remote, and CI has never run | F01 |
| C-2 | `npm run dev` gives an app nobody can sign into | F02 |
| C-3 | The sandbox's demo data is polluted by earlier audit runs and cannot be reset | F11 |
| ~~C-4~~ | **Resolved 2026-10-04 (0037):** staff book, move and cancel visits; sessions can be cancelled and resized; past days close and count no-shows | F40, F41, F42 |
| ~~C-5~~ | **Resolved 2026-10-04 (0037):** schedules under review can be sent back; stock counts can be rejected; families are told about access and request decisions | F43, F44, F45 |

Strongly recommended before the panel: F04, F05 (developer workflow breaks), F06 (fake "email sent"), F12 (no visible "fictional data" notice once signed in), and a reviewed browser pass (limit 1).

### Production deployment: **Not ready**

The database and API design are production-grade in intent; the deployment has never existed.

| # | Blocker | Finding |
|---|---|---|
| P-1 | Supabase Auth/MFA/PostgREST path never executed | F03 |
| P-2 | Hosting platform, Redis REST store, worker runtime, certificate secret and public URL not provisioned | F36, decision D-2 |
| P-3 | No migration ledger for upgrading an existing production schema | F16 |
| P-4 | No readiness health check, error reporting or alerting | F14, F37 |
| P-5 | Privacy notice, privacy policy and terms content must come from the clinic's privacy officer | F38 |
| P-6 | Clinical acceptance: real schedules/products approved by clinical leads (the system deliberately ships none) | docs/operations/schedule-import.md |
| P-7 | Manual accessibility and real-device testing | F35 |
| C-1 | Committed, reviewed code with CI evidence | F01 |
| P-8 | Password length and the required name are enforced only by this app's route; Supabase Auth can be called directly with the public key | F49 (second pass) |

---

## B. Application map and coverage matrix

### B.1 Stack (Verified from `package.json`, configs and runtime)

| Area | Detail |
|---|---|
| Framework | Next.js **16.3.7** (App Router, Turbopack), React 19.3, TypeScript 5.9 strict (`noUncheckedIndexedAccess`) |
| Runtime | Node ≥ 22 (`engines`); this machine runs Node 24.16, npm 11.6.3; CI uses Node 22 |
| Database | PostgreSQL. Local: Laragon PG binaries (`.local/pgdata`, port 54329) for dev/tests; `embedded-postgres` 18.4 for the sandbox (`.local/demo-pgdata`, port 54330). Production: Supabase (not provisioned) |
| Auth | Production: Supabase Auth (password + TOTP MFA, PKCE callback). Local: cookie shim selecting seeded `@demo.cvsrs.test` personas, refused in production |
| Styling | Tailwind CSS 4, local fonts (Plus Jakarta Sans for app, Atkinson Hyperlegible Next for landing), Lucide icons, Sonner toasts |
| Documents | `pdf-lib` + `fontkit` certificates, `qrcode` |
| Validation | Zod 4 at the API edge; authoritative checks in SQL |
| Integrations | Redis REST rate store (production), optional SMS provider (none built; sandbox adapter rejected in production), outbox worker (`npm run worker`) |
| CI | `.github/workflows/` (untracked, never run): typecheck, lint, unit, DB tests, build, restore drill on Ubuntu |
| Deployment target | **Unknown** (decision D-2) |

### B.2 Modules

| Path | Responsibility |
|---|---|
| `supabase/migrations/0000–0036` (9,156 lines SQL) | Schema, RLS, capability model, ~160 command functions, audit, outbox |
| `src/lib/api` | `api()` route wrapper: origin check, UUID params, rate limits, idempotency key, bounded JSON, Zod, error envelope |
| `src/lib/db` | RPC allowlist (`port.ts`), Supabase client, local shim |
| `src/lib/auth`, `src/lib/security` | Cookies, redirects, staff entry, password policy, origin, rate limiting |
| `src/lib/server/viewer.ts` | Per-request viewer (`get_my_context`), `requireViewer`, `requireClinicStaff` |
| `src/lib/client/api.ts` | `callApi` / `useMutation` (idempotency key per logical submission) |
| `src/app/**` | 35 pages, 135 route handlers |
| `src/components` | Shared UI (`ui.tsx`), shell, auth frame, brand |
| `scripts/` | Local DB, sandbox launcher/seed, worker, restore drill, perf, matrix, Supabase install builder |
| `tests/unit`, `tests/db`, `tests/demo` | 59 unit files, 21 DB files, 1 sandbox runtime file. **No committed browser tests** |

### B.3 Roles and permission matrix

Capabilities come from `private.role_preset` (`supabase/migrations/0001_foundation.sql:156`) plus per-grant extras. "DB" = enforced and covered by `tests/db`; "API✓" = also probed over HTTP in this session.

| Action | Guardian | Assistant | Nurse (`clinical_staff`) | Clinical lead | Inventory | BHW | Tech admin |
|---|---|---|---|---|---|---|---|
| View own children / verified history | ✓ (verified link only) DB, API✓ | – | – | – | – | – | – |
| Search / register children | – (403 API✓) | ✓ | ✓ | ✓ | – (403 API✓) | – | – |
| Verify guardian relationship | – | ✓ | ✓ | ✓ | – | – | – |
| Book / manage appointments, queue | own child | ✓ | ✓ | ✓ | – | – | – |
| Read clinical history | own child | – | ✓ | ✓ | – | – | – |
| Record vaccination, verify evidence | report outside dose | – | ✓ | ✓ | – | – | – |
| Approve corrections, resolve review cases | – | – | – | ✓ | – | – | – |
| Manage stock / approve adjustments | – | – | – | approve | manage | – (403 API✓) | – |
| Propose / approve schedules | – | – | propose | propose + approve | – | – | config |
| Issue / revoke certificates | download own | – | – | ✓ | – | – | – |
| Run reports / export identifiable | – (403 API✓) | – | – | ✓ | – | – | – |
| Read audit log | – (403 API✓) | – | – | ✓ | – | – | – |
| Follow-up worklist | – | – | via clinical read | ✓ | – | ✓ | – |
| Request / approve staff access | apply | – | – | clinical grants | – | – | ✓ (second person must approve) |
| Clinic settings, care content | – | – | – | content review | – | – | ✓ |
| Public: landing, sign-in/up, queue display, certificate check | ✓ anonymous | | | | | | |

Cross-clinic isolation: a lead of clinic A calling clinic B's endpoints → 403 (API✓). Cross-family: family → other family's child schedule/history/QR → 404 (API✓).

### B.4 Critical workflows and status

| # | Workflow | DB layer | API | Browser UI | Live (Supabase) |
|---|---|---|---|---|---|
| W1 | Family sign-up | trigger tested | sandbox code read | crawl only | **Not tested** |
| W2 | Sign-in / sign-out | – | sandbox sign-in for 10 personas ✓; `GET /auth/sign-out` → 405 ✓ | crawl only | **Not tested** |
| W3 | Password recovery | – | – | defect F06 (code) | **Not tested** |
| W4 | Staff MFA | `mfa_ok()` tested | – | simulated in sandbox | **Not tested** |
| W5 | Staff application → accept → second approval | `staff-applications.test.ts` ✓ | – | not exercised | Not tested |
| W6 | Add child / link request → staff verification | `registry.test.ts` ✓ | link isolation ✓ | crawl only | Not tested |
| W7 | Book / reschedule / cancel visit | `visits.test.ts` ✓ | – | not exercised | Not tested |
| W8 | Arrival queue, call next, public display | `visits.test.ts` ✓ | display is ticket-only (code) | not exercised | Not tested |
| W9 | Record vaccination, exceptions, corrections | `administration.test.ts` ✓ | – | not exercised | Not tested |
| W10 | Stock receive/transfer/wastage/cold chain | `inventory`, `transfers` ✓ | bhw → stock 403 ✓ | not exercised | Not tested |
| W11 | Certificate issue → PDF → public verify | `certificates.test.ts` ✓ | bogus token → 404 ✓ | not exercised | Not tested |
| W12 | Reports and CSV export | `reports.test.ts` ✓ | family export → 403 ✓ | not exercised | Not tested |
| W13 | Messages via outbox worker | `sms-dispatch.test.ts` ✓ | – | not exercised | Not tested |
| W14 | Record transfer between clinics | `record-transfer.test.ts` ✓ | – | not exercised | Not tested |
| W15 | Schedule import → approve → activate | `schedule.test.ts` ✓ | – | not exercised (historically checked, L15) | Not tested |
| W16 | Audit search, settings, care content | `config.test.ts` ✓ | – | not exercised | Not tested |
| W17 | Follow-up worklist | `followup.test.ts` ✓ | – | not exercised | Not tested |

Overall: business rules are **verified at the database layer**; HTTP authorization **partially verified**; browser flows **not verified in this session**.

### B.5 API probes (Verified, sandbox on port 3200)

| Probe | Result |
|---|---|
| `GET /api/v1/me` signed out | 401 |
| Family → clinic children search / audit / report export | 403 / 403 / 403 |
| Inventory clerk → children search; BHW → stock | 403 / 403 |
| Clinic A lead → clinic B (unknown UUID) | 403 |
| Family → another family's child schedule / history / QR | 404 / 404 / 404 |
| Cross-origin `POST` (`Origin: https://evil.example`) | 403 |
| `POST` without `Idempotency-Key` | 400 with clear message |
| Invalid JSON fields | 422 with per-field messages |
| 2.1 MB body | 413 |
| Non-UUID route parameter | 404 |
| `GET /auth/sign-out` | 405 (POST only) |
| `GET /api/v1/health` with no usable accounts | 200 `ok` (F14) |
| `npm run dev` sign-in (port 3000) | 403 "Demo persona selection is disabled." (F02) |

### B.6 Database catalog (Verified on the disposable `cvsrs_test`)

| Check | Result |
|---|---|
| Public tables without RLS | **0** |
| Public tables with RLS and no policy (default deny; access only through commands) | 52 (intended design) |
| INSERT/UPDATE/DELETE grants to `anon`/`authenticated` | **0** |
| `SECURITY DEFINER` functions without pinned `search_path` | **0** |
| Functions executable by `anon` | 3: `list_public_clinics`, `public_queue_display`, `verify_certificate` |
| RPC allowlist vs executable functions | 159 = 159, none missing, none extra |
| `timestamp without time zone` columns | 0 |
| Tables without primary key | 0 |
| `ON DELETE CASCADE` foreign keys | 0 |
| Foreign-key columns without a leading index | 177 (mostly `created_by`/`updated_by`; see F15) |

### B.7 Second pass: whole-system wiring and lifecycle coverage (Verified)

Method: the final definition of every function was read out of the freshly migrated `cvsrs_test` database (274 functions in `public`/`private`; this avoids reading superseded versions across 37 migrations). Every API route (130), every page (35), every client API reference (97), every internal link and redirect, and every status `CHECK` constraint (51) were then cross-referenced by script. Each automated hit was confirmed by reading the code before it became a finding.

| Check | Result |
|---|---|
| Allow-listed commands never called by the app | `acknowledge_privacy_notice`, `record_report_export` (both superseded; F55). `list_child_guardian_contacts` is called (scanner false positive) |
| App calls to commands that are not allow-listed | none |
| Client API paths with no route | none after manual check (two hits were prefixes completed at runtime) |
| Internal links or redirects to pages that do not exist | none |
| Write endpoints with no screen | `POST /clinics/:id/sessions/:sessionId/cancel` (F42). Staff use of `POST /appointments`, `/appointments/:id/cancel`, `/appointments/:id/reschedule` (F41) |
| Read endpoints with no screen | about 25 `GET` routes (pages read through server components instead). They are a usable JSON API, not dead code |
| Layered SQL wrappers (`*_prev`, `*_base`) | 10 (F57). None is executable by API roles |

Status lifecycle map (which command moves a record into each state). "Never set" means no function in the final schema writes that value.

| Entity | States never set | Consequence | Finding |
|---|---|---|---|
| `appointments` | `no_show` | Past bookings stay `confirmed` forever; the daily-activity report's "no-show" column is always 0 | F40 |
| `clinic_sessions` | `closed` | Past sessions stay `open` | F40 |
| `encounters` | `cancelled` | A visit left `in_service` at closing time stays `open` forever, blocks record transfer and merge for that child ("a visit is in progress"), and can receive a later day's vaccination | F40 |
| `queue_entries` | (all reachable) but nothing closes past days | Unfinished tickets vanish from the board without an outcome | F40 |
| `schedule_versions` | no exit from `clinical_review` except approval | A wrong submission is stuck permanently | F43 |
| `record_review_cases` (stock count) | no rejection in the UI | A disputed count can only be approved or left open | F44 |
| `children` | `inactive` | A child who moved away or died cannot be marked; they stay on follow-up lists | F50 |
| `guardians.contact_status` | `invalid` | A wrong phone number cannot be flagged | F50 |
| `stock_locations` | `closed` | A retired fridge cannot be closed | F50 |
| `profiles` | `suspended`, `deactivated` | No way to deactivate an account | F47, F50 |
| `staff_memberships` | `suspended`, `rejected` | Leave or role change means revoke and re-request (pending requests are declined through revoke, which works) | F51 |
| `checkins` | `closed` | Answered questions never close | F58 |
| `record_attachments` | table never written | Evidence uploads not built (known, L19) | – |

---

## C. Prioritized findings

Severity: **Critical** (data loss or security), **High** (blocks capstone or production), **Medium** (wrong behaviour or misleading UI with a workaround), **Low** (quality, maintainability, polish).

### Phase-1 class: security, data integrity, runtime blockers

**F01 · Critical · Confidence high · Defect (confirmed)**: the current system exists only as uncommitted files
- Evidence: `git status` → 145 modified files (+8,820/−1,781) and 162 untracked entries, including migrations `0025`–`0036`, `src/app/auth/callback`, password recovery pages, staff applications, the sandbox launcher, `/api/v1/health` and 50+ test files. Last commit 2026-09-30 09:29. `git remote -v` is empty. A second worktree (`.worktrees/loop-security-rate-limit-20261001`) holds 213 more uncommitted changes. CI (`.github/workflows`) is itself untracked and has never run.
- Expected: reviewed commits pushed to a private remote, CI green. Actual: one disk failure or mistaken `git checkout .` loses roughly a week of work, including schema migrations that a database may already depend on.
- Root cause: work proceeded through many agent sessions told not to commit.
- Fix: Task 1.1.
- Acceptance: `git status` clean except ignored files; `git log` shows logical commits; a private remote exists; one CI run is green; the worktree is merged, committed on its branch, or deliberately discarded by you.

**F02 · High · Confidence high · Defect (confirmed)**: `npm run dev` produces an app nobody can sign into
- Evidence: `.env.local` sets only `CVSRS_LOCAL_DB_URL` → `cvsrs_dev` on port 54329. Read-only query: `demo_mode=false`, **0 users, 0 staff memberships**, 1 clinic. `POST /auth/sign-in` on port 3000 → 403 "Demo persona selection is disabled." Sign-up shows "This copy of eVacTrack cannot create accounts" (`src/app/sign-up/availability.tsx`).
- Root cause: local mode has exactly two identity sources, demo personas (require `demo_mode=true`) and Supabase (not configured). `npm run dev` gets neither. Only `npm run demo` seeds personas.
- Fix: Task 1.2 after decision D-1.
- Acceptance: from a clean clone, `npm install && npm run dev` reaches a sign-in that works for every role, with no manual database steps.

**F03 · High · Confidence high · Not tested (blocked)**: the production authentication path has never run
- Evidence: `docs/engineering/manual-setup.md:3` "no Supabase project has ever received these steps"; `docs/implementation/known-limitations.md` L1. Code paths: `src/app/auth/*`, `src/app/account/*`, `src/lib/db/supabase.ts`, `src/proxy.ts`.
- Impact: sign-up confirmation, recovery, MFA enrollment/verification, RPC named-argument marshalling via PostgREST, header GUCs (`request.jwt.claims`), cookie chunking and session refresh are all unproven.
- Fix: Task 2.1 (staging project + scripted smoke test).
- Acceptance: on staging, each of W1–W4 completes in a browser with real email; every role reaches its landing page with `aal2`; one RPC per module returns data.

**F04 · Medium · Confidence high · Defect (confirmed)**: `npm run build` breaks a running sandbox and fails
- Evidence: `npm run build` → `Error: ENOTEMPTY: directory not empty, rmdir '.next\sandbox\dev\logs'`; afterwards `.next/sandbox` shrank from 1.9 GB to 12 MB and the sandbox answered 500.
- Root cause: `scripts/demo.ts:96` sets `CVSRS_DIST_DIR: ".next/sandbox"`, a folder **inside** the default build folder that `next build` empties. Leftover `.next/audit-launch` shows the same pattern from an earlier session; `tsconfig.json` still includes both paths.
- Fix: Task 1.3. Acceptance: with the sandbox running on 3200, `npm run build` exits 0 and the sandbox keeps answering 200.

**F05 · Medium · Confidence high · Defect (confirmed)**: stopping the sandbox launcher abruptly orphans its database
- Evidence: after the launcher was terminated (not Ctrl+C), PostgreSQL kept listening on 54330 and `.local/demo.lock` remained; `demo-postgres.log` also shows crash recovery at 09:54 from an earlier unclean stop. `requireFreePort(54330)` (`scripts/demo.ts:21`) then refuses the next launch.
- Root cause: shutdown runs only on SIGINT/SIGTERM handlers; Windows console close, `taskkill` and IDE stop buttons bypass them, and the launcher never checks for its own orphaned cluster.
- Fix: Task 1.3. Acceptance: kill the launcher with `taskkill /f`; the next `npm run demo` detects the cluster by its data directory, stops it with `pg_ctl stop -m fast`, and starts normally.

**F06 · Medium · Confidence high · Defect (confirmed by code)**: password recovery reports success when nothing is sent
- Evidence: `src/app/account/forgot-password/recovery-request-form.tsx:18-26`: without `NEXT_PUBLIC_SUPABASE_URL` it skips the request and still shows "a password reset link will arrive shortly". The page is linked from the sign-in form whenever it is not in sandbox mode (including the `npm run dev` state of F02). `reset-password/page.tsx:10` already handles local mode correctly.
- Impact: fake success, which you asked to remove.
- Fix: Task 2.3. Acceptance: in local modes the page explains that password reset needs the sign-in service and offers the right next step; in Supabase mode the enumeration-safe message stays.

**F07 · Medium · Confidence high · Defect (confirmed)**: sign-in in an unconfigured local copy shows a password form and a demo-specific error
- Evidence: `src/app/sign-in/page.tsx` passes only `sandbox` (true/false); the third state ("unavailable") renders the full password form; submitting returns "Demo persona selection is disabled." (observed on port 3000).
- Fix: Task 2.3 (reuse `signUpMode()`; show an "unavailable" panel like sign-up). Acceptance: the three modes each show one consistent, truthful message on sign-in, sign-up and recovery.

**F08 · Medium · Confidence medium · Risk (suspected)**: confirmation emails may link to an internal origin behind a proxy
- Evidence: `src/app/auth/sign-up/route.ts` builds `emailRedirectTo` from `new URL(req.url).origin`, while `/auth/callback` rejects any origin other than `CVSRS_PUBLIC_URL` in production (`src/app/auth/callback/route.ts:20`). If the platform presents an internal host to Next, links break (or Supabase falls back to its Site URL).
- Fix: Task 2.1: in production use `canonicalPublicUrl(process.env.CVSRS_PUBLIC_URL)`. Acceptance: staging confirmation email link host equals `CVSRS_PUBLIC_URL`.

### Phase-2 class: authentication, permissions, critical flows

**F09 · Medium · Confidence high (code) · Defect (confirmed by code), runtime reproduction pending**: people with two roles at one clinic get one role's workspace
- Evidence: `get_my_context` returns one entry per membership with that role's capabilities (`supabase/migrations/0029_clinic_timezones.sql:8-13`). `requireClinicStaff` takes the first match (`src/lib/server/viewer.ts:63`), and `ClinicLayout` builds navigation from it (`src/app/clinic/[clinicId]/layout.tsx:10`). `/clinic` lists each membership row, so the same clinic appears twice (`src/app/clinic/page.tsx:41`). The database authorizes on the union, so the UI under-shows rather than over-grants.
- Fix: Task 2.2: `clinicAccess(ctx, clinicId)` returning the union of active capabilities and all role labels; `/clinic` groups by clinic. Acceptance: fixture with `assistant` + `inventory` at one clinic shows both navigation sets and one clinic row; unit test.

**F10 · Low · Confidence high · Defect (confirmed)**: HTTP status codes do not match page outcomes
- Evidence: a family opening another family's child page → 200 with "This page is unavailable to your account"; `/children/not-a-uuid` → 200; signed-out `/children` → 200 followed by a client-side redirect (streaming through `children/loading.tsx` starts before `redirect()`).
- Fix: Task 2.4: `notFound()` for invisible records; authenticate in the segment layout before any Suspense boundary. Acceptance: those three requests return 404, 404 and 307 to `/sign-in` with `curl`.

**F11 · High (capstone) · Confidence high · Defect (confirmed)**: the sandbox cannot be reset and is polluted by earlier audits
- Evidence: the family persona's children include "Fictional Audit estimated Child" (CV-000015) and similar audit leftovers (`GET /api/v1/children`). README: "The launcher never resets the database"; the only reset is deleting `.local/demo-pgdata` by hand.
- Fix: Task 2.5: `npm run demo -- --reset` (typed confirmation; refuses unless the target is the launcher's own data directory) plus a curated seed that tells the walkthrough story. Acceptance: after reset, each persona sees exactly the documented seed.

**F12 · Medium · Confidence high · Defect (confirmed by code)**: signed-in sandbox pages carry no "fictional data" notice
- Evidence: `src/app/layout.tsx:122` renders the demo notice inside `{false ? … : null}`. DESIGN.md: "Keep fictional sandbox notices visible." Personas, schedules and products are invented and "not for clinical use".
- Fix: Task 2.5: show a one-line notice when `ctx.demoMode` (already returned by `get_my_context`). Acceptance: every signed-in sandbox page shows it; Supabase mode never does.

**F13 · Low · Confidence high · Defect (confirmed)**: first-administrator setup is documented in the wrong place
- Evidence: README sends readers to `docs/operations/deployment.md`; the actual secure procedure (`private.bootstrap_initial_staff`, database-owner only, two people approving each other, audited) is in `docs/engineering/manual-setup.md:80-98`.
- Fix: Task 6.4 (docs). This is the recommended initial-admin approach; no public or hard-coded credentials exist and none should be added.

### Phase-3 class: backend, APIs, database reliability

**F14 · Medium · Confidence high · Defect (confirmed)**: health check always says "ok"
- Evidence: `src/app/api/v1/health/route.ts` returns static JSON; observed 200 while nobody could sign in (F02).
- Fix: Task 3.1: keep `/api/v1/health` as liveness; add `/api/v1/health/ready` that validates configuration and runs one cheap database call with a 2 s timeout, answering 503 without detail when either fails. Acceptance: stopping the database makes `ready` return 503 within 3 s; liveness stays 200.

**F15 · Low · Confidence medium · Risk (suspected)**: guardian lookups by account scan the table
- Evidence: `guardians` has only `(organization_id, profile_id)` unique; `private.my_guardian_ids()` and several commands filter by `profile_id` alone (`0003_registry.sql:236`, `0020_sms_preferences.sql:94,103`, `0024_config_content_audit_ops.sql:202`). These run on every family page. 177 foreign-key columns lack a leading index, mostly audit columns where no index is needed.
- Fix: Task 3.2: migration `0037` with `create index guardians_profile_idx on public.guardians (profile_id) where deleted_at is null;` after `EXPLAIN` on the 20,000-child perf database (`npm run perf`). Do not blanket-index audit columns. Acceptance: `my_children` plan shows an index scan on `guardians`; perf p95 recorded before and after.

**F16 · High (production) · Confidence high · Defect (confirmed)**: no migration ledger outside the sandbox
- Evidence: only the sandbox records applied migrations with checksums (`scripts/demo-runtime.ts:84-102`). `db:setup`/`db:reset` re-apply everything to empty databases; Supabase instructions are "apply in order" or paste `supabase/install/fresh-install.sql`. There is no supported way to upgrade an existing database from, say, `0030` to `0036`, or to detect an edited migration.
- Fix: Task 3.3: one `npm run db:migrate -- --url …` that reuses the sandbox ledger logic for any target (or adopt Supabase CLI migrations; filenames are already compatible). Never edit applied migrations. Acceptance: upgrading a copy of a `0030` database reaches `0036` and the DB test suite passes against it; an edited file is refused.

**F17 · Low · Confidence high · Defect (confirmed)**: local disk bloat
- Evidence: `.next` 8.0 GB, `.local` 3.9 GB (`pgdata` 2.3 GB with 25 leftover `cvsrs_audit_*` databases plus `cvsrs_perf`, `cvsrs_drill_restore`), about 40 `.local/*.cjs` audit scripts and many `demo-test-*` folders.
- Fix: Task 4.3 (user-run cleanup with a dry-run listing). Acceptance: documented commands; disk use reported before and after.

**F18 · Low · Confidence high · Defect (confirmed by code)**: the Today board refreshes and announces every 15 seconds
- Evidence: `src/app/clinic/[clinicId]/today/board.tsx:42` calls `router.refresh()` every 15 s even in hidden tabs; the "Data loaded …" pill has `role="status"`, so screen readers announce it on every refresh.
- Fix: Task 3.4: pause while `document.hidden`, refresh on `visibilitychange`; take the timestamp out of the live region and announce only queue changes. Acceptance: a hidden tab makes no requests (network log); NVDA announces no timestamp churn.

**F19 · Low · Confidence high**: UI logic depends on SQL error wording
- Evidence: `familyVisitError` matches `/already has an appointment in this session/` (`src/app/children/[childId]/visits.tsx:65`).
- Fix: Task 3.4: raise with a stable hint (as `cvsrs:operation_key_reused` already does, `src/lib/api/errors.ts:58`) and map the hint. Acceptance: unit test on the hint; changing the SQL message text does not change the UI.

**F20 · Low · Confidence high**: local shim makes two extra queries per RPC
- Evidence: `createLocalClient().rpc` calls `this.session()` (demo check + user lookup) on every call (`src/lib/db/local.ts:40`). Development only.
- Fix: memoize the session per client (Task 3.4).

### Phase-4 class: architecture, code quality, repository cleanup

The architecture is not spaghetti. Server components read through one allow-listed command surface; client components mutate through one `useMutation` hook with idempotency; authorization lives in SQL. The graph shows no import cycles. Remaining issues are dead code, clutter and a few oversized files.

**F21 · Medium · Confidence high**: dead code and dependencies kept alive only by it

| Item | Evidence of non-use | Replacement |
|---|---|---|
| `src/components/interactive-constellation.tsx` (213 lines, canvas animation) | no importer in `src/`, `tests/`, `scripts/` | none |
| `src/components/ui/button.tsx` (shadcn) and `src/lib/utils.ts` | no importer | `Button` in `src/components/ui.tsx` |
| deps `@base-ui/react`, `class-variance-authority`, `cn` | only imported by the two files above | none |
| `ThemeToggle`, `ThemeChoice` in `theme-provider.tsx` | no usage outside the file | none (light only) |
| `.dark` token blocks in `globals.css` (about 70 lines) and 12 `dark:` utilities in 3 files | theme forced light (`layout.tsx:115`) | none |
| `src/app/children/[childId]/download-button.tsx` | re-export used only by `tests/unit/family-controls.test.ts` | point the test at `@/components/download-button` |
| `{false ? <aside…> : null}` in `layout.tsx` | constant-false branch | F12's real notice |

Check before removing: `shadcn` (a CLI package in `dependencies`) is imported only for `shadcn/tailwind.css` (accordion keyframes and `data-open` variants), and `tw-animate-css` has a single `animate-in fade-in slide-in-from-top` use; confirm both with a build and a visual check, then move `shadcn` to `devDependencies` or drop it. `@supabase/supabase-js` has no direct import but is a peer of `@supabase/ssr`: keep it. `next-themes` can go once the theme is applied statically (`class="light"` is already on `<html>`).

**F22 · Medium · Confidence high**: a 16.4 MB font is never used
- Evidence: `src/lib/certificates/fonts/NotoSansCJKsc-Regular.otf` is referenced nowhere; `pdf.ts:21` and `next.config.ts:5` use `NotoSansSC.ttf` (10.6 MB). Removing it before the first commit keeps it out of git history.

**F23 · Low · Confidence high**: repository clutter and stale documents
- Root: `LOOP.md`, `STATE.md`, `gate.yaml`, `loop-budget.md`, `loop-constraints.md`, `loop-ledger.json`, `loop-run-log.md`, `patterns/`, `.codex/`, `.audit-generate-0026.py` (a one-off script that appended SQL to migration `0026`; the migration must stay, the script can go).
- Docs: 22 files in `docs/audit`, 14 in `docs/engineering`, two deployment guides (`docs/deployment.md`, `docs/operations/deployment.md`), `docs/implementation/status.md` dated 2026-10-01 still saying nothing was committed.
- Fix: Task 4.2: keep README, PRODUCT.md, DESIGN.md, one `docs/status.md`, one deployment guide, the runbook, schedule-import, training, decisions, the specification and this audit; move the rest to `docs/archive/2026-09/` (history preserved). Decide whether the loop automation stays (it is your tooling; I have not judged it).

**F24 · Low · Confidence high**: tooling configuration drift
- `tsconfig.json` includes `.next/audit-launch/**` and `.next/sandbox/**` type paths; ESLint has no ignore for `.worktrees/**` and lints a second copy of the app; `scripts/db.ts:15` defaults `PG_BIN` to `C:/laragon/...`, so `npm run test:db` fails on any other Windows machine without that path.
- Fix: Task 1.3/4.3. Acceptance: lint time drops and lints only this tree; `test:db` prints a clear message naming `PG_BIN` when binaries are missing (or falls back to `embedded-postgres` binaries, which are already installed).

**F25 · Low · Confidence high**: a few oversized components
- `review/cases.tsx` 650 lines with 14 case kinds; `inventory/forms.tsx` 462; `today/board.tsx` 421; landing `page.tsx` 674 and `landing.css` 2,489.
- Fix: Task 4.4: split `cases.tsx` into `review/cases/<kind>.tsx` with a `CaseCard` switch, and inventory forms one per file. No behaviour change; existing unit tests (`staff-ui-review-cases.test.ts`, `inventory-controls.test.ts`) must pass unchanged.

**F26 · Medium · Confidence high**: no committed browser tests
- Evidence: no Playwright or Cypress dependency; earlier browser scripts live in ignored `.local/*.cjs` and load Playwright from an `npx` cache path.
- Fix: Task 6.2.

### Phase-5 class: UI, UX, accessibility, consistency

(Design table in Section D.)

**F27 · Medium**: sign-in and sign-up primary buttons are hand-styled (`rounded-xl`, `py-3`, `shadow-md`) instead of the shared 6 px `Button` (`src/app/sign-in/sign-in-form.tsx:168`, `src/app/sign-up/sign-up-form.tsx:295`).
**F28 · Low**: the shared footer hard-codes landing hex colours on every page (`src/components/site-footer.tsx:10-79`, 9 values).
**F29 · Medium**: the "Clinic access paused" banner uses raw `amber-500/950`, `role="alert"` on a persistent banner (re-announced on every navigation), and links to `/account/security` without a return path (`src/app/layout.tsx:134`).
**F30 · Medium**: mixed Title Case and sentence case in family UI ("Vaccination Schedule & History", "Verification Required for Clinical History", "Register a New Child Record", "Estimated Birth Date"); status chips fall back to raw database values (`src/components/ui.tsx:236-240`).
**F31 · Medium**: 12 px text for hints, field errors, chips and the "verification required" notice (`text-xs`, 29 uses), against PRODUCT.md's readability commitment for guardians on phones.
**F32 · Low**: inputs show two focus indicators at once (global 3 px `:focus-visible` outline plus the control's ring and shadow, `src/components/ui.tsx:117`).
**F33 · Low**: `robots.ts` allows `/` while the root metadata sets `noindex` on every page, including the landing page. Decide which one is intended.
**F34 · Low**: motion details (Section D.4).
**F35 · High (production) · Not tested**: no manual accessibility testing; this session's axe results are unread (limit 1). Automated scans never establish WCAG 2.2 AA conformance on their own.

### Phase-6 class: performance, regression, setup, deployment

**F36 · High (production)**: infrastructure not provisioned: Supabase project, Redis REST store (production refuses protected requests without it), trusted client-IP header or explicit shared-bucket opt-in, `CVSRS_PUBLIC_URL`, certificate render secret in both runtime and database, a separate worker runtime with its least-privilege login, hosting platform (D-2).
**F37 · High (production)**: no error reporting, metrics or alerting. Logs are console lines (some structured JSON, for example `api_denied`). Worker lag, outbox failures and certificate render failures would go unnoticed.
**F38 · High (production)**: no privacy policy, terms or accessibility statement pages, and the per-clinic privacy notice ships empty by design (PRODUCT.md; L11). The content must come from the clinic's privacy officer; this audit makes no legal judgement.
**F39 · Medium**: CI exists but has never run (no remote).

### Implementation status of F40–F50 (2026-10-04, same day)

Implemented in `supabase/migrations/0037_operational_gaps.sql` plus the screens and routes listed below. Verified by `npm run test:all` (typecheck, lint, 496 unit tests, 366 database tests on a freshly migrated database, matrix check: all passing), a production build (`CVSRS_DIST_DIR=.local/audit-build npx next build`, exit 0), and browser checks in the sandbox (port 3200) with the database state read back afterwards.

| Finding | Status | What changed | Evidence |
|---|---|---|---|
| F40 day closure | **Fixed** | `close_service_day`, `service_day_backlog`, worker `run_daily_maintenance` (at most every 10 min); vaccinations refused on an earlier day's visit; Today shows unfinished and recently closed days | `tests/db/operational-gaps.test.ts` (closure, idempotency, report no-show count, worker role); in the sandbox the worker closed 4 earlier days on start, including one real no-show |
| F41 staff bookings | **Fixed** | "Visits" section on the clinic child page (book, change time, cancel) using the existing commands; `list_child_appointments` | DB test (`assisted` channel, family message); browser: assistant booked a child for 7 Oct → appointment `assisted`, outbox job `done`, family inbox "Visit booked", other family unaffected |
| F42 sessions | **Fixed** | Today: "Who is booked" (`list_session_roster`), "Change places" (`update_session_capacity`, never below bookings, version-checked), "Cancel session" with a confirmation naming how many families are told. Cancelling a session now also cancels its bookings (families had been told, but the app still showed "Booked") | DB tests; two existing tests updated to the new contract; browser roster check |
| F43 schedule review | **Fixed** | `return_schedule_to_draft`; "Send back to draft" (reviewer) / "Withdraw from review" (proposer) | DB test incl. permissions and audit action |
| F44 stock count | **Fixed** | `reject_stock_adjustment`; "Approve and post" now asks for confirmation; "Reject the count" with a reason | DB test; browser: lead rejected a fictional count → case `rejected` with reason, stock unchanged |
| F45 family messages | **Fixed** | Triggers queue messages for access verified / paused / restored / ended, declined link request, reviewed edit request, verified / not verified reported vaccine | DB tests incl. retry de-duplication |
| F46 reminders | **Fixed** | Day-before visit reminder; weekly due-or-overdue reminder, each child checked once a day in bounded batches | DB tests |
| F47 account | **Partly fixed** | New `/account` page: name and language (`update_my_profile`), password change on Supabase (needs "Secure password change" on), links to two-step sign-in and phone settings; header link "Account". **Not built:** email change (needs another allowlisted Auth redirect; guidance tells people to ask the clinic) and self-service closure (guidance only: the clinic closes accounts; `private.set_profile_status` is the operator command) | DB tests; browser: language saved and persisted after reload |
| F48 sign-up phone | **Fixed** | Phone and language from sign-up are stored (validated) and become the guardian's unverified contact | DB test |
| F49 sign-up bypass | **Fixed in code, config owed** | Nameless accounts get the email's local part and are asked for a name (banner + `/account`); comment corrected; `manual-setup.md` now lists 12+ minimum, leaked-password protection and secure password change as release gates. (Correction to the audit: the Admin console already flagged unconfirmed applicants.) | DB test; the Supabase settings themselves can only be checked on a real project |
| F50 end states | **Fixed** | `set_child_record_status` (inactive: moved / deceased / other; no messages, bookings or follow-up), `mark_guardian_contact_invalid` ("The number does not work"), `close_stock_location` (inventory "Close…"), operator `private.set_profile_status` | DB tests; inventory page renders the control |

Also added: index `guardians(profile_id)` (F15), a "waiting-room display" link on Today (F54), readable "Inactive record" chip. Not done in this pass: F51–F53, F55–F58 and the Phase 1/4/5/6 tasks (including committing the work, F01).

### Second-pass findings: missing implementation and logical gaps (F40–F58)

Each solution names the exact command, route and screen to add. New SQL always goes in a **new** migration (`0037_…` onward); applied migrations are never edited. Every new command follows the existing pattern: `p_operation_key` idempotency via `private.begin_command`/`finish_command`, a capability check, `private.audit(...)`, `CV4xx` errors, `revoke all … grant execute … to authenticated`, and an entry in `RPC_ALLOWLIST`.

**F40 · High · Confidence high · Defect (confirmed by code)**: a service day never closes
- Evidence: `appointments.no_show` and `clinic_sessions.closed` are never set (B.7). `queue_transition` only closes an encounter on `completed`/`deferred`; `list_queue` and `list_appointments` default to today, so yesterday's unfinished tickets disappear from the board. `get_open_encounter` returns the newest `open` encounter with no date check, and `record_administration` checks only `enc.status = 'open'`, not the service date. `accept_record_transfer` and `merge_children` refuse while any encounter is `open`. `report_daily_activity` counts `no_show`, which is always 0.
- Expected: at day end every ticket, visit, booking and session reaches a final state, and staff see what was left unfinished. Actual: they stay open indefinitely.
- Solution:
  1. Migration: `public.close_service_day(p_operation_key uuid, p_clinic_id uuid, p_service_date date) returns jsonb`, requiring `queue.manage` and refusing `p_service_date >= private.local_today(p_clinic_id)`. In one transaction:
     - queue entries `waiting`/`called`/`held` → `left` with reason "Day closed";
     - `in_service` entries with recorded administrations → `completed`, encounter outcome `vaccinated`;
     - `in_service` entries without administrations → `left`, encounter `cancelled`, `ended_at = now()`;
     - appointments still `confirmed` or `checked_in` → `no_show`;
     - sessions → `closed`.
     It returns counts per transition and writes one `day.closed` audit row plus a `queue_event` per ticket.
  2. `private.auto_close_service_days()`: for each active clinic, closes every unclosed date before local today. Call it from `scripts/worker.ts` once per run (it is idempotent through a dedupe key per clinic and date).
  3. Guard: `record_administration` raises `CV409 'this visit belongs to an earlier day; record it as care already given'` when `enc.service_date <> private.local_today(p_clinic_id)`. The late-entry path (`record_outside_dose_staff`) already exists.
  4. UI: on Today, an "Unfinished from earlier days" notice listing auto-closed visits, with links to each child, shown for 7 days.
- Tests (`tests/db/visits.test.ts`): each transition above; idempotent re-run; vaccination against yesterday's encounter → `CV409`; record transfer succeeds after the day closes; `report_daily_activity` shows `noShow` = 1 for a missed booking.

**F41 · High · Confidence high · Defect (confirmed by code)**: staff cannot book, move or cancel a visit for a family
- Evidence: `private.can_book_for` returns `'assisted'` for staff with `appointment.manage`; `book_appointment`, `cancel_appointment` and `reschedule_appointment` all accept it. The Today page even renders "booked by staff". But no clinic screen calls these routes (only `src/app/children/[childId]/visits.tsx`, the family page). Families without a phone, the paper path and phone bookings (PRODUCT.md principle 3) are unsupported.
- Solution (UI only, no SQL): a "Visits" section on the clinic child page (`src/app/clinic/[clinicId]/children/[childId]/visits.tsx`). It lists the child's upcoming appointments (`list_appointments` per date, or a new read `list_child_appointments(p_clinic_id, p_child_id)` if per-date reads prove slow), books from `list_sessions`, and moves or cancels through the existing routes. It reuses `BookVisit`'s idempotent mutation and notice pattern, so the family receives the existing confirmation and cancellation messages automatically.
- Tests: a unit test for the component's states; a DB test that an assistant's booking has `channel = 'assisted'` and enqueues `appointment.confirmation`; an E2E test that an assistant books and the family then sees the visit on their page.

**F42 · Medium · Confidence high · Defect (confirmed by code)**: sessions cannot be cancelled, resized or inspected
- Evidence: no screen calls `POST /api/v1/clinics/:id/sessions/:sessionId/cancel`, although `cancel_session` is complete (it notifies booked families and opens review cases). Sessions show only counts; staff cannot see who booked tomorrow. There is no command to change capacity.
- Solution:
  - each session row on Today gets "Who is booked" (expands `list_appointments(p_date)` for that session) and "Cancel session", which opens a reason field and a confirmation naming the number of families who will be told;
  - a new `update_session_capacity(p_operation_key, p_clinic_id, p_session_id, p_expected_version, p_online int, p_walkin int, p_total int)` that refuses to go below current bookings.
- Tests: cancel → each booked appointment `cancelled` and one message per family; capacity below bookings → `CV409`.

**F43 · Medium · Confidence high · Defect (confirmed by code)**: a schedule under review can never be rejected
- Evidence: `approve_schedule` accepts only `clinical_review` and has no reject branch; `discard_schedule_draft` accepts only `draft`; `retire_schedule` accepts only `approved`/`active`.
- Solution: `return_schedule_to_draft(p_operation_key, p_clinic_id, p_version_id, p_reason text)`, allowed for `rules.approve` (a reviewer sending it back) or for the proposer (withdrawing). It sets `status = 'draft'`, stores the reason in the version's review note, and audits `schedule.returned`. Schedule page: "Send back to draft" for reviewers, "Withdraw" for the proposer.
- Tests: reviewer returns → draft, then discard works; another lead cannot approve after the return; reason under 3 characters → `CV422`.

**F44 · Medium · Confidence high · Defect (confirmed by code)**: a disputed stock count cannot be rejected, and approval posts in one click
- Evidence: `StockCountCase` (`src/app/clinic/[clinicId]/review/cases.tsx:432`) offers only "Approve and post the adjustment", with no confirmation step. `resolve_review_case` would need `review.resolve`, a clinical capability, not `inventory.approve`.
- Solution: `reject_stock_adjustment(p_operation_key, p_clinic_id, p_case_id, p_reason)` requiring `inventory.approve`, a different person from the proposer, and a reason; it sets the case `rejected` with no ledger movement. UI: "Reject count" with a reason; "Approve and post" uses the existing `confirm-step` pattern showing the signed difference.
- Tests: rejection writes no `stock_movements` row; the proposer cannot reject their own count.

**F45 · Medium · Confidence high · Defect (confirmed by code)**: families are not told about decisions that change what they can see
- Evidence: `notify_guardians` is called only from the outbox handler; the job types handled are appointment, vaccination, certificate, catch-up and record transfer. `verify_relationship`, `resolve_link_case`, `set_relationship_status`, the identity-edit resolution and `verify_outside_dose` enqueue nothing.
- Solution: enqueue jobs `relationship.verified`, `relationship.status_changed`, `link_request.resolved`, `edit_request.resolved` and `reported_dose.resolved` from those commands. Add branches to `private.handle_outbox_job`. Add `private.notify_profile(p_org, p_profile, p_kind, p_title, p_body, p_dedupe)` for people who are not yet full-access guardians (a declined link request). Messages are plain-language: "Mila's record is now verified. You can see her vaccination history." / "The clinic could not match your request. Visit the clinic with the child's card."
- Tests: one message per event, with dedupe on retry.

**F46 · Medium · Confidence high · Missing feature**: no reminders before a visit or a due dose
- Evidence: no reminder job type exists. The product promise is "next due vaccine without a trip to the health center", but families learn of due doses only by opening the app; follow-up snapshots refresh only on demand (L41).
- Solution: `private.enqueue_daily_reminders(p_as_of date)` run by the worker once per clinic-local day. It produces:
  - `appointment.reminder` the day before a booked visit (dedupe `appt-remind:<id>`);
  - `dose.due_soon` when a child's next requirement becomes due within 7 days (from `followup_snapshots`, after calling `refresh_followup` in the same job);
  - for both, an in-app message, plus SMS later when consented and enabled.
- Tests: a reminder appears once; a cancelled appointment gets none; a child marked `inactive` (F50) gets none.

**F47 · Medium · Confidence high · Missing feature**: no account self-service
- Evidence: no command updates `profiles.display_name` or `locale`. There is no page to change your name, password (while signed in) or email, and none to close an account. `/account/security` covers MFA only. The sign-up name is what staff see when verifying a guardian.
- Solution: an `/account` page with three parts.
  - Profile: name and language through new `update_my_profile(p_display_name text, p_locale text)`; the phone uses the existing `set_contact_preferences`.
  - Sign-in: Supabase `auth.updateUser({ password })` after re-entering the current password, and `auth.updateUser({ email })` with confirmation. The sandbox shows "not available in the demo".
  - Close account: `request_account_closure(p_reason)` opens a review case for the clinic's access administrator. Children's clinical records are retained under the clinic's policy (decided by the privacy officer); the profile becomes `deactivated` and its guardian links `revoked` once processed.
- Tests: name change is audited and visible to staff; a deactivated profile gets `get_my_context` = null and is signed out.

**F48 · Medium · Confidence high · Defect (confirmed)**: the phone and language entered at sign-up are discarded
- Evidence: the family sign-up form requires "Philippine Mobile Number" (`src/app/sign-up/sign-up-form.tsx:14`) and sends it as metadata. `private.handle_new_user` copies only `display_name`; `private.ensure_guardian` creates the guardian without `contact_phone`. Online families therefore have no phone on the BHW follow-up list until they re-enter it in Messages → text settings.
- Solution: in a new migration, `handle_new_user` also stores `locale` (`en`/`fil`) and a validated phone (digits, `+`, spaces; ≤ 20 characters) in a new `profiles.phone_on_signup` column. `ensure_guardian` copies it into `guardians.contact_phone` with `contact_status = 'unverified'`. Alternatively remove the field from sign-up; collecting a number that is never used is the worst option.
- Tests: sign-up with phone → first child added → follow-up list shows the masked phone as unverified.

**F49 · High (production) · Confidence high · Defect (confirmed by code)**: sign-up rules can be bypassed through Supabase Auth directly
- Evidence: the 12-character minimum and the required name are checked in `src/app/auth/sign-up/route.ts`. The publishable key is public, so anyone can call Supabase `signUp` with a 6-character password and no name. `src/lib/auth/password-policy.ts:3` says to keep Supabase's minimum "at or below" 12, which is the wrong direction. `handle_new_user` stores `''` as the name, and staff applications from unconfirmed email addresses appear in the Admin console.
- Solution: set the Supabase Auth minimum password length to **12 or more** and enable leaked-password protection (document in `manual-setup.md` as a release gate); correct the comment to "at least as strict". `handle_new_user` falls back to the email's local part and sets `profiles.needs_name = true`; the app asks for a name on first sign-in (F47 page). `list_staff_applications` returns `emailConfirmed` (from `auth.users.email_confirmed_at`) and the console hides or flags unconfirmed applicants.
- Verification: on staging, a direct `signUp` with an 8-character password is refused by Auth.

**F50 · Medium · Confidence high · Missing feature**: real-world end states cannot be recorded
- Child moved away or died: `set_child_record_status(p_operation_key, p_clinic_id, p_child_id, p_status 'inactive'|'active', p_reason_code 'moved'|'deceased'|'other', p_note)` requiring `review.resolve`. Inactive children leave follow-up lists, reminders and booking. "Deceased" suppresses every family message for that child.
- Wrong phone: `mark_guardian_contact_invalid(p_operation_key, p_clinic_id, p_guardian_id, p_note)` (`guardian.verify`); follow-up shows "number not working".
- Retired fridge: `close_stock_location(p_operation_key, p_clinic_id, p_location_id, p_reason)` (`inventory.manage`), refused while any balance is non-zero.
- Account deactivation: covered by F47's closure flow plus an operator command `private.set_profile_status(p_profile, p_status, p_reason)`.

**F51 · Low · Enhancement**: staff access can only be granted or revoked. Suspension (leave) and role change go through revoke + new request. Optional `suspend_staff_membership` / `reinstate_staff_membership` with the same two-person rule.

**F52 · Low · Missing feature**: staff are not alerted to new work. Add `staff_work_counts(p_clinic_id) returns jsonb` (open review cases by kind, pending applications, unanswered questions, pending transfers) and show counts as badges in the clinic navigation. This also closes L46.

**F53 · Low**: lists stop at fixed limits. Messages show the newest 100 (`my_messages(p_limit)`), search the top 25 (L7). Add cursor parameters (`p_before timestamptz`, `p_after_id uuid`) and "Show older" buttons.

**F54 · Low**: the waiting-room display (`/display/<clinic>`) is linked only from the public landing page. Add "Open waiting-room display" on Today for `queue.manage`.

**F55 · Low**: `acknowledge_privacy_notice` and `record_report_export` are allow-listed and granted but never called (superseded by `acknowledge_clinic_privacy_notice` and the `p_export` flag). Remove them from `RPC_ALLOWLIST` and `revoke execute` in the next migration.

**F56 · Low**: antigens and products can be created and retired but never corrected. Add `update_master_draft(p_operation_key, p_clinic_id, p_kind, p_id, p_changes jsonb)`, allowed only while `status = 'draft'`.

**F57 · Low**: 10 functions are layered as `*_prev`/`*_base` wrappers across migrations, so reading one command means reading two or three definitions. In one later migration, redefine each outer function with its full body and drop the inner one. Gate it on the full `test:db` suite.

**F58 · Low**: questions (`checkins`) go `open → answered` and never `closed`. Let the family mark "This answered my question" (`close_checkin`) and auto-close after 30 days in the daily job.

---

## D. Design and interaction review

Direction kept: the existing **eVacTrack civic system** (royal blue `#0648ef`, white and pale-grey surfaces, Plus Jakarta Sans for operational pages, Atkinson Hyperlegible Next for the landing page only, 6 px controls, 8 px record surfaces, words + icon for every status). It fits the audience and the product principles; nothing here proposes a new visual style.

### D.1 Impeccable audit health score (code-level; browser evidence pending)

| # | Dimension | Score | Key finding |
|---|---|---|---|
| 1 | Accessibility | 2 | Good foundations (skip link, labelled fields with `aria-describedby`, `aria-live` result regions, focus moved to outcomes, 44 px targets, status words + icons); gaps F18, F29, F31, F32 and no manual testing |
| 2 | Performance | 3 | Server-rendered pages, local woff2 for landing; Jakarta still ships as three 63 KB TTFs; 15 s full refresh polling (F18); landing blur animation (D.4) |
| 3 | Responsive design | 3 | Phone menu and clinic-menu disclosure, scroll containers for wide tables (from code); overflow at 375 px not re-verified this session |
| 4 | Theming | 3 | Operational pages token-clean (validator); drift in footer, MFA banner, auth buttons; dead dark tokens |
| 5 | Implementation integrity | 3 | Coherent product-specific system; a keyword scan of the landing, header and footer copy for claims PRODUCT.md forbids (security, encryption, government, certification, statistics, ratings) found none; integrity breaks are F06 (fake success) and F12 (missing demo notice) |
| **Total** | | **14/20** | **Good**: address accessibility verification and the integrity defects first |

### D.2 Before / proposed after (proposals, not completed work)

| Screen/component | Current behaviour or appearance | Proposed improvement | Reason | Acceptance criteria |
|---|---|---|---|---|
| Sign-in, sign-up (`sign-in-form.tsx`, `sign-up-form.tsx`) | Primary button `rounded-xl py-3 shadow-md text-sm font-bold`, wider and rounder than every other control | Use `<Button className="w-full">` from `ui.tsx` | One control shape across the product; DESIGN.md "Controls: 6px corners" | No `rounded-xl` in `src/app` outside the queue ticket; buttons 44 px high, 6 px radius |
| Sign-in in unconfigured local copy | Password form, "Forgot password?", then "Demo persona selection is disabled." | Same "This copy cannot sign anyone in" panel as sign-up, with the `npm run demo` hint | Truthful states (F07) | Three modes render three distinct, accurate panels |
| Forgot password (local) | "A reset link will arrive shortly" with nothing sent | Explain that reset needs the sign-in service; sandbox: "Demo accounts have no password" | No fake success (F06) | Network log shows no request, page text says nothing was sent |
| Global "Clinic access paused" banner (`layout.tsx`) | Saturated amber bar, raw Tailwind colours, `role="alert"` every page | `Notice tone="attention"` (tokens) under the header, no live role, link with `?next=` back to the current clinic page | Token consistency; not re-announcing on each page; returns staff where they were (F29) | No `amber-` classes; screen reader announces it once per sign-in; after MFA the user lands on the original clinic page |
| Signed-in sandbox pages | No visible demo notice | One-line, token-coloured "Fictional demo data · not for clinical use" strip | Integrity rule in DESIGN.md (F12) | Present on every signed-in sandbox page, absent in Supabase mode |
| My Children cards | Title Case labels; 12 px verification notice; chips "Verified Guardian", raw status fallback | Sentence case ("Vaccination schedule and history", "Clinic verification needed"); notice at 14–16 px; human labels for every status | Plain language for guardians on phones (F30, F31) | Copy review list signed off; no `text-xs` in family pages except tabular metadata |
| Field hints and errors (`ui.tsx` `Field`) | 12 px hint and error text | 14 px (`text-sm`) for both; error keeps icon + bold | Readability; errors are the text people most need | Hint/error computed font-size ≥ 14 px |
| Text inputs (`ui.tsx` `control`) | Outline + ring + shadow on focus | Keep the single global `:focus-visible` outline; drop ring/shadow on focus | One clear focus indicator (F32) | Visual check; focus still visible at 3:1 against adjacent colours |
| Shared footer | 9 hard-coded hex colours | Map to `--color-ink`, `--color-ink-soft`, `--color-line`, `--color-primary` (landing keeps its scoped tokens) | Token consistency (F28) | Validator reports 0 hex in `site-footer.tsx` |
| Today board timestamp | Live region re-announces "Data loaded…" every 15 s | Static text; announce only "2 new arrivals" style changes | Screen-reader noise (F18) | NVDA log shows no repeated timestamp |
| Clinic navigation order | Daily tasks mixed with rare admin items ("Clinical setup", "Staff access" after "Outage forms") | Two groups: "Daily work" and "Administration", same items | Faster scanning for frequent tasks | Groups render with headings; order unchanged within a group |
| Unavailable record pages | 200 status with "unavailable" text | 404 with the same friendly page | Correct protocol (F10) | `curl -I` shows 404 |

### D.3 Light theme and contrast

- Light theme only (your decision). Theme initial rendering: `class="light"` on `<html>` plus a forced `next-themes` provider; there is no flash risk. Persistence and system preference are intentionally ignored.
- Contrast of the core tokens (computed in this session from the hex values in `globals.css` with the WCAG relative-luminance formula): ink `#242a3b` on surface `#ffffff` 14.29:1; muted ink `#596477` on `#ffffff` 5.98:1 and on canvas `#f7f9fc` 5.67:1; primary `#0648ef` on white 6.60:1 (also white on primary); primary-strong `#003bc9` on primary-soft `#edf2ff` 7.59:1; field boundary `#727b8d` on white 4.26:1 (passes the 3:1 non-text requirement). Status pairs: success 5.21:1, attention 6.84:1, danger 5.91:1, review 6.48:1, info 6.16:1 (each text colour on its tinted background). `tests/unit/theme-contrast.test.ts` asserts ≥ 4.5:1 for text pairs and ≥ 3:1 for the field boundary and focus ring; it passed in this session.
- Not measured: text over the landing photography and gradients, disabled states (`opacity-50`), and placeholder text (`#596477`, which passes). These need the browser pass.
- Dead dark-mode code: remove (F21) so nobody maintains two palettes.

### D.4 Motion review (emil-design-eng / review-animations format)

| Before | After | Why |
|---|---|---|
| `lp-settle`: hero photo `scale(1.05)` + `filter: blur(8px)` over 1100 ms (`landing.css` motion block) | Opacity + `scale(1.02)` over 500 ms, no blur | Animated blur on a large image is expensive on low-end Android phones, which is the guardian audience; 1.1 s delays the first meaningful view |
| `lp-pop` from `scale(0.4)` | From `scale(0.9)` + `opacity: 0` | Elements should not appear to come from nothing |
| Button press feedback declared twice (global `button:not(:disabled):active` in `globals.css` and `active:scale-[0.97]` in `Button`) | Keep the global rule only; remove the utility from `Button`/`LinkButton` | One source of truth; identical behaviour |
| Global `button` transition list on every button, including the 15 s-refreshed queue board | Keep, but exclude `transform` on buttons that re-render on refresh (no change needed if the press scale stays press-only) | High-frequency surfaces should not animate on data refresh; verify none do |
| `ArrowRight` hover nudge on cards and `BackLink` (`group-hover:translate-x-1`) without hover gating | Wrap in `@media (hover: hover) and (pointer: fine)` (Tailwind `hover:` already gates in v4; confirm in the browser) | Avoid sticky hover states on touch |
| Queue "being called" `pulse-border` 2.5 s × 4 | Keep | Rare, meaningful, stops by itself, static ring + text carry the state |
| Landing scroll-driven line drawing (`animation-timeline: view()`) | Keep | Progressive enhancement, reduced-motion gated, compositor-only `scaleX/Y` |
| Global reduced-motion rule stops all animation including the button spinner | Keep, but replace the spinner under reduced motion with a static "Saving…" label | Pending state must stay visible without motion (the button already sets `aria-busy`) |

Verdict: **approve with the first three changes**. Operational pages already avoid entrance motion (DESIGN.md rule), which is right for tasks repeated many times a day.

---

## E. Phased implementation plan

Decisions you need to make first (brainstorming gate):

- **D-1 Local path for `npm run dev`.** (A, recommended for the capstone) `npm run dev` starts the existing sandbox launcher; the bare server moves to `npm run dev:next`. No external services, fictional personas, every role testable today. (B) Local Supabase through the Supabase CLI and Docker Desktop: real sign-up, email via the bundled Mailpit inbox, real MFA; heavier setup on Windows. (C) Both: A as default, B as `npm run dev:auth` for testing authentication.
- **D-2 Hosting target.** The repo assumes a Node runtime for Next, a separate long-running or scheduled worker, Supabase and a Redis REST store. Typical fits: Vercel (web) + Supabase + Upstash Redis + a scheduled worker (Vercel Cron or a small always-on host); or one container host (Render, Railway, Fly.io) running web and worker. Nothing is configured for any of them; choose before Phase 6.

Effort: S ≤ ½ day, M 1–2 days, L 3–5 days. Risk is regression or data risk.

### Phase 1: security, data integrity, runtime blockers

**Task 1.1 Safeguard the work** (F01, F22, F39) · S · Risk low · Skills: `verification-before-completion`
- Scope: whole tree; no code changes.
- Approach: remove `NotoSansCJKsc-Regular.otf` first (F22, keeps 16 MB out of history); create branch `capstone/baseline`; commit in logical groups (migrations 0025–0036; auth and recovery; staff applications; sandbox; tests; docs); add a private remote; push; let CI run. Decide what to do with the `.worktrees/loop-security-rate-limit-20261001` changes (213 files): diff it against `master` and either commit it on its branch or discard it.
- Acceptance: CI green on the pushed branch; `git status` clean.
- Rollback: commits are additive.

**Task 1.2 One working local path** (F02) · M · Risk low · depends on D-1 · Skills: `systematic-debugging`, `writing-plans`
- Scope (option A): `package.json` scripts, `scripts/demo.ts`, README, `.env.example` comments.
- Approach: `"dev": "tsx scripts/demo.ts"`, `"dev:next": "next dev"`; the launcher ignores `.env.local` already (`demoChildEnv`); README "Quick start" becomes `npm install` → `npm run dev`.
- Acceptance: fresh clone on a second Windows account and on Ubuntu (CI job) → `npm ci && npm run dev -- --verify-only` exits 0; manual: every persona signs in.

**Task 1.3 Developer-workflow safety** (F04, F05, F24) · S · Risk low
- Scope: `scripts/demo.ts`, `scripts/demo-runtime.ts`, `tsconfig.json`, `.gitignore`, `eslint.config.mjs`, `scripts/db.ts`.
- Approach: sandbox build folder `.next-sandbox` (sibling, ignored, excluded from ESLint and TypeScript); remove the stale `.next/audit-launch` and `.next/sandbox` includes; on start, detect a running cluster whose `data_directory` is ours and stop it with `pg_ctl stop -m fast`; add `npm run demo:stop`; ignore `.worktrees/**` in ESLint; `PG_BIN` falls back to the `embedded-postgres` binaries.
- Acceptance: the F04 and F05 reproduction steps both succeed; `npm run lint` no longer visits `.worktrees`; `npm run test:db` passes on a machine without Laragon.

### Phase 2: authentication, permissions, critical flows

**Task 2.1 Staging Supabase verification** (F03, F08) · L · Risk medium · depends on D-2 · Skills: `systematic-debugging`
- Scope: new staging project; `src/app/auth/sign-up/route.ts` (canonical origin); `docs/engineering/manual-setup.md`.
- Approach: follow manual-setup end to end; bootstrap two staff with `private.bootstrap_initial_staff`; run W1–W4 with real inboxes; record evidence in `docs/status.md`.
- Acceptance: each workflow passes with screenshots and request IDs; confirmation link host equals `CVSRS_PUBLIC_URL`.
- Rollback: staging only.

**Task 2.2 Combined clinic access** (F09) · S · Risk low
- Scope: `src/lib/server/viewer.ts` (new `clinicAccess`), `src/app/clinic/[clinicId]/layout.tsx`, `src/app/clinic/page.tsx`, `src/lib/auth/destination.ts`, tests.
- Acceptance: unit test with two memberships at one clinic; sandbox fixture shows both nav sets.

**Task 2.3 Truthful account pages** (F06, F07) · S · Risk low · Skills: `impeccable clarify`
- Scope: `src/app/sign-in/*`, `src/app/account/forgot-password/*`, `src/app/sign-up/availability.tsx`.
- Acceptance: unit tests for all three modes; no success message without a request.

**Task 2.4 Correct status codes** (F10) · S · Risk low
- Scope: `children/[childId]`, clinic child page, segment layouts.
- Acceptance: `curl` checks in F10.

**Task 2.5 Capstone-grade sandbox** (F11, F12) · M · Risk low (sandbox only)
- Scope: `scripts/demo.ts`, `scripts/demo-seed.ts`, `src/app/layout.tsx`.
- Approach: guarded `--reset`; curated seed covering every workflow in B.4 (one family with a verified child due today, one pending link, one booking, stock near expiry, one pending staff application, one correction awaiting approval); demo notice from `ctx.demoMode`.
- Acceptance: after reset, a scripted check lists the exact seed per persona.

**Task 2.6 Day closure** (F40) · M · Risk medium (changes visit state) · Skills: `test-driven-development`, `systematic-debugging`
- Scope: migration `0037_day_closure.sql`, `scripts/worker.ts`, `src/lib/worker/outbox.ts` (call site), `src/app/clinic/[clinicId]/today/*`, `tests/db/visits.test.ts`.
- Order: write the DB tests first, then the command, then the guard on `record_administration`, then the worker call, then the Today notice.
- Acceptance: tests in F40 pass; on the sandbox, leaving a ticket `in_service` overnight yields a closed visit and a "No-show" figure the next morning.
- Rollback: the command only moves past-dated rows to final states; a reverse is not provided, so run it first on a restored copy of the sandbox.

**Task 2.7 Staff visit management** (F41, F42, F54) · M · Risk low · Skills: `impeccable harden`
- Scope: new `src/app/clinic/[clinicId]/children/[childId]/visits.tsx`; Today session rows; migration for `update_session_capacity`; display link.
- Acceptance: an assistant books, moves and cancels a visit for a family, and the family sees each change and receives the message; a cancelled session notifies every booked family.

**Task 2.8 Unstick review states** (F43, F44) · S · Risk low
- Scope: migration with `return_schedule_to_draft` and `reject_stock_adjustment`; `schedule-actions.tsx`; `review/cases.tsx` (`StockCountCase`).
- Acceptance: tests in F43 and F44; "Approve and post" asks for confirmation.

**Task 2.9 Account self-service and trustworthy sign-up** (F47, F48, F49) · M · Risk medium (identity data)
- Scope: migration (`update_my_profile`, `request_account_closure`, `profiles.phone_on_signup`, `profiles.needs_name`, `handle_new_user`, `ensure_guardian`, `list_staff_applications.emailConfirmed`); new `src/app/account/page.tsx`; header link "Account"; Supabase Auth settings (gate in `manual-setup.md`); `password-policy.ts` comment.
- Prerequisite: Task 2.1 for the password and email parts (they need Supabase).
- Acceptance: tests in F47–F49; a direct `signUp` with a short password fails on staging.

### Phase 3: backend, APIs, database reliability

**Task 3.1 Readiness endpoint** (F14) · S · Risk low. Acceptance in F14.
**Task 3.2 Guardian index** (F15) · S · Risk low · new migration `0037`, never edit old ones. Acceptance in F15; `npm run test:db` green.
**Task 3.3 Migration ledger for every database** (F16) · M · Risk medium (touches live upgrade path). Acceptance in F16; document the production upgrade procedure and a pre-migration backup step.
**Task 3.4 Small reliability fixes** (F18, F19, F20) · S · Risk low. Acceptance in each finding.
**Task 3.5 Family notifications and reminders** (F45, F46, F58) · M · Risk low
- Scope: migration (new job types in the five deciding commands, `private.notify_profile`, `private.enqueue_daily_reminders`, `close_checkin`); `scripts/worker.ts` runs the daily job once per clinic-local day; `tests/db/sms-dispatch.test.ts` and a new `tests/db/reminders.test.ts`.
- Acceptance: each event in F45 produces exactly one message, including after a retried job; reminders follow the rules in F46.
**Task 3.6 Record real-world end states** (F50, F56) · M · Risk medium (affects lists and messaging)
- Scope: migration (`set_child_record_status`, `mark_guardian_contact_invalid`, `close_stock_location`, `private.set_profile_status`, `update_master_draft`); follow-up, reminder and booking queries exclude `inactive`; UI actions on the clinic child page, guardian contacts, stock locations and clinical setup.
- Acceptance: an inactive child disappears from follow-up and reminders but their history stays readable to staff; a location with stock cannot close.
**Task 3.7 Staff work counts** (F52) · S · Risk low: `staff_work_counts` plus navigation badges; acceptance: a new link request raises the Review queue badge after refresh.
**Task 3.8 Paging** (F53) · M · Risk low: cursor parameters for messages and search; acceptance: message 101 is reachable.

### Phase 4: architecture, code quality, repository cleanup

**Task 4.1 Remove dead code and dependencies** (F21) · S · Risk low
- Verification after removal: `npm run typecheck`, `lint`, `test:unit`, `build`; visual check of landing tabs, clinic menu disclosure and toasts (the only places `tw-animate-css`/`shadcn` styles could apply).
**Task 4.2 Archive stale docs and root clutter** (F23) · S · Risk none (moves, not deletions; you decide on the loop tooling).
**Task 4.3 Local disk cleanup** (F17) · S · Risk medium (destructive, user-run): script prints what it would drop (`cvsrs_audit_*` databases, `.next/*` caches, `.local/demo-test-*`) and requires `--yes`; never touches `cvsrs_dev`, `.local/demo-pgdata` or `.local/demo-secrets.json`.
**Task 4.4 Split oversized components** (F25) · M · Risk low · existing tests unchanged.
**Task 4.5 Database surface tidy-up** (F55, F57) · S–M · Risk medium: remove the two dead allow-list entries and revoke them; consolidate the 10 wrapper chains in one migration. Acceptance: B.6 catalog checks still pass (allowlist = executable set) and `npm run test:db` is green.
**Task 4.6 Optional staff suspension** (F51) · S · only if you want it for the capstone.

### Phase 5: UI/UX, accessibility, typography, interaction polish

**Task 5.1 Control and token consistency** (F27, F28, F29, F32) · S · Skills: `impeccable polish`, `design-system`. Acceptance: validator shows hex only in landing, brand and image generators.
**Task 5.2 Plain-language and readable text pass** (F30, F31) · M · Skills: `impeccable clarify`, `design:ux-copy`. Acceptance: copy list reviewed by you; computed sizes ≥ 14 px for hints, errors, chips.
**Task 5.3 Motion adjustments** (D.4) · S · Skills: `emil-design-eng`, `review-animations`. Acceptance: Performance panel shows no long paint on hero load on a 4× CPU throttle; reduced-motion shows the static saving label.
**Task 5.4 Accessibility verification** (F35, F18) · M · Skills: `impeccable audit`, `design:accessibility-review`. Approach: fold in this session's crawl results; keyboard-only run of W1–W12; NVDA on Windows; 200 % zoom and 320 px reflow. Acceptance: zero serious/critical axe violations on the crawl set; a written manual-check log; claims limited to what was tested.
**Task 5.5 Navigation grouping and robots decision** (D.2 row "Clinic navigation", F33) · S.

### Phase 6: performance, regression coverage, local setup, deployment readiness

**Task 6.1 Performance baseline** · S: `npm run perf` before and after Task 3.2; Lighthouse on landing and My Children (phone profile) with targets you set (for example LCP < 2.5 s on 4G).
**Task 6.2 Browser regression suite** (F26) · M · Skills: `test-driven-development`
- Scope: `@playwright/test` dev dependency, `tests/e2e/*.spec.ts`, `playwright.config.ts` starting the sandbox with `--reset` on a dedicated port, CI job.
- Tests: one spec per workflow W1–W14 that asserts persisted results after a reload (not toasts), plus authorization specs (family cannot open clinic pages; cross-family 404).
**Task 6.3 Deployment configuration** (F36, D-2) · L: platform config, secrets in the platform's secret manager, worker schedule, Redis store, trusted IP header, certificate secret row, Supabase Auth URLs.
**Task 6.4 Observability and runbook** (F13, F37) · M: error reporting (a hosted service or structured logs shipped by the platform), alerts on worker lag, `api_denied` spikes, certificate render failures and readiness 503; correct the README first-admin pointer; restore drill on the real project.
**Task 6.5 Privacy and legal content** (F38) · external dependency: privacy officer supplies text; the app already gates on the notice.

---

## F. Optional enhancements (not required fixes)

| Enhancement | Benefit | Cost | Suitability |
|---|---|---|---|
| Local Supabase track (D-1 option B/C) | Real auth, email and MFA on a laptop | Docker Desktop, ~2 GB images, slower start | Good if the panel will test sign-up and MFA |
| Self-host Jakarta as woff2 subsets | About 60 % smaller font payload on operational pages | S | Good |
| Cursor pagination for search and staff lists (L7, L25) | Large clinics can page results | M + SQL | Needed only beyond pilot scale |
| Visibility-aware polling everywhere, or Supabase Realtime (L24) | Less load, fresher boards | M–L | After deployment |
| Filipino strings (L18, L37) | Families who choose Filipino get Filipino | M + reviewed translation | High value, needs a reviewer |
| Scheduled follow-up refresh in the worker (L41) | Fresh BHW lists | S | Good |
| Unicode certificate font subset | Smaller deploy than the 10.6 MB TTF | S | Good |

---

## G. Final acceptance checklist (repeatable)

Setup
- [ ] Fresh clone, Node 22, `npm ci` uses the lockfile without changes.
- [ ] `npm run dev` (per D-1) reaches a working sign-in for every role without manual database steps.
- [ ] `npm run demo -- --reset` restores the documented seed; `npm run demo:stop` and an abrupt kill both recover cleanly.
- [ ] `npm run test:all` green; `npm run build` green **while the sandbox is running**; CI green on the remote.

Roles and persistence (sandbox, then staging)
- [ ] Each of W1–W17 completes; after reload, sign-out/sign-in and direct URL entry the result is still there and visible to the other affected role (for example a booking appears on the Today board).
- [ ] Repeated submit (double click, retry after timeout) creates one record.
- [ ] Cross-role and cross-clinic probes in B.5 still return 401/403/404.
- [ ] A dual-role staff member sees the combined workspace (F09).
- [ ] An assistant books, moves and cancels a visit for a family; the family sees it and gets each message (F41).
- [ ] Cancelling a session notifies every booked family (F42).
- [ ] The day after a session: no ticket or visit is still open, missed bookings are `no_show` and the report counts them (F40).
- [ ] A schedule under review can be sent back; a stock count can be rejected (F43, F44).
- [ ] Verification, link, edit and reported-dose decisions each send the family one message (F45); reminders arrive once (F46).
- [ ] A user can change their name and language, and (Supabase) password and email; account closure creates a review case (F47).
- [ ] The sign-up phone appears on the guardian record (F48); a direct short-password `signUp` is refused (F49).
- [ ] An inactive child leaves follow-up and reminders; a wrong phone can be flagged; an empty location can close (F50).
- [ ] Re-run the B.7 lifecycle script: every status value in a `CHECK` constraint is either set by some command or documented as intentionally unused.

Database
- [ ] Fresh install and upgrade from a `0030` copy both reach the latest migration via the ledger; an edited migration is refused.
- [ ] Catalog checks in B.6 unchanged (0 tables without RLS, 0 write grants, 0 unpinned definers, allowlist = executable set).
- [ ] Restore drill passes on staging.

UI, accessibility, motion
- [ ] Light theme only; no `dark:` utilities or `.dark` tokens remain.
- [ ] 375 px, 768 px and 1280 px: no horizontal page scroll; targets ≥ 44 px.
- [ ] Zero serious/critical axe violations on the crawl set; keyboard-only and NVDA logs recorded; 200 % zoom usable.
- [ ] Reduced motion: no movement, pending states still visible.

Integrity
- [ ] No success message without a confirmed server result (F06).
- [ ] Sandbox pages show the fictional-data notice; Supabase mode never does.
- [ ] No hard-coded credentials; first admins only via `bootstrap_initial_staff`.

Production
- [ ] Staging: sign-up, confirmation, recovery, MFA, every role's landing page.
- [ ] `/api/v1/health/ready` returns 503 when the database is down; alerts fire.
- [ ] Worker deployed with its own login; certificate secret matches; Redis store reachable.
- [ ] Privacy notice and policy text supplied by the privacy officer.

---

## H. Unresolved verification requirements

1. Review this session's crawl output (`crawl-report.json` in the session scratchpad, 10 personas × 2 viewports with axe-core) once the permission classifier allows it, and add its results to Section D.
2. Re-run the browser pass after Phase 1 against a freshly reset sandbox (the lead-and-later portion of this session's crawl overlapped the build incident and its later pages may record 500s).
3. Everything marked "Not tested" in B.4 for the live column needs a staging Supabase project.
4. Manual accessibility and real-device (low-end Android, iOS Safari) testing.
5. Reproduce F09 with a dual-role fixture before fixing it.
6. The second pass (B.7, F40–F58) was static: every finding was confirmed by reading the final SQL and the screens, not by running the flow in a browser. Each new task's tests (listed per finding) are the runtime proof still owed.

### What "complete" means here

No honest audit can certify a system as "100 % functional". What this report can say, with evidence:
- every route, page, client API call, internal link, allow-listed command and status value was enumerated and cross-checked (B.7);
- every gap found has a named fix, an owner phase and a test;
- once Phases 1–3 are done and the checklist in G passes on the sandbox and on staging, the flows in B.4 are verified end to end within that tested scope.

Anything outside that scope (other devices, load beyond the 20,000-child perf set, real SMS, clinical policy correctness) stays an explicit open item.
