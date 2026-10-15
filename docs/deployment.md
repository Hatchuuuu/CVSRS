# CVSRS production deployment overview

This page describes the runtime architecture and the services a production deployment needs. The authoritative, step-by-step operator procedure (Supabase project, SQL Editor install, Auth settings, secrets, first staff, smoke tests) is [engineering/manual-setup.md](engineering/manual-setup.md); the database install package is [../supabase/install/README.md](../supabase/install/README.md). `.env.example` is the authoritative list of environment variables. Release gates and open evidence live in [engineering/plan.md](engineering/plan.md) and [engineering/audit.md](engineering/audit.md).

Nothing here has been deployed to a hosted environment yet. Local schema, Auth, first-staff provisioning and staff approval evidence is recorded in [engineering/verification.md](engineering/verification.md). The required signup policy is automatic confirmation and immediate signed-in access without verification or confirmation email; password recovery and staff TOTP MFA remain enabled. Items marked *live* still need evidence from the hosted project.

## 1. Architecture

1. **Next.js web application** (Node.js runtime, stateless):
   - Authenticates users with Supabase session cookies (`Secure` in production, `SameSite=Lax`, bounded `Max-Age`); the proxy refreshes sessions and sets a per-request CSP nonce.
   - Rejects cross-origin mutations (exact `Origin` match against `CVSRS_PUBLIC_URL`) and requires an `Idempotency-Key` on every API mutation.
   - Calls Supabase PostgREST RPC with the **publishable key only**. Authorization is enforced in PostgreSQL (RLS plus `SECURITY DEFINER` command functions with capability checks); the API's own allowlist and validation are defence in depth, not the security boundary.
   - Enforces shared rate limits through a Redis REST store (`CVSRS_RATE_LIMIT_URL` / `_TOKEN`), keyed per trusted client address before authentication and per user after it.
   - Renders and attests certificate PDFs with `CVSRS_CERTIFICATE_RENDER_SECRET` (same value stored in `private.certificate_render_secrets`).
2. **Outbox worker** (separate process, required): `npm run worker` (daemon) or `npm run worker -- --once` (scheduled). Connects with `CVSRS_WORKER_DB_URL`, a login that is a member of `cvsrs_outbox_worker`, which can execute only `private.process_outbox`, `private.claim_sms` and `private.mark_sms` and has no table privileges. The web process never polls the outbox in production.
3. **Optional SMS delivery-receipt webhook** (`/api/v1/webhooks/sms`): HMAC-SHA256 over the raw body with `SMS_WEBHOOK_SECRET`, verified before any rate-limit charge; writes through `CVSRS_SMS_WEBHOOK_DB_URL`, a login that is a member of `cvsrs_sms_webhook` (execute on `record_sms_event` only). No real SMS provider adapter ships yet; keep `SMS_PROVIDER=none`. Production rejects the `sandbox` provider.

## 2. Environment variables

| Variable | Runtime | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web (build + run) | yes | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web (build + run) | yes | publishable (anon) key only — never the service-role/secret key |
| `CVSRS_PUBLIC_URL` | web | yes (production) | canonical HTTPS origin; must equal the Supabase Auth Site URL |
| `CVSRS_RATE_LIMIT_URL`, `CVSRS_RATE_LIMIT_TOKEN` | web | yes (production) | Redis REST endpoint supporting EVAL; when unreachable, anonymous abuse-sensitive routes fail closed (503) and signed-in routes degrade to per-instance limits |
| `CVSRS_TRUSTED_CLIENT_IP_HEADER` | web | yes (production), unless the opt-in below | header your ingress overwrites on every request with the real client IP; block direct origin access |
| `CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET` | web | no | `1` = explicit opt-out of client addressing (public routes share a larger per-route allowance) |
| `CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS` | web | no | default 43200 (12 h); clinic policy decision |
| `NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES` | web (build time) | no | default 15, `0` disables; clinic policy decision |
| `CVSRS_CERTIFICATE_RENDER_SECRET` | web | yes (to issue certificates) | ≥ 32 random bytes; mirror into the database (manual-setup §5) |
| `CVSRS_WORKER_DB_URL` | worker only | yes (worker) | restricted login (manual-setup §6) |
| `SMS_PROVIDER`, `SMS_WEBHOOK_SECRET`, `CVSRS_SMS_WEBHOOK_DB_URL` | worker / web | no | keep SMS off until a provider adapter and contract test exist |

Missing required production configuration fails closed (HTTP 503 with a generic message; details only in server logs). Supabase Auth is the only identity source; there is no local or demo sign-in mode to fall back to.

## 3. Ingress and proxy requirements

1. Pass the browser's `Origin` header through unchanged; terminate TLS and redirect HTTP to HTTPS (HSTS is sent by the app).
2. Overwrite the configured client-IP header on every request and strip any client-supplied copy; block direct access to the origin. Never configure `x-forwarded-for` unless your platform guarantees it is rewritten.
3. Do not cache HTML: every document carries a fresh CSP nonce.

## 4. Operations

- Health: `GET /api/v1/health` is liveness (the process answers). `GET /api/v1/health/ready` is readiness: 200 `{"status":"ready"}` only when configuration is valid and the database answers one anonymous call within 2 s, otherwise 503 `{"status":"unavailable"}` (reason in the server log as `readiness_failed`). Point load-balancer health checks and uptime alerts at `/ready`. Authenticated smoke tests are listed in manual-setup §8.
- Worker logs are one JSON line per pass: `{"event":"worker_pass", done, cancelled, retry, failed, sms, maintenance}`, or `{"event":"worker_pass_failed", code, consecutiveFailures}` when a pass could not run (for example the database was unreachable). The daemon keeps going after a failed pass, retrying with a backoff of up to 2 minutes, and stops after the current pass on SIGINT/SIGTERM; `--once` exits 1 when its pass failed. Alert on `worker_pass_failed` with `consecutiveFailures` ≥ 3, on sustained `failed > 0`, or on growing `retry`.
- API denials (401/403/429/503) are logged as `{"event":"api_denied",...}` with a request id; alert on 503 bursts (configuration or rate-store outage).
- Backups: enable Supabase PITR; rehearse restore including `private` schema documents, audit log and the render secret (*live*).

## 5. Release runbook (checklist)

Run in order; record each result (date, who, project ref, outcome) in `docs/engineering/verification.md`. Stop at the first failure.

**Before the release**
1. `npm ci` (lockfile unchanged), `npm run test:all`, `npm run test:e2e`, `npm run build`. All must pass on the commit being released (CI runs all four on Ubuntu, Node 22).
2. Clinical leads have approved the real schedule and product mappings; the privacy officer has supplied the privacy notice, privacy policy and terms (docs/implementation/external-validation.md). The system ships none of these.
3. Platform chosen and provisioned: Node runtime for the web app, a separate persistent or scheduled worker, the Supabase project, a Redis REST store with EVAL, TLS on the canonical origin, and a secret manager.

**Database (Supabase)**
4. Back up first (PITR point or `pg_dump` over the direct connection). Never migrate without a restorable copy.
5. Apply migrations: `npx supabase db push --db-url "<direct connection string>"` applies only versions missing from `supabase_migrations.schema_migrations`; add `--dry-run` first to see the list. A brand-new project can instead use `supabase/install/fresh-install.sql` (supabase/install/README.md). Never apply `supabase/bootstrap.sql`.
6. Run `supabase/install/verify.sql`: every row `PASS` or `INFO`.
7. Auth settings (Dashboard → Authentication), matching `supabase/config.toml`: Site URL = `CVSRS_PUBLIC_URL`; the exact password-recovery redirect URL from `.env.example`; **Confirm email off** (automatic confirmation and immediate signup access, without verification or confirmation email); minimum password length 12; secure password change on; TOTP enroll + verify on; plus the hosted-only settings: leaked-password protection on and a real SMTP sender for password recovery.
8. Secrets: certificate render secret into `private.certificate_render_secrets` (manual-setup §5); worker login in `cvsrs_outbox_worker` and, only if SMS receipts are enabled, a webhook login in `cvsrs_sms_webhook` (manual-setup §6). Never give the web or worker runtime the service-role key or the `postgres` password.

**Application**
9. Web runtime environment per section 2 (`.env.example` is authoritative). `NEXT_PUBLIC_*` values are build-time: build with the production values.
10. Deploy the web app; deploy the worker with only `CVSRS_WORKER_DB_URL` (`npm run worker`, or `npm run worker -- --once` on a schedule of at most one minute).
11. First use on an empty project: the first technical administrator and clinical lead sign up with immediate access and no email confirmation step, then the operator, on a trusted workstation, runs `read -rs CVSRS_OWNER_DB_URL && export CVSRS_OWNER_DB_URL` (paste the direct connection string with `?sslmode=verify-full&sslrootcert=<project CA certificate>`; the hidden prompt keeps it out of shell history) and `npm run setup:first-staff -- --hosted --org ... --clinic ... --timezone Asia/Manila --admin ... --lead ...` (manual-setup §7). The script refuses a non-TLS connection. Both enrol TOTP at first staff sign-in.

**Smoke tests (on the deployed origin)**
12. `/api/v1/health/ready` → 200; landing page lists the clinic; `/api/v1/me` signed out → 401.
13. Family sign-up → lands on `/children` signed in immediately, with an automatically confirmed Auth account and no verification or confirmation email; password reset round trip using the real sender; a direct Auth `signUp` with an 11-character password is refused (`weak_password`).
14. Staff: sign-in demands TOTP before any clinic page; an application is accepted and approved by a second person; the accepter cannot approve.
15. Worker: `npm run worker -- --once` prints counters with no `failed`; a booking produces an in-app message.
16. Certificate: issue, download, and verify via the public QR page on the canonical origin.
17. Monitoring receives `readiness_failed`, `api_denied` bursts and worker failures (section 4).

**Rollback and roll-forward**
- Application: redeploy the previous build. The schema is forward-compatible within a release only when no migration in it renamed or dropped a function the old build calls (see the "irreversible steps" table in supabase/install/README.md); check before rolling back.
- Database: migrations are not reversed by script. Fix forward with a new migration, or restore the backup/PITR point from step 4 (roles and data together) and redeploy the matching build. A restore drill on the hosted project has not been rehearsed yet (*live*).
