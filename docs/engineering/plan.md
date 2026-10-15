# Production-readiness loop — plan and iteration ledger

Started 2026-10-01 on branch `audit/production-quality-2026-09-30` (dirty tree of prior audit work preserved; no commits/pushes). Orchestrator: Claude Opus 5.5 (`claude-opus-5-5`). Specialists are separate Claude subagents dispatched with the `opus` model alias; each reports the model ID from its own system context in its handoff (recorded below), which is the only availability evidence this environment offers.

Records: findings registry [audit.md](audit.md) · coverage inventory [coverage.md](coverage.md) · check evidence [verification.md](verification.md) · operator steps [manual-setup.md](manual-setup.md) · agent brief [agent-brief.md](agent-brief.md) · raw specialist reports `discovery/`. Prior registry (E01–E17, G01–G06): [../audit/master-plan.md](../audit/master-plan.md).

## Policy reconciliation

- `loop-constraints.md`, `LOOP.md` and `docs/safety.md` (untracked loop scaffolding) restrict *unattended scheduled* loops from touching auth/security/migrations/env/package files without human sign-off. This run is user-directed with an explicit request to fix security, auth and Supabase migrations, which is taken as that sign-off for repository edits. Still honoured: no push, no merge, no commit without the user's request, no edits to real `.env*` secrets (`.env.example` placeholders only), no external services.
- Existing migrations `0001`–`0033` are never edited (demo launcher checksums history); schema changes are forward migrations.

## Baseline (iteration 0, orchestrator-run)

| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run test:unit` | 174/174 PASS (31 files) |
| `npm run test:db` | 316/316 PASS (19 files, clean rebuild of `cvsrs_test`) |
| `npm run test:demo` | 4/4 PASS |
| `npm run matrix:check` | 287 rows OK |
| `npm run build` | PASS |

No pre-existing failures. A passing baseline is not treated as evidence of correctness for untested paths.

## Iteration 1 — DISCOVER

Dispatched in parallel (disjoint outputs, isolated test databases, single browser owner):

| Agent | Role | Output |
|---|---|---|
| security | Auth/authz/API/secrets audit (read-only) | `discovery/security.md` |
| database | Schema/RLS/business rules audit (read-only) | `discovery/database.md` |
| supabase | Supabase compatibility review + fresh-install packaging (implementer) | `discovery/supabase-compat.md`, `supabase/install/*`, `scripts/build-supabase-install.ts`, `manual-setup.md` |
| frontend | Static control/flow/architecture audit (read-only) | `discovery/frontend.md` |
| ui-qa | Browser UI/UX/a11y/theme/responsive QA on local demo (read-only) | `discovery/ui.md` |

Discovery results (all five reports complete; every specialist reported `MODEL: claude-opus-5-5`, and API errors on interruption named `claude-opus-5-5` as the model sent): security 6 findings, frontend 21, database 7 (+ mechanical RLS/grant/definer PASS), Supabase compatibility 6 (+ packaging delivered), browser UI 16 (312 page loads). Registry: [audit.md](audit.md). Coverage: [coverage.md](coverage.md).

## Iteration 1 — PLAN / IMPLEMENT (batch 1)

Disjoint file ownership; each implementer adds tests for its items; no one edits existing migrations.

| Implementer | Items | State |
|---|---|---|
| A security | SEC-01, SEC-02, SEC-03 (cookies + staff idle sign-out; step-up deferred), SEC-04, SEC-06, FE-19, FE-03 return path | Running (resumed after usage limit) |
| B1 staff workflow UI | FE-01 UI, FE-02 UI, FE-04, FE-05 (own files), FE-06, FE-07 (own files), FE-12, FE-14, FE-16, FE-17, FE-18, UI-05, UI-06 UI, UI-10 (Today), UI-14, UI-16 (review) | Running (resumed) |
| B2 viewer/time/navigation | FE-03, FE-05, FE-07, FE-08, FE-09, FE-11, FE-13, FE-20, UI-07, UI-10 (cards), UI-13 (messages) | **Done** — awaiting review |
| C SQL (0000_extensions + 0034) | SUP-01, DB-01, SEC-05, DB-02, FE-01 SQL, DB-03, DB-04, DB-05, DB-06, SUP-02 | Running (resumed) |
| D shell/a11y/motion | UI-01, UI-02, UI-03, UI-04, UI-08 UI, UI-09, UI-10 (brand), UI-11, UI-12, UI-13 (footer), UI-15, UI-16 (banner) | Running (resumed) |

Queued for batch 2 (dependencies on batch 1 files): FE-02/FE-10 paging (SQL + UI), FE-15 stable error hints (SQL + `errors.ts`), UI-06 server rule (vaccinated outcome requires recorded dose — needs clinical owner confirmation), SUP-05 `token_hash` callback branch, SEC-03 step-up reauthentication, display/messages clinic timezone from SQL, FE-21 cleanup, SUP-04 deployment doc rewrite (after env vars settle), `.animate-in`/`transition-all` sweep in files owned by other implementers.

Needs user decision: DB-07 (same-day multiple bookings policy), DB-04 (org-wide lot recall/audit — restrictive default being implemented, reversible), ORC-01 (stray `.audit-generate-0026.py`), SEC-03 idle timeout / session length values, UI-08 (can target date fall after due window — scheduling owner).

### Checkpoint (2026-10-02)

If this run stops: batch 1 code is in the working tree (uncommitted). Next actions: (1) collect handoffs from A, B1, C, D; (2) run full gates (typecheck, lint, unit, DB on `cvsrs_test`, demo, matrix, `db:install-sql --check`, build); (3) dispatch an independent reviewer over the batch-1 diff and an independent QA verifier (headless Chromium harness in `.local/audit-scratch/ui/` + demo) to re-run the UI/FE/SEC/DB acceptance criteria; (4) route rework; (5) plan batch 2 from the queue above.
