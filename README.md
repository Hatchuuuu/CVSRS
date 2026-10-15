# CVSRS — Children's Vaccination Scheduling and Records System

A working clinic system: registration and guardian verification, booking, arrival queue, vaccine stock ledger with transfers and cold-chain logs, signed vaccination recording with corrections, certificates with a public authenticity check, in-app messages (optional SMS pipeline), reports, follow-up lists, catch-up plans, record transfer, and a schedule engine driven by **your clinic's own approved schedule**. It ships no clinical rules, no sample patients and no built-in accounts.

Read `docs/implementation/status.md` for exactly what is built, what has been verified, and what is still open. The [2026-10-14 local recheck](docs/audit/2026-10-14-local-recheck.md) records fresh passing results, including all 51 browser cases together, and the remaining normal-clinic configuration and human accessibility requirements.

The latest [system stabilization audit](docs/audit/2026-10-14-system-stabilization.md) records corrective migrations through 0049, local credential/log isolation, authentication hydration, accessibility and motion fixes, targeted dependency patches, and final regression evidence. Local certificates use the running app's origin even when hosted settings exist in the shell; privileged credentials stay outside local web runtimes. Supabase's Docker ports currently bind beyond loopback: verify firewall/LAN containment before shared-network use. The report also records the unresolved development-only braces advisory.

## Requirements
- Node.js ≥ 22 and npm.
- **Docker Desktop**, running (local development and browser tests run a real local Supabase stack: Auth, PostgREST, PostgreSQL and a test inbox). On Windows it needs WSL 2.
- About 4 GB of free disk for the Supabase images (downloaded once by the first `npm run dev`).

## Run it locally

```bash
npm install
npm run dev
```

`npm run dev` checks Docker, starts the local Supabase stack if it is not running (the first start downloads its images), applies any migration not yet recorded in the stack's migration ledger (it never resets data), provisions two local-only secrets in the ignored `.local/dev-secrets.json` (the certificate signing secret and a least-privilege worker login), and starts the app with the outbox worker at **http://localhost:3000**. It prints:

| | |
|---|---|
| App | http://localhost:3000 |
| Staff sign-in (unlisted) | http://localhost:3000/evactrackstafflogin |
| Test inbox (password-reset emails) | http://127.0.0.1:54324 |
| Supabase Studio | http://127.0.0.1:54323 |

Sign-in is real: accounts need a password of at least 12 characters. New accounts are automatically confirmed and signed in immediately, without a verification or confirmation email. Staff must still set up two-step sign-in with an authenticator app. Nothing is pre-loaded: the first use is set up as below. Ctrl+C stops the app; the Supabase stack keeps running for a fast restart (`npm run dev:stop` stops it, data is kept). `npx supabase db reset` deletes all local data and starts over.

Local web startup commands bind to `localhost`, so the application is accessible only on this laptop. Docker Desktop must finish starting its Linux engine before `npm run dev` can work; a successful frontend build does not substitute for that service.

To develop against a hosted Supabase project instead, put its settings in `.env.local` (see `.env.example`) and run `npm run dev:next`.

## Class presentation (normal application)

The [vaccination-card and staff-account walkthrough](docs/operations/vaccination-card-and-staff-accounts.md) covers manual card entry, local photo OCR, clinical review, BHW patient search, staff notes, and administrator-created accounts with role approval.
Use `npm run dev` and **http://localhost:3000** with saved Supabase accounts and the normal local database. All existing roles participate; the developer uses the existing **Technical administrator** role. The separate presentation launcher is removed. On this laptop, the user requested seven named example profiles and a linked example child record; no vaccination history or clinical rules were fabricated. Follow [the classroom walkthrough](docs/operations/classroom-walkthrough.md) to configure the clinic and exercise the existing workflow. Private account details are in ignored `.local/local-login-credentials.json`, never in this guide or on the projector. Automated tests retain their separate disposable environment and synthetic fixtures. Current results: [normal-account audit](docs/audit/2026-10-14-normal-accounts-and-flow.md).

## Getting to first use (in this order)
Nothing can be granted through the app on an empty system, so the first two staff are set up by the operator:

1. Decide who the first **technical administrator** and **clinical lead** are, and record that decision. Each creates an account at `/sign-up`; access starts immediately without an email confirmation step.
2. Run once (local stack; for a hosted project see `docs/engineering/manual-setup.md` §7):
   ```bash
   npm run setup:first-staff -- --org "Municipal Health Office" --clinic "Main Health Center" --timezone Asia/Manila --admin <admin email> --lead <lead email>
   ```
   It creates the organization, the first clinic and the two staff, each approved by the other, writes one audit row, and refuses missing accounts or a second run.
3. Both sign in at the unlisted `/evactrackstafflogin` and set up two-step sign-in; clinic records stay closed until they do.
4. **Technical administrator**: Settings → clinic contact, opening hours and time zone; Clinical setup → publish the privacy notice your privacy officer approved (families accept it before adding a child); Clinical setup → add antigens and vaccine products, which a **clinical lead** activates.
5. **Clinical lead** imports and approves the clinic's schedule: see `docs/operations/schedule-import.md`. Without one the app works but shows no calculated dates.
6. More staff: each creates an account at `/evactrackstafflogin/create-account` (share the address directly; no public page links to it), which files an **application** to one health center for one role. The **Admin console** (`/clinic/<clinic>/admin`) lists applications: accepting files the access request, and a **second person** approves it before access starts (clinical roles by a clinical lead); a decline needs a reason, which the applicant sees.
7. **Inventory clerk**: Vaccine stock → add a location (e.g. fridge), register the lot, receive stock. Only that role receives stock, and the first two staff do not have it: grant it early under Staff access (one person requests, another approves; one person may hold it alongside a clinical role). **Assistant**: Today → create a session; Find or register → register children.
8. Families sign up, add or link their child, and the clinic verifies them. Nurses record vaccinations from the child's page during an open visit.
9. **Clinical lead**: Vaccine stock → Cold chain → record the limits from your cold-chain policy; Questions and plans → write the safety notice before turning on family questions; Care information → publish approved wording (needs a second person).
10. **Operations**: run the worker (see below), take backups, record restore drills under Settings and operations. Certificates, SMS and reports need the decisions listed in `docs/implementation/external-validation.md`.

## Tests
```bash
npm run test:all      # typecheck, lint, unit, database (real role switches on a disposable cluster), matrix check
npm run test:e2e      # browser journeys on real Supabase Auth (needs Docker)
npm run build         # production build
```
`npm run test:db` rebuilds the disposable `cvsrs_test` database on a project-local PostgreSQL cluster (port 54329; binaries come from the `embedded-postgres` dependency, or `PG_BIN`). `npm run test:e2e` uses its own Supabase stack (`.local/e2e`, ports 55320–55329 and 9083, app on port 3100), resets it on every run and never touches development data; every account it creates is synthetic.

## Messages and the worker
Booking, cancellation, recorded-vaccination and certificate events are turned into in-app messages by a bounded outbox worker. Production web processes never start the poller. Deploy `npm run worker` separately on a persistent runtime, or schedule `npm run worker -- --once` at the desired delivery interval. Give its database login membership in `cvsrs_outbox_worker` and set `CVSRS_WORKER_DB_URL` only in that worker environment. Development may poll locally. Set `CVSRS_PUBLIC_URL` so certificate QR codes point at your public address.

Certificate issuance also requires `CVSRS_CERTIFICATE_RENDER_SECRET` in the server runtime and the identical secret in the database's `private.certificate_render_secrets` singleton row. Generate a fresh random 32-byte or longer value (64 hex characters works), store it in the deployment secret manager, then provision the database row through a privileged maintenance connection using a parameterized statement: `insert into private.certificate_render_secrets (id, secret) values (true, $1) on conflict (id) do update set secret = excluded.secret`. Pass the secret as parameter `$1`; do not put its literal value in migrations, source control, logs, or a SQL console history. The web server's database role does not need table access. If either side is missing or mismatched, certificate storage fails closed and pending certificates can be retried after configuration is fixed. Coordinate secret rotation across server and database; an in-flight render may need retry. This setup has only been exercised against disposable local PostgreSQL, not a live Supabase project.

## Operations commands
```bash
npm run worker -- --once     # deliver queued in-app messages once in the separate worker runtime
# SMS_PROVIDER=sandbox is development/test only; production rejects simulated delivery
npm run drill:restore        # dump, restore and verify a local database copy
npm run perf                 # measure search/report speed on 20,000 synthetic children
```
See `docs/operations/runbook.md` (daily routine, backups, incidents) and `docs/operations/training.md`.

## Supabase (staging/production)
Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the canonical HTTPS `CVSRS_PUBLIC_URL` (see `.env.example`). Apply the migrations with the Supabase CLI, which records each one in the project's migration ledger and applies only missing ones (`npx supabase db push --db-url <direct connection string>`; take a backup first), or with `supabase/install/fresh-install.sql` on a brand-new project; never apply `supabase/bootstrap.sql` (local test shim). Copy the Auth settings from `supabase/config.toml` (password minimum 12, **Confirm email off** for automatic confirmation and immediate signup access, secure password change, TOTP), plus leaked-password protection and a real SMTP sender for password recovery. Allow the exact password-recovery `/auth/callback?next=/account/reset-password` redirect shown in `.env.example`. Set up the first staff with `npm run setup:first-staff -- --hosted ...` (`docs/engineering/manual-setup.md` §7). There is no other sign-in path, and the app never needs the service-role key. Local verification evidence is recorded in `docs/engineering/verification.md`; a hosted project has not been set up yet (`docs/implementation/known-limitations.md` L1).

Set server-only `CVSRS_RATE_LIMIT_URL` and `CVSRS_RATE_LIMIT_TOKEN` for a Redis REST store supporting atomic EVAL; production refuses requests without them. Signed-in users are limited per user and route; before sign-in, requests are limited per client address. Production also requires `CVSRS_TRUSTED_CLIENT_IP_HEADER`, naming a client-address header that your ingress overwrites on every request (with direct origin access blocked), or the explicit opt-in `CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET=1`, under which public routes share one larger allowance per route; without either, the service reports itself as not configured. Sign-in and sign-up are limited per client address and email, per client address, and by a high deployment-wide ceiling. If the store becomes unreachable, the first failures answer 503; once the circuit opens, sign-in, sign-up, certificate checks, guardian links, QR resolution and the SMS webhook keep answering 503, while other signed-in routes fall back to a halved per-instance limit. Session cookies are `Secure` in production, `SameSite=Lax`, `Path=/`, and expire after `CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS` (default 12 hours). They are not HttpOnly, because the browser reads the session for two-step sign-in and password reset. Staff are signed out after `NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES` without input (default 15; 0 turns it off), after a one-minute warning. The optional SMS webhook uses its own `CVSRS_SMS_WEBHOOK_DB_URL` login granted only `cvsrs_sms_webhook`; it never borrows worker credentials. Keep SMS off until a real adapter and receipt contract are validated.

Deployment verification and secret separation are recorded in [the deployment guide](docs/deployment.md). Supabase provisioning is deliberately left to the operator; compilation and local tests do not establish live readiness.

## Layout
`supabase/migrations` schema, RLS and commands · `src/lib` env/db/API/security · `src/app` pages and `/api/v1` routes · `tests/db` real-database tests (test fixtures use fictional data and are never loaded into a normal setup) · `docs/` matrix, plan, decisions, operations.
