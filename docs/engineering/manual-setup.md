# Manual Supabase setup (operator procedure)

Status 2026-10-04: the database install (all migrations via the Supabase CLI ledger, `verify.sql` 18 PASS / 2 INFO), the Auth settings in §3, first staff (§7) and smoke tests 3–5 have been **executed on a local Supabase stack** (CLI 2.119, PostgreSQL 17, GoTrue v2.197: `npm run dev`, `npm run test:e2e`). **No hosted project has received these steps yet**; anything marked [live] still needs that evidence. Labels: **[static]** derived from source/docs only · **[local]** executed on project-local PostgreSQL 18.2 + `supabase/bootstrap.sql` shim (not Supabase; no GoTrue, PostgREST, Storage or Dashboard) · **[live]** must be checked on the real project. Compatibility evidence: `docs/engineering/discovery/supabase-compat.md`.

## 1. Prerequisites

- A **new, empty** Supabase project (any region). Note the project ref, the database password, and the PostgreSQL major version shown under Settings → Infrastructure. CVSRS has only been executed on PostgreSQL 18.2; Supabase runs 15 or 17 (SUP-03). [static]
- Extensions: nothing to click. `fresh-install.sql` creates `pgcrypto`, `pg_trgm`, `unaccent` in schema `extensions`. If you prefer the Dashboard (Database → Extensions), enable those three **with schema `extensions`**, never `public` (the install refuses other schemas). [local for the refusal; live for the Dashboard]
- Do not add `private` (or any schema other than the defaults) to Settings → API → Exposed schemas. Only `public` RPCs are meant to be reachable. [static]
- Tools on the operator workstation for secret steps: `psql` (any 15+ client) and the **direct** or **session-pooler** connection string from Dashboard → Connect. [live]

## 2. Database

Follow `supabase/install/README.md`:

1. Section A: SQL Editor → paste `supabase/install/fresh-install.sql` → Run. (About 650 KB; the editor's size/timeout limits are unknown. Alternatives: psql `-f`, or section C one file at a time.)
2. Paste `supabase/install/verify.sql` → Run. Expect 18 `PASS` and 2 `INFO` (render secret not provisioned; no organizations yet). [local]
3. `notify pgrst, 'reload schema';` (already sent by the install; repeat if RPCs return PGRST202).

Upgrades later: section B of the same README (backup first, apply only versions missing from `supabase_migrations.schema_migrations`, one transaction per file with its history row).

## 3. Auth settings (Dashboard → Authentication)

Derived from `src/app/auth/**`, `src/app/account/**`, `src/lib/auth/**`. [static; all live-unverified]

| Setting | Value | Why (code) |
|---|---|---|
| URL Configuration → Site URL | `CVSRS_PUBLIC_URL` (one HTTPS origin, no path) | `src/lib/env.ts` canonical origin; the callback rejects other origins in production |
| URL Configuration → Redirect URLs | `https://<host>/auth/callback?next=/account/reset-password` | `recovery-request-form.tsx` `redirectTo`. Supabase matches these as globs; confirm exact-URL matching with query strings works [live] |
| Providers → Email | enabled; **"Confirm email" off** | new accounts must be automatically confirmed and signed in immediately; signup must not send verification or confirmation emails |
| Email Templates (Reset password) | **keep the default that uses `{{ .ConfirmationURL }}`** | `auth/callback/route.ts` only exchanges a PKCE `?code=` (`exchangeCodeForSession`). It does **not** handle `token_hash`/`verifyOtp`; a `{{ .TokenHash }}` template would always land on `/sign-in?auth=link-error`. Recovery links must be opened in the same browser that requested the reset (SUP-05) |
| Multi-Factor → TOTP | enabled (enroll + verify) | `account/security/mfa-panel.tsx` uses `mfa.enroll({ factorType: "totp" })`, `challengeAndVerify`, `getAuthenticatorAssuranceLevel`. Staff capabilities require `aal2` because `private.settings.require_staff_mfa = true` (`private.mfa_ok()` reads `auth.jwt() ->> 'aal'`) |
| Password minimum length | **12 or more** (at least `PASSWORD_MIN_LENGTH` in `src/lib/auth/password-policy.ts`) | sign-up is checked in the app's route, but anyone can call Supabase `signUp` directly with the public key, and password reset and the Account page call `updateUser` from the browser. The Supabase setting is the only enforcement on those paths (RV2-A-06, audit F49). **Release gate:** a direct `signUp` with an 8-character password must be refused |
| Leaked password protection | on | same reason; refuses passwords known from breaches |
| Secure password change | on | the Account page (`src/app/account/account-forms.tsx`) changes the password on the current session; this setting makes a session that is not recent sign in again first |
| SMTP | a real sender for password recovery before go-live | Supabase's built-in sender is rate limited and for testing only; signup does not require email delivery |

Deleting a user from Authentication → Users fails once that user has a profile: `public.profiles.id` references `auth.users(id) on delete restrict` (0001). Suspend access through staff membership revocation instead. [static]

## 4. Environment variables (from `.env.example`)

| Variable | Runtime | Value / source |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | web (build + run) | `https://<ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web (build + run) | Settings → API Keys → publishable (anon) key |
| `CVSRS_PUBLIC_URL` | web | canonical HTTPS origin; same as Site URL |
| `CVSRS_RATE_LIMIT_URL`, `CVSRS_RATE_LIMIT_TOKEN` | web | Redis REST store with EVAL; missing = protected requests unavailable |
| `CVSRS_TRUSTED_CLIENT_IP_HEADER` | web | **Required in production** (ConfigError → 503 otherwise) unless the opt-in below is set: the header name your ingress overwrites on every request with the real client IP (direct origin access blocked). Pattern `^[a-z0-9][a-z0-9-]{0,63}$` |
| `CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET` | web | blank, or `1` to run without a client address (public routes share 20× the route limit; signed-in users still limited per user). Not recommended |
| `CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS` | web | blank = 43200 (12 h); 300–2,592,000. Clinic policy decision; align with Supabase session time-box |
| `NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES` | web (**build time**) | blank = 15; `0` disables; 2–720. Clinic policy decision; rebuild after changing |
| `CVSRS_CERTIFICATE_RENDER_SECRET` | web | 32+ random bytes (64 hex); same value in the database (step 5) |
| `CVSRS_WORKER_DB_URL` | worker only | login with membership in `cvsrs_outbox_worker` (step 6) |
| `SMS_PROVIDER`, `SMS_WEBHOOK_SECRET`, `CVSRS_SMS_WEBHOOK_DB_URL` | worker / web | leave SMS off (`none`) until a real adapter exists |

Never set the service-role/secret key or the `postgres` password in the web or worker runtime. `.env.example` is the authoritative list. [static]

## 5. Certificate render secret

The README requires a parameterised statement and no literal secret in console history. The SQL Editor cannot bind parameters and keeps query history, so use psql (variables are interpolated from stdin, not from `-c`): [live]

```bash
echo "insert into private.certificate_render_secrets (id, secret) values (true, :'secret') on conflict (id) do update set secret = excluded.secret;" \
  | psql "<direct connection string>" -v ON_ERROR_STOP=1 -v secret="$CVSRS_CERTIFICATE_RENDER_SECRET"
```

Rerun `verify.sql`: row 19 becomes `INFO provisioned`.

## 6. Worker and webhook logins

0028 creates the non-login groups `cvsrs_outbox_worker` (execute `private.process_outbox`, `claim_sms`, `mark_sms`; 0037 adds `private.run_daily_maintenance`, which closes past service days and queues reminders at most every ten minutes) and `cvsrs_sms_webhook` (execute `private.record_sms_event`). Create one login per runtime, password from the secret manager, via psql stdin as above: [live]

```bash
echo "create role cvsrs_worker_login login password :'pw' in role cvsrs_outbox_worker;" \
  | psql "<direct connection string>" -v ON_ERROR_STOP=1 -v pw="$WORKER_DB_PASSWORD"
```

Same pattern with `cvsrs_sms_webhook` for the optional webhook login. Unknown until live: whether custom login roles connect through the Supavisor pooler (user `cvsrs_worker_login.<ref>`), IPv4 availability of the direct host, and the TLS mode `pg` needs (`sslmode=require` with Supabase's CA). Run `npm run worker -- --once` from the worker host as the first test.

## 7. First organization, clinic and staff (SUP-02)

On an empty database nobody can make the first grant through the app: `request_staff_membership` → `approve_staff_membership` need an existing active holder of `admin.users` or `grant.approve.clinical`, and a different approver. Migration `0034_integrity_performance.sql` therefore adds an operator-only, one-time bootstrap: `private.bootstrap_initial_staff(org_name, clinic_name, timezone, admin_email, lead_email)`. No API role (`anon`, `authenticated`, `service_role`) can execute it; only the database owner (`postgres` in the SQL Editor) can.

1. Decide, outside the system, who the first technical administrator and the first clinical lead are, and record that decision (who decided, when). The function records what was done, not who approved it.
2. Both people sign up through the app (`/sign-up`) and receive immediate signed-in access without an email confirmation step. Auth automatically confirms their accounts; the `on_auth_user_created` trigger creates their `public.profiles` rows. [static]
3. Dashboard → **SQL Editor** → run (replace the four strings; the timezone must be a valid IANA name):
   ```sql
   select private.bootstrap_initial_staff(
     'Municipal Health Office',      -- organization name
     'Main Health Center',           -- first clinic name
     'Asia/Manila',                  -- clinic timezone
     'tech.admin@example.org',       -- becomes tech_admin (admin.users, admin.config)
     'clinical.lead@example.org'     -- becomes clinical_lead (clinical capabilities incl. grant.approve.clinical)
   );
   ```
   It returns `{"organizationId": …, "clinicId": …, "techAdminMembershipId": …, "clinicalLeadMembershipId": …}`. In one transaction it creates the organization, the clinic, and two `active` memberships, each approved by the other person (the two-person check on `staff_memberships` holds), and writes one `staff.bootstrap` audit row (`system_job_id = 'system'`) naming both people. [local]
4. It refuses, changing nothing:
   - with `CV409` when any `active` or `pending_approval` staff membership already exists (it is for the very first grants only; later grants use the app);
   - with `CV422` when either email has no active signed-up account, both emails are the same person, or a name is blank.
5. Both people sign in, enrol two-step sign-in (staff capabilities require `aal2`), and continue in the app: clinic profile, privacy notice, schedule, and further staff through the two-person request/approve flow (README "Getting to first use").

`npm run setup:first-staff` wraps this function: it targets the local stack by default, or a hosted project with `--hosted` and `CVSRS_OWNER_DB_URL` set in the shell. Create both accounts before running it, with the automatic-confirmation Auth setting above. [local, exercised by tests/e2e/02-first-staff.spec.ts]

## 8. Smoke tests after setup [live]

1. `verify.sql`: 18 PASS + 2 INFO; after step 5, row 19 reads "provisioned".
2. Anonymous: home page lists clinics (`list_public_clinics`); `/rest/v1/children` with the publishable key returns no rows/permission error.
3. Sign up a test guardian → lands on `/children` signed in immediately; `public.profiles` has the row and Auth has automatically confirmed the account. No verification or confirmation email is sent.
4. Forgot password → link → `/account/reset-password` → new password works.
5. Staff account: enroll TOTP in `/account/security`, sign out/in, confirm `get_my_context` reports `mfa: true` and clinic actions work; without aal2 the same actions are refused.
6. PostgREST request id: perform any command and confirm an audit row carries the request id sent as `x-request-id` (Audit page).
7. Worker: `npm run worker -- --once` with `CVSRS_WORKER_DB_URL` set to the worker login prints the JSON counters (never point it at the `postgres` login).
8. Certificate: issue, download, and verify via the public QR page on the canonical origin.
9. Record what passed in `docs/implementation/verification.md` with the project ref and date; until then known-limitations L1 stays open.
