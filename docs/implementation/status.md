# Implementation status

Updated 2026-10-14. The [fresh local recheck](../audit/2026-10-14-local-recheck.md) passes all 51 browser cases together, 592 unit tests, 427 database tests, build and upgrade/restore drills. Current normal accounts and removal of the separate launcher are recorded in [the normal-account audit](../audit/2026-10-14-normal-accounts-and-flow.md). The earlier [local verification report](../audit/2026-10-14-local-verification.md) retains source/schema/regression evidence and its historical database counts. Earlier first-use evidence remains in [the 2026-10-08 report](../audit/2026-10-08-local-readiness.md). A local pass is not a launch pass.

| Part | Status | Basis |
|---|---|---|
| Capstone flow testing (local) | See the final report in [engineering/LOOP_STATE.md](../engineering/LOOP_STATE.md) | `npm run dev` runs the real app on a local Supabase stack (real Auth, PostgREST, PostgreSQL, test inbox); `npm run test:e2e` drives the journeys in a browser |
| Deployment preparation | Prepared, not executed | [deployment runbook](../deployment.md) §5, `supabase/config.toml`, `.env.example`, CI workflow, readiness endpoint |
| Launch verification | **Not run** | No hosted Supabase project, hosting platform, Redis store, SMTP sender or monitoring exists yet |

## What is built

Registration and guardian verification, booking (family and staff), arrival queue and day closure, vaccine stock ledger with transfers, counts and cold-chain logs, signed vaccination recording with corrections, a schedule engine driven only by the clinic's own approved schedule, certificates with a public authenticity check, in-app messages and reminders through an outbox worker (optional SMS pipeline, off), reports and exports, follow-up lists, catch-up plans, record transfer within an organization, staff applications with two-person approval, clinic settings, reviewed care information, audit search and an operations page. The architecture and workflow inventory are in [system-map.md](../audit/system-map.md); the route-by-route evidence is in [engineering/coverage.md](../engineering/coverage.md).

There is one identity source: Supabase Auth. The former persona sandbox and its email-only sign-in were removed on 2026-10-04. The separate synthetic presentation launcher has also been removed at the user's request. Classroom use now follows the normal application at http://localhost:3000 with real accounts for all existing roles; the developer uses Technical administrator. The [classroom walkthrough](../operations/classroom-walkthrough.md) explains setup and verification. The application ships no accounts, patients or clinical rules; first use is provisioned with `npm run setup:first-staff` only on an empty setup (README "Getting to first use"). Automated tests retain their isolated stack and synthetic fixtures. Earlier synthetic presentation evidence does not verify the newly configured normal-account workflow.

## What is verified, and where

- Database contracts: `npm run test:db` (real role switches, fresh migrations) on a disposable PostgreSQL cluster.
- Supabase: all migrations applied by the Supabase CLI ledger on a local stack; `supabase/install/verify.sql` 18 PASS / 2 INFO.
- Browser on real Auth: `npm run test:e2e` (immediate automatically confirmed signup without confirmation email, password reset, first staff, TOTP, staff application and approval, role boundaries, and clinical workflows; see the current local-readiness report above).
- Automated accessibility scans of public and auth pages.

Not verified: a hosted Supabase project, production cookies over TLS, real email delivery, the Redis rate store, the deployed worker, Supabase backup/restore, manual accessibility with assistive technology, real devices, and clinical acceptance of a real schedule. Open items: [known-limitations.md](known-limitations.md) and [external-validation.md](external-validation.md).
