# Shared brief for specialist agents (iteration 1)

Read this whole file before starting. The orchestrator owns integration, `docs/engineering/{audit,coverage,plan,verification}.md`, and final status.

## Project

CVSRS — Children's Vaccination Scheduling and Records System. Next.js 16.3.7 App Router (READ `node_modules/next/dist/docs/` before writing framework code; APIs differ from training data — e.g. `src/proxy.ts` replaces middleware), React 19, TypeScript strict, Tailwind 4, Zod 4, Supabase (Auth + PostgREST RPC), PostgreSQL. Business logic lives mostly in `SECURITY DEFINER` SQL functions (`supabase/migrations/0001..0033`), called through an allowlisted RPC port (`src/lib/db/port.ts`, `supabase.ts` live adapter, `local.ts` local PostgreSQL adapter). API routes: `src/app/api/v1/**` via `src/lib/api/handler.ts`. Pages: `src/app/**/page.tsx`. Worker: `scripts/worker.ts`, `src/lib/worker`. Local demo sandbox: `npm run demo` (embedded PostgreSQL port 54330, Next on http://127.0.0.1:3000, synthetic personas `lead, lead2, nurse, assistant, inventory, admin, bhw, family, family2` @demo.cvsrs.test).

Prior audit records (read the relevant ones, do not re-report already-fixed items as new without checking current code): `docs/audit/master-plan.md` (registry E01–E17, G01–G06), `docs/audit/system-map.md`, `docs/audit/*-audit.md`, `docs/implementation/known-limitations.md`, `docs/implementation/status.md`.

## Baseline (2026-10-01, orchestrator-run, all on current dirty tree)

typecheck PASS · lint PASS · unit 174/174 PASS (31 files) · DB 316/316 PASS (19 files) · demo 4/4 PASS · matrix 287 rows OK · `next build` PASS.

## Hard rules

- The working tree is a dirty audit branch with ~213 uncommitted files of prior work. PRESERVE IT. Never run `git checkout -- …`, `git reset`, `git stash`, `git clean`, commit, push, or delete files you did not create. Never edit `.env`, `.env.local`, or real secrets.
- Only edit files your assignment says you own. If a fix needs another file, report it instead.
- Never edit an existing migration file (`0001`–`0033`): history is checksummed by the demo launcher and may be applied elsewhere. Schema changes go in a NEW forward migration only when your assignment owns one.
- Database tests: do NOT run plain `npm run test:db` (the orchestrator serializes it). For isolated runs use your own database name on the shared local cluster: `CVSRS_TEST_DB_NAME=cvsrs_audit_<yourarea> npx vitest run --config vitest.db.config.ts tests/db/<file>.test.ts` (names must match `cvsrs_audit_[a-z0-9_]+`). Cluster binaries are under `C:/laragon/bin/postgresql/postgresql/bin`, port 54329. Do not touch `cvsrs_dev`, `.local/pgdata` files, or the demo cluster files.
- Shell is Windows; a Git Bash tool and PowerShell are available.
- No external network calls, deployments, provider accounts, or messages.
- Do not invent medical rules, clinic policy, compliance claims, or production evidence.

## Applicable skills (read the SKILL.md before applying)

`.agents/skills/systematic-debugging`, `test-driven-development`, `verification-before-completion`, `requesting-code-review`, `receiving-code-review`; UI work: `.agents/skills/impeccable`, `ui-ux-pro-max`, `review-animations`, `emil-design-eng`. Use only those relevant to your assignment.

## Finding format (use exactly)

```
### <ID> — <title>
- Priority: P0|P1|P2|P3   (P0 security exposure/data loss/widespread failure; P1 broken essential flow/incorrect business behavior; P2 significant reliability/usability/a11y/perf gap; P3 polish/maintainability)
- Class: Reproduced defect | Inspection risk | Missing required behavior | Optional improvement | External setup blocker
- Location: path:line (one or more)
- Evidence: exact repro steps / command output / code excerpt reasoning
- Impact: who is affected and how
- Root cause: (if established)
- Solution: concrete change
- Acceptance: testable criteria
- Verification: what test/check proves it
```

Be rigorous: every finding must be checked against current code. Distinguish what you reproduced from what you inferred. Do not pad with style nits. Prefer few, real, high-value findings over many speculative ones.

## Handoff

Your final message must start with the line `MODEL: <the exact model ID stated in your system context>`, then: files written, finding count by priority, the top findings (ID + one line), coverage items you inspected (with status Inspected / Defect found / Not inspected), and anything you could not do and why.
