# LOOP_STATE

Single source of truth for the production-readiness loop. Read this first, then [audit.md](audit.md), [coverage.md](coverage.md), [plan.md](plan.md), [verification.md](verification.md), [manual-setup.md](manual-setup.md).

## Iteration 4 — 2026-10-06 (current)

Orchestrator: Claude Opus 5.5 (`claude-opus-5-5`, from system context). Interactive, user-directed run (not a scheduled loop cycle): `LOOP.md`/`loop-constraints.md`/`loop-budget.md` govern the unattended daily-triage loop and were read, not edited; no kill switch (`loop-pause-all`) is set. As in iterations 1–3, the explicit request to fix auth, security and migrations is taken as sign-off for repository edits on those paths. Still honoured: no commit, push, merge, deploy or PR; real `.env*` files untouched; no external or paid services; dev Supabase stack never reset; fixtures only in the isolated E2E stack and disposable databases.

Code state at start: `master` @ `0e1c4a7` + 341 uncommitted status entries (154 tracked files changed, +6,271/−1,895, plus untracked work from iterations 1–3). All preserved. `.worktrees/loop-security-rate-limit-20261001` is stale and left alone (user's decision).

**Baseline (23:02–23:05, before any edit):** typecheck 0, lint 0, unit 61 files/482, DB 22/367 (fresh `cvsrs_test`), matrix 0, `db:install-sql --check` 0. E2E: see verification.md.

**Findings for this iteration** (register: [audit.md](audit.md) "Iteration 4"): I4-01 … I4-09.

| Task | Findings | Owner (role) | Files owned | Status |
|---|---|---|---|---|
| T1 Browser journeys for the staff workflows that only have DB evidence | I4-02 | QA agent (Opus) | `tests/e2e/06+`, append-only helpers in `tests/e2e/support.ts` | open |
| T2 Last-administrator guard, unused RPC revokes, stable booking hint, applicant escalation probes | I4-03, I4-04, I4-05, I4-06 | Backend/DB agent (Opus) | `supabase/migrations/0040_*`, `supabase/install/*` (regenerated), `src/lib/db/port.ts`, `src/lib/api/errors.ts`, `src/lib/client/api.ts`, `src/app/children/[childId]/visits.tsx`, `tests/db/iteration4.test.ts`, the two tests naming the revoked RPCs, `scripts/matrix.ts` row C-M02-10 | open |
| T3 Upgrade drill from a populated older schema | I4-07 | Backend/DB agent | `scripts/upgrade-drill.ts`, `package.json` script entry | open |
| T4 Stale preview launch config | I4-01 | Orchestrator | `.claude/launch.json` | open |
| T5 Rendered UI pass on populated screens (bounded) | I4-08 | Orchestrator, after T1 | per finding | open |
| T6 Independent review of the integrated diff | — | Reviewer agent (Opus, read-only) | none | open |
| T7 Final gates, coverage regeneration, docs | I4-09 | Orchestrator | docs | open |

**Checkpoint 2026-10-07 00:15.** T2/T3 implemented (backend agent, MODEL claude-opus-5-5; migration 0040, upgrade drill) and re-verified by the orchestrator (default DB 23/383, unit 63/497, drill PASSED). T4 done (I4-01 verified with preview_start). Orchestrator also found and fixed I4-11 (worker dies on a failed pass), I4-14 (P1: production proxy answered 500 on every path incl. health), I4-15 (readiness ignored rate-store settings), I4-16 (audit query 500 on malformed dates; cursor id missing) — production `next start` smoke verified unconfigured and configured (`.local/prod-build`, port 3300; tsconfig.json/next-env.d.ts restored after each `next build`). T1 (QA agent) running: journeys 06-visits, 07-records so far; it was told about 0040's behaviour and the support.ts:264 typecheck break (its file, mid-edit). T6 reviewer (Opus, read-only) dispatched on groups A+B. **Next:** collect QA defects → fix → QA re-run; collect review → fix REVISE items; T5 visual pass on the populated E2E stack; T7 final gates (`npm run test:all`, `npm run test:e2e`, build, coverage regen). User instruction 2026-10-06: **never commit**.

Dependency order: T4 and T2/T3 start now; T1 starts now (its runs pick up migration 0040 when it lands; one exclusive E2E runner at a time); T5 after T1 leaves the E2E stack populated; T6 after T1–T5; T7 last.

## Iteration 3 — 2026-10-04 (superseded by iteration 4)

Orchestrator: Claude Opus 5.5 (`claude-opus-5-5`, from system context). Findings source: [../audit/2026-10-04-capstone-production-audit.md](../audit/2026-10-04-capstone-production-audit.md) (F01–F58). Branch `master` @ `0e1c4a7`, dirty tree preserved; **no commits** (user did not answer the commit question).

**User decisions this iteration:** real local authentication = **local Supabase stack on Docker** (user installs Docker Desktop). Demo persona sandbox is to be removed from the normal path once the real path works.

**Baseline (before any edit, 18:45):** `npm run test:all` exit 0 — typecheck, lint, unit 61 files/498, DB 22 files/366 (fresh `cvsrs_test`), matrix 287.

**Re-verified finding status (code read 2026-10-04):** already fixed in tree: F06, F07, F08, F09, F10, F12-notice-removed, F18, F24, F29(partly), F33, F40–F50. Still open: F01 (uncommitted), F02/F03/F16 (→ local Supabase work), F19, F21 (done this iteration), F22 (done), F26 (E2E), F27, F28, F30–F32, F35, F51–F58.

**Done this iteration:**
- F14 readiness: `src/lib/health.ts`, `GET /api/v1/health/ready` (503 `{status:"unavailable"}` on bad config / DB timeout 2 s); `tests/unit/health-ready.test.ts` (5).
- F21/F22: moved to scratchpad recovery folder (untracked files): `interactive-constellation.tsx`, `components/ui/button.tsx`, `lib/utils.ts`, `NotoSansCJKsc-Regular.otf` + its Adobe `LICENSE`; uninstalled `@base-ui/react`, `class-variance-authority`, `cn`.
- Security: removed dead `@import "shadcn/tailwind.css"` (no variant/keyframe used in `src`) and the `shadcn` package → `npm audit --omit=dev`: **0 vulnerabilities** (was 6 high). Remaining: 5 high dev-only (`braces` via `eslint-config-next`; npm's fix downgrades to v14) — accepted, lint-time only.
- Local Supabase: `supabase` CLI 2.119.0 devDependency; `supabase/config.toml` (password ≥ 12, confirmations on, secure password change, TOTP on, exact redirect URLs, no seed, realtime/storage/edge/analytics off); `scripts/local-stack.ts`, `scripts/dev.ts` (`npm run dev`), `scripts/setup-first-staff.ts` (`npm run setup:first-staff`, refuses unconfirmed emails), `npm run dev:next`, `npm run dev:stop`; `tests/unit/local-stack.test.ts` (3).
- `@playwright/test` 1.63 devDependency (Chromium 1243 already cached).

**Docker:** installed by the user 19:00 (29.5.2). Shell sessions opened before the install need `export PATH="$PATH:/c/Program Files/Docker/Docker/resources/bin"`.

**Done after Docker (19:00–19:45):**
- Local Supabase stack (CLI 2.119, PG 17, GoTrue v2.197): all 39 migrations 0000–0038 applied by the CLI ledger; `verify.sql` 18 PASS / 2 INFO; `supabase db push --dry-run` reads the ledger ("up to date"); `db:install-sql --check` up to date.
- `npm run dev` verified: Docker check → stack → `migration up` (none pending) → secrets/worker login → Next ready; HTTP smoke: public pages 200, `/api/v1/health/ready` 200, protected pages 307 → /sign-in, `/api/v1/me` 401.
- F49 verified on GoTrue: direct signUp with 8/11-char passwords → 422 weak_password; 12 accepted (probe account deleted afterwards).
- **Demo sandbox removed** (normal app + deployment path): `src/lib/db/local.ts`, `src/lib/auth/demo.ts`, `src/app/dev/login`, `scripts/demo*.ts`, `tests/demo`, `vitest.demo.config.ts`, demo unit tests, `demo`/`test:demo` scripts, local-dev config mode, sandbox branches in sign-in/up/out, account, security, reset, forgot-password, verify, certificates, layout, landing, nav, footer. Synthetic schedule moved to `tests/fixtures/synthetic-schedule.ts` (DB tests only). Untracked removed files copied to scratchpad `removed/`; tracked ones recoverable from git. Also removed obsolete `db:setup`/`db:reset` (+ `scripts/setup-local.ts`). Worker no longer falls back to `CVSRS_LOCAL_DB_URL` (superuser) — only `CVSRS_WORKER_DB_URL`.
- F27 auth buttons use shared `Button`; sentence-case labels; show-password toggle regained a visible focus ring (was `focus:outline-none`, WCAG 2.4.7); "Forgot password?" target 44 px; hints/errors 14 px (F31); F28 footer tokens (computed colours identical).
- E2E: `scripts/e2e.ts` + `scripts/e2e-stack.ts` (isolated stack cvsrs-e2e, ports 553xx/app 3100, reset per run), `playwright.config.ts`, `tests/e2e/{support,01-accounts,02-first-staff,03-staff-application}.spec.ts`: **11/11 pass** on real Supabase Auth (sign-up + email confirm via PKCE callback, unconfirmed refusal, wrong password, sign-out, reset via email, enumeration-safe reset, F49, bootstrap refusals + success via `setup:first-staff --hosted`, TOTP enrolment, aal1 API refusal, staff application → accept → second-person approval, accepter cannot approve (UI + API), nurse role boundaries). CI job `e2e` added (unverified: no remote).
- New DB test: `revoke_staff_membership` (was untested).
- Gates 19:40: `npm run test:all` exit 0 (unit 61/478, DB 22/367, matrix 287); `npm run build` exit 0; axe (WCAG 2.0–2.2 A/AA) 0 violations on 7 public pages × 375/1280 px, no overflow, no console errors.
- Docs: README (setup, first use, tests), `docs/deployment.md` (single runbook incl. release checklist, rollback), `docs/operations/deployment.md` → pointer, runbook worker line, manual-setup status, `.env.example` local section.

**Completed later (19:45–21:00):** clinical first-visit journey (`tests/e2e/04-first-visit.spec.ts`, Opus subagent; reviewed and accepted), accessibility journey `05-accessibility.spec.ts`; **E2E 20/20**. Independent review (separate Opus agent, read-only) → fixed: known-limitations corruption (my regex bug), Auth 429/5xx no longer reported as wrong password + one Auth call per sign-up (`authServiceFailure`), `--hosted` bootstrap requires TLS, readable script errors with masked connection strings, reset-password honest when unconfigured, sign-in redirect messages, e2e state reset + port check, schedule-view list semantics, dev refuses privileged keys in env files, migration 0039 (SQL-level email confirmation), stale comments/docs, `ConfigError.kind`, dead test mocks, readiness uses a cookie-less client + 5 s cache. Agent findings fixed: identity/guardian success notices now survive refresh; inventory empty state + README explain granting the Inventory clerk role. Not fixed (P3, recorded): worker password via plain ALTER ROLE on local stacks (local only), no-JS staff sign-in failure lands on family sign-in.
**Final gates 21:00:** test:all exit 0 (unit 482, DB 367, matrix 287), install SQL up to date (40), build exit 0, audit 0, E2E 20/20. Coverage: [coverage.md](coverage.md).

**Accepted trade-off (F10):** clinic pages under `clinic/[clinicId]/loading.tsx` answer 200 with the not-found view (+ noindex) when `notFound()` runs after streaming starts (documented Next 16 behaviour); E2E asserts no protected content is sent.

**New backlog:** last-admin self-revocation lock-out guard (P3).

**Next exact actions (in order):** (1) once Docker runs: `npm run dev` → verify stack start, all 38 migrations via CLI ledger, provisioning; (2) build `test:e2e` on an isolated second stack (project_id `cvsrs-e2e`, shifted ports, reset per run) covering W1–W11 with real Auth + Mailpit + TOTP; (3) remove demo sandbox (map in this file's "Demo removal map"), switch sign-in/up/recovery to supabase-or-unconfigured, F27 buttons; (4) UI pass F28/F30–F32 with browser evidence; (5) independent review agent; (6) docs: README quick start, deployment runbook, coverage matrix rewrite.

**Backlog (P3, not doing now, concrete fixes recorded):** F19 (stable hint `cvsrs:duplicate_session_booking` in a redefined `book_appointment` + carry `hint` through `AppError`/`ApiFailure`), F55 (revoke `acknowledge_privacy_notice`, `record_report_export` from `authenticated` in a new migration; update `tests/db/reports.test.ts:156-159`, `tests/db/sweep.test.ts:32`, matrix C-M02-10), F51–F53, F56–F58.

## Session Log

| Date | Tool | Model | Iterations | Summary |
|---|---|---|---|---|
| 2026-10-01 → 10-02 | Claude Code | claude-opus-5-5 (orchestrator + subagents, each reported `MODEL: claude-opus-5-5`) | Iteration 1 (discover + batch 1 implement; B1/B2 reviewed) | Recorded in plan.md / audit.md. Session ended with A, B1-rework, C, D unreviewed. No LOOP_STATE.md existed then. |
| 2026-10-02 (morning) | ChatGPT Codex | Opus 5.5 unavailable (429 session limit) | 0 | Wrote `resume-checkpoint-2026-10-02.md`; saw typecheck + 49 unit failures while batch-1 agents were still mid-edit. No code edits. That checkpoint is now stale (see Baseline). |
| 2026-10-02 (midday) | unknown (separate session) | unknown | — | eGov-inspired redesign + browser sweep: `docs/superpowers/plans/2026-10-02-egov-system.md`, `docs/audit/2026-10-02-egov-system-verification.md`, `DESIGN.md`. Files last touched 13:45. |
| 2026-10-02 18:13 → | Claude Code | claude-opus-5-5 (verified from system context) | Iteration 2 in progress | Created LOOP_STATE.md + baseline manifest; full gates green; dispatching independent review of unreviewed batch-1 work. |
| 2026-10-02 ~19:00 | Opus 5.5 | Orchestrator | SUP-03 verification on PG15/17 | Verified migrations + DB suite + fresh-install/verify.sql on PG15.18 and 17.10 (see verification.md). |
| 2026-10-02 20:xx | Opus 5.5 | Reviewers & API auditor | Reviews completed | R2-A (security), R2-C (SQL 0034), R2-D (shell/a11y), DISC-2-API (95 uninspected API routes) all submitted reports. |
| 2026-10-02 21:07 | Opus 5.5 | Orchestrator | Updated registry, fixed UI-17, API-02; dispatched implementers A2, B1R, C2 | All three implementers hit Opus 5.5 session limit (429) and were terminated early. No handoff reports yet. |
| 2026-10-02 21:xx | Opus 5.5 | Orchestrator | API-02 fix | Fixed tracing config to include font only in PDF routes, added regression test. |

## Current Phase and Iteration

Iteration 2 — Awaiting implementer reports (A2 security rework, B1R staff UI rework, C2 SQL 0035) after Opus 5.5 rate limit resets or model switch.

## Git Baseline

- Branch `audit/production-quality-2026-09-30`, HEAD `0e1c4a70e8b6df6ce8d81a556c54634305266948`.
- At loop (re)start, 2026-10-02 18:15 +08: ~274 status entries (modified, one deletion `src/app/dev/axe/route.ts`, many untracked) — prior user work, prior loop iteration-1 work and the eGov redesign session. **All of it is preserved baseline.** Exact content hashes: [baseline-manifest-2026-10-02.txt](baseline-manifest-2026-10-02.txt). Any file whose hash differs from that manifest was changed by this loop and must appear in "Files Changed" below.
- Stale worktree `.worktrees/loop-security-rate-limit-20261001` (branch `loop/security-rate-limit-20261001`, same HEAD): an older snapshot of the security work (its rate-limit.ts/handler.ts/sign-out are older than the root checkout's; 37 vs 56 unit test files). Do not copy from it; do not delete it (user's decision).
- Untracked `.audit-generate-0026.py` (ORC-01): would append to migration 0026 if run. Do not run. User decision to delete.

## Current Batch

| Task | Owner role | Status |
|---|---|---|
| A2: RV2-A-01..05, SUP-05 token_hash callback, API-06 | Implementer A2 | blocked (Opus 5.5 rate limit) |
| B1R: RV1-01..05, RV1-07, RV2-D-05, RV2-D-06, IMP-02, IMP-03, **RV2-C-01 (P1)** | Implementer B1R | blocked (Opus 5.5 rate limit) |
| C2: migration 0035 (RV2-C-02/03/05/07, IMP-01/RV1-06, FE-02 paging, FE-10 totals, FE-15 hints, IMP-05, API-04/05) + audit route/page (RV2-C-04/API-03) + errors.ts (FE-15 reason, CV503) + install README (RV2-C-06) | Implementer C2 | blocked (Opus 5.5 rate limit) |
| API-02: certificate font tracing | Orchestrator | completed |

## Files Changed (Uncommitted)

Files created/edited by this loop session after the baseline manifest (status · finding · description):

- `docs/engineering/LOOP_STATE.md` — created · loop record.
- `docs/engineering/baseline-manifest-2026-10-02.txt` — created · baseline hashes.
- `docs/engineering/verification.md` — created · check evidence ledger.
- `docs/engineering/audit.md` — edited · statuses + iteration-2 findings (UI-17, ORC-02, RV2-*).
- `docs/engineering/manual-setup.md` — edited · RV2-A-06: Supabase password minimum 12 (verified by reading).
- `docs/engineering/review/batch1-security.md`, `review/batch1-shell.md` — created by reviewers R2-A / R2-D.
- `src/components/interactive-constellation.tsx` — edited · UI-17 · in review: static frame redrawn on resize/theme change under reduced motion; animation pauses off-screen (IntersectionObserver).
- `next.config.ts` — edited · API-02 · in review: font traced only into the 2 PDF routes, exact escaped keys.
- `tests/unit/build-tracing.test.ts` — created · API-02 · regression test (2/2 pass).
- `docs/engineering/discovery/api-routes.md` — created · API audit report (125/125 routes; 10 P3) (read-only specialist).
- Implementers A2, B1R and C2 are editing their owned files now (see Current Batch); list to be completed from their handoffs.

**User's concurrent edits (not the loop; user confirmed intended light-mode-only, loop must not touch):** `src/app/layout.tsx` (18:20–18:23), `src/components/theme-provider.tsx` (18:19), `src/components/toaster.tsx` (18:24), `tests/unit/shell-controls.test.ts` (18:25). Also leave `src/app/globals.css` until the user's styling edits settle.

## In-Progress Work

A2, B1R, C2 are blocked due to Opus 5.5 session limit (rate limit). No further progress until limit resets or model switched.

## Decisions and Interface Contracts

- Never edit migrations `0001`–`0033` (checksummed by the demo launcher, may be applied elsewhere). `0000_extensions.sql` and `0034_integrity_performance.sql` were created by iteration 1, have never been applied outside local disposable databases, and may be corrected in place until released; anything else goes in `0035+`.
- **All SQL rework from iteration 2 goes in `0035+`; 0034 stays byte-identical** (user's demo DB may have applied it; demo launcher refuses changed checksums).
- After any migration change run `npx tsx scripts/build-supabase-install.ts` to regenerate `supabase/install/*`, then `--check`.
- DB tests: full suite only by orchestrator (`npm run test:db` rebuilds `cvsrs_test`). Agents use `CVSRS_TEST_DB_NAME=cvsrs_audit_<area>`.
- Iteration-1 decisions still in force (plan.md "Policy reconciliation"): this user-directed run counts as sign-off for auth/security/migration edits; no edits to real `.env*`; no external services.
- DB-04 restrictive default (clinic-scoped lot trace / audit search) is reversible pending user policy decision.
- Time display: `formatClinicDate` prints "2 Oct 2026" in the clinic zone; helpers `clinicLocalToInstant` / `instantToClinicLocal` are the only wall-time converters.
- **App is light-mode only (user decision 2026-10-02).** Skip dark-mode audits; do not restore theme toggles.

## Baseline and Latest Check Results

2026-10-02 21:07, current tree (no loop edits since implementers blocked):

| Check | Result |
|---|---|
| `tsc --noEmit` (app) + tools tsconfig | PASS |
| `eslint .` | PASS |
| `vitest run tests/unit` | 55 files, 388/388 PASS |
| `vitest --config vitest.db.config.ts` | 20 files, 335/335 PASS (fresh `cvsrs_test`) |
| `vitest --config vitest.demo.config.ts` | 4/4 PASS |
| `matrix --check` | 287 rows OK |
| `build-supabase-install --check` | up to date (35 migrations) |
| `next build` | PASS |

No pre-existing failures. The Codex checkpoint's failures (handler.ts `onStoreFailure`, 49 unit failures) no longer reproduce.

## Blockers and Items Awaiting Manual Setup

- Live Supabase (Auth email/recovery/MFA, PostgREST, PG15/17 execution — SUP-03), SMS provider, Redis REST rate-limit store, hosted CI, deployment: see manual-setup.md.
- User decisions: DB-07 (same-day multiple bookings), DB-04 (org-wide trace/audit vs clinic-scoped), ORC-01 (delete `.audit-generate-0026.py`), SEC-03 idle/session durations, UI-08 (target date after due window), UI-06 server rule (does "vaccinated" outcome require a recorded dose), **RV2-C-08** (users with no relationships see every org's privacy notices, cap 100 — deliberate trade-off vs DB-03 acceptance).

## Next Exact Actions

1. Wait for Opus 5.5 rate limit to reset (resets 11pm Asia/Manila) **OR** ask the user to switch the implementer agents to Sol 6.1 (ChatGPT Codex model) for the remaining coding work while the orchestrator stays on Opus 5.5 for lightweight tasks.
2. Collect implementer reports A2, B1R, C2 (to be written to `docs/engineering/implement/{A2,B1R,C2}.md`).
3. Route REWORK items to implementers; re-review.
4. Plan batch 3 (see plan.md "Queued for batch 2" plus new items from API audit and SQL review).