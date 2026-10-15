# Verification ledger

Every gate run and what it proves. Labels: **[static]** inspection only · **[local]** executed locally (PostgreSQL 18 disposable cluster, embedded demo) · **[live]** executed against real external services (none so far).

## 2026-10-02 18:15 — iteration 2 baseline (orchestrator, claude-opus-5-5)

Tree: baseline manifest `baseline-manifest-2026-10-02.txt` (no loop-2 edits).

| Command | Result | Label |
|---|---|---|
| `npx tsc --noEmit` | exit 0 | local |
| `npx tsc --noEmit -p tsconfig.tools.json` | exit 0 | local |
| `npx eslint .` | exit 0 | local |
| `npx vitest run tests/unit` | 55 files, 388 passed, 0 failed | local |
| `npx vitest run --config vitest.db.config.ts` | 20 files, 335 passed, 0 failed (clean rebuild of `cvsrs_test` from bootstrap + 0000–0034) | local |
| `npx vitest run --config vitest.demo.config.ts` | 1 file, 4 passed | local |
| `npx tsx scripts/matrix.ts --check` | `matrix ok: 287 rows` | local |
| `npx tsx scripts/build-supabase-install.ts --check` | `supabase/install is up to date (35 migrations)` | local |
| `npx next build` | exit 0, all routes compiled | local |

Not proven by these: live Supabase Auth/PostgREST, PostgreSQL 15/17, SMS, Redis store, hosted CI, real devices/assistive technology.

## 2026-10-02 ~19:00 — SUP-03 PostgreSQL 15 / 17 execution (orchestrator)

Binaries: `@embedded-postgres/windows-x64@15.18.0-beta.17` (PostgreSQL 15.18) and `@17.10.0-beta.17` (PostgreSQL 17.10), unpacked into the session scratchpad (not the project). Disposable clusters on ports 54338 / 54339 with data in the scratchpad; the project cluster (54329) was not touched. Harness: `.local/audit-scratch/pg17/{global-setup-pg15.ts,global-setup-pg17.ts,vitest.pg15.config.ts,vitest.pg17.config.ts}` (gitignored), which drops/creates `cvsrs_test` on the scratch cluster and runs `scripts/db.ts applyAll` (bootstrap shim + 0000–0034).

| Check | PG 15.18 | PG 17.10 | Label |
|---|---|---|---|
| bootstrap + all 35 migrations apply | PASS | PASS | local |
| full DB suite (`tests/db`, 20 files) | 334/335 PASS | 334/335 PASS | local |
| the 1 failure | `integrity-0034` SUP-01 test calls `reset()`, whose safety guard refuses a cluster other than `.local/pgdata` — harness artifact, not a version incompatibility | same | local |
| `supabase/bootstrap.sql` → `supabase/install/fresh-install.sql` (psql 18 client, `ON_ERROR_STOP=1`) | PASS | PASS | local |
| `supabase/install/verify.sql` | 18 PASS, 2 INFO | 18 PASS, 2 INFO | local |
| re-running `fresh-install.sql` | refused: "schema_migrations already has 35 row(s)" (intended guard) | same | local |

Still not proven: Supabase's own roles/extension packaging/GoTrue/PostgREST (the bootstrap shim stands in for them) — **[live]** pending.

## 2026-10-04 — iteration 3 (orchestrator, claude-opus-5-5)

Environment: Windows 11, Node 24.16, npm 11.6.3, Docker 29.5.2, Supabase CLI 2.119.0 (local stack: PostgreSQL 17, GoTrue v2.197, PostgREST v16.4, Mailpit 1.31), Playwright 1.63 / Chromium 153. Tree: `master` @ `0e1c4a7` + uncommitted work (not committed: the user did not ask). Labels as above; **[local-supabase]** = executed against the local Supabase stack (real Auth/PostgREST, not a hosted project).

| Check | Result | Label |
|---|---|---|
| Baseline before edits: `npm run test:all` | exit 0 — unit 61 files/498, DB 22/366, matrix 287 | local |
| `npx supabase start` (fresh stack) | all 39 migrations 0000–0038 applied; ledger `supabase_migrations.schema_migrations` = 39 rows | local-supabase |
| `supabase/install/verify.sql` on the stack | 18 PASS, 2 INFO (secret not provisioned; no organizations) | local-supabase |
| `npx supabase db push --db-url <local> --dry-run` | "Local database is up to date" | local-supabase |
| `npm run db:install-sql -- --check` | up to date (39 migrations) | local |
| `npm run dev` | Docker check, `migration up` (0 pending), secrets + worker login, Next ready; HTTP: public pages 200, `/api/v1/health/ready` 200, `/children` and `/clinic` 307 → /sign-in, `/api/v1/me` 401 | local-supabase |
| Direct GoTrue `/auth/v1/signup` with the publishable key | 8 and 11 chars → 422 `weak_password`; 12 → created (probe account removed) | local-supabase |
| `npm run test:e2e` (01–03) | 11/11 passed (sign-up + confirmation through the PKCE callback with exact redirect URLs, unconfirmed refusal, wrong password, sign-out, password reset by email, enumeration-safe reset, F49, `setup:first-staff --hosted` refusals and success, TOTP enrolment, aal1 API refusal, staff application → accept → second-person approval, accepter cannot approve in UI or API, nurse boundaries) | local-supabase |
| After the sandbox removal and fixes: `npm run test:all` | exit 0 — unit 61/478, DB 22/367 (new revoke test), matrix 287 | local |
| `npm run build` | exit 0; `tsconfig.json` unchanged | local |
| axe-core 4.13 (wcag2a/aa, 21aa, 22aa) on `/`, `/sign-in`, `/sign-up`, staff sign-in, staff create-account, forgot-password, `/verify/<bogus>` at 375×800 and 1280×900 | 0 violations; no horizontal overflow; no console errors; small targets only inline sentence links (2.5.8 exception) | local-supabase |
| `npm audit --omit=dev` | 0 vulnerabilities (after removing the unused `shadcn` package); dev-only: 5 high via `eslint-config-next` → `braces` (accepted) | local |

Not proven by these: a hosted Supabase project, TLS/production cookies, real SMTP, Redis store, deployed worker, hosted CI (no remote), Supabase restore, manual accessibility, real devices.

### 2026-10-04 (later) — after the clinical journey, independent review and fixes

| Check | Result | Label |
|---|---|---|
| `npm run test:e2e` (01–05) | **20/20 passed** (4.3 min): accounts, first staff + TOTP, staff application, clinical first visit (privacy notice → master data → fictional test schedule approved by a second person → stock receipt → child registration → identity + guardian verification → booking → check-in/call/start → dose from the received lot, stock 10 → 9 → visit finished → certificate PDF → public verify signed out; second family isolated), axe on 21 signed-in screens at 375 and 1280 px: 0 violations, no horizontal scroll | local-supabase |
| Migration 0039 (bootstrap refuses unconfirmed email in SQL) | applied by `supabase migration up`; E2E 02 asserts CV422 from the function itself; `tests/db/integrity-0034` 19/19 | local-supabase, local |
| `npm run test:all` | exit 0 — unit 61/482, DB 22/367, matrix 287 | local |
| `npm run db:install-sql -- --check` | up to date (40 migrations) | local |
| `npm run build` | exit 0; also with `npm run dev` serving (dev kept answering 200) | local |
| `npm audit --omit=dev` | 0 vulnerabilities | local |
| `npx tsx scripts/setup-first-staff.ts --hosted` with a non-TLS remote URL | refused before connecting | local |
| `npm run dev` with a privileged key in `.env.development.local` (temporary file, removed) | refused with the file and key named | local |

## 2026-10-06 — iteration 4 baseline (orchestrator, claude-opus-5-5), before any edit

Environment: Windows 11, Node 24.16, npm 11.6.3, Docker 29.5.2, Supabase CLI 2.119 (isolated E2E stack), Playwright 1.63 / Chromium. Tree: `master` @ `0e1c4a7` + 341 uncommitted entries (154 tracked files, +6,271/−1,895).

| Check | Result | Label |
|---|---|---|
| `npm run typecheck` | exit 0 | local |
| `npm run lint` | exit 0 | local |
| `npm run test:unit` | 61 files, 482 passed | local |
| `npm run test:db` | 22 files, 367 passed (fresh `cvsrs_test`) | local |
| `npm run matrix:check` | exit 0 | local |
| `npm run db:install-sql -- --check` | exit 0 (up to date) | local |
| `npm run test:e2e` | 20/20 passed (7.7 min) | local-supabase |

No pre-existing failures.
