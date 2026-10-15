# Supabase compatibility review of migrations 0001–0033

Date 2026-10-01/02. Scope: every statement class in `supabase/migrations/0001..0033` that could fail or behave differently when pasted into the SQL Editor of a real Supabase project, plus the app's Auth/PostgREST dependencies relevant to setup. Packaging deliverables: `scripts/build-supabase-install.ts`, `supabase/install/{fresh-install.sql,verify.sql,README.md}`, `docs/engineering/manual-setup.md`, `tests/unit/supabase-install.test.ts`.

**Evidence levels.** *Static*: read from source. *Local*: executed on the project-local cluster (PostgreSQL **18.2**, port 54329) after `supabase/bootstrap.sql`, a shim that fakes Supabase roles, `auth.users`, `auth.uid()/jwt()/role()` and Supabase's permissive default privileges. This is **not** Supabase: no GoTrue, PostgREST, Supavisor, supautils, `supabase_auth_admin` ownership, Dashboard or SQL Editor. *Live*: requires a real project; nothing here has been run on one.

No existing migration was edited. Migrations 0025–0033 are still untracked in git; their checksums in `fresh-install.sql` are of the current working tree, and `npm run db:install-sql -- --check` will fail if they change.

## Statement-class review

| # | Class | Where | Verdict | Evidence / reasoning |
|---|---|---|---|---|
| 1 | Extensions used schema-qualified but never created: `extensions.unaccent`, `extensions.similarity`, `extensions.gin_trgm_ops` (pg_trgm), `extensions.gen_random_bytes`, `extensions.hmac` (pgcrypto) | 0003:14, 0003:78, 0003:309–494, 0003:842, 0027:48 | **Needs change → SUP-01** (handled by the installer) | `grep -i "create extension"` over migrations: no matches. Supabase enables `pgcrypto` in `extensions` by default; `pg_trgm` and `unaccent` are not enabled on a new project, so 0003 would fail. Locally only bootstrap.sql creates them. |
| 2 | `gen_random_uuid()`, `sha256()`, `encode/decode`, `convert_to` unqualified under `search_path = ''` | 0001 onward | Compatible | Built into `pg_catalog` (gen_random_uuid since PG13, sha256 since PG11). `pg_catalog` is always searched, so pgcrypto's `extensions.gen_random_uuid` is never picked. `digest()`/`crypt()` are not used. |
| 3 | `create schema if not exists private`; grants of `usage` to `authenticated`, `service_role` | 0001:12–15 | Compatible (live-check) | SQL Editor runs as `postgres`, which has CREATE on the database. `private` is not in PostgREST's exposed schemas by default; manual-setup says never expose it. |
| 4 | FK `profiles.id references auth.users(id) on delete restrict`; `create trigger on_auth_user_created after insert on auth.users` | 0001:63, 0001:82 | Compatible per Supabase's documented "managing user data" pattern; **live-check** | auth.users is owned by `supabase_auth_admin`; Supabase docs run this same FK + trigger from the SQL Editor. Trigger function `private.handle_new_user` is SECURITY DEFINER with `search_path=''`, so GoTrue (`supabase_auth_admin`, search_path `auth`) needs no grant: PostgreSQL does not check EXECUTE when firing a trigger. Side effect: Dashboard "delete user" fails once a profile exists (documented in manual-setup §3). Whether Supabase's 2025 restrictions on the `auth` schema still allow new triggers on `auth.users` must be confirmed live. |
| 5 | Reads of `auth.users` inside SECURITY DEFINER (`find_profile_for_grant`) | 0005:34 | Compatible (live-check) | Owner `postgres` has SELECT on `auth.users` on Supabase. `email`, `raw_user_meta_data` columns exist in GoTrue's schema. |
| 6 | `auth.uid()`, `auth.jwt() ->> 'aal'`, `current_setting('request.headers')`, `request.jwt.claims` | 0001, 0004 | Compatible (live-check) | The shim copies Supabase's definitions (reads `request.jwt.claim(s)`). Supabase access tokens carry `aal`. PostgREST sets `request.headers` as JSON; 0004 falls back to a random id on any parse failure. |
| 7 | `CREATE ROLE ... nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls` inside a DO block, then grants | 0028 | Compatible (live-check) | `postgres` has CREATEROLE on Supabase; none of the attributes requested need superuser (only *granting* SUPERUSER/BYPASSRLS/REPLICATION would). On PG16+ the creator gets ADMIN on the role, so it can later `grant cvsrs_outbox_worker to <login>`. Names are not in supautils' reserved list as far as known. Whether these custom login roles can connect through Supavisor is unknown (manual-setup §6). |
| 8 | `GRANT/REVOKE ... TO/FROM anon, authenticated, service_role` | all | Compatible | Roles exist on every Supabase project. Supabase's default privileges grant ALL on new `public` tables/functions/sequences to anon, authenticated and service_role; the shim mirrors this, so local tests already prove each migration revokes explicitly. `verify.sql` checks 3–11 and 18 re-check it on the live database. |
| 9 | `ALTER DEFAULT PRIVILEGES` | none | Not used | — |
| 10 | `service_role` table access | all public tables | Compatible, by design | Migrations revoke from anon/authenticated only; service_role keeps Supabase's default ALL and has BYPASSRLS. The web app never uses it (`src/lib/db/supabase.ts` uses only the publishable key). `private` tables: no service_role privilege (`verify.sql` check 7, PASS locally). |
| 11 | SECURITY DEFINER ownership | ~250 functions | Compatible | All objects are owned by the role that runs the SQL (`postgres` in the editor). Definer functions bypass RLS as table owner (no `FORCE ROW LEVEL SECURITY` anywhere). Every definer function pins `search_path=''` (verify check 8 PASS). |
| 12 | Functions without a pinned search_path | `private.capability_vocab`, `clinical_caps`, `role_preset` (0001:125/136/143) | Compatible; Security Advisor warning → SUP-06 (P3) | Pure array literals, reference no objects. Supabase's "function_search_path_mutable" lint will still list them. |
| 13 | View `public.public_clinics` (owner-rights view granted to anon) | 0001:358 | Compatible; Advisor warning | Intended curated view (P01). Supabase's "security_definer_view" lint will flag it; it exposes only id, name, address, contact, timezone of active clinics. |
| 14 | Event triggers, `pg_cron`, `pg_net`, Vault, Storage, Realtime, publications | none | Not used | grep: no matches. PDFs live in `private.certificate_documents` (bytea), not Storage. |
| 15 | Locks | 0025:72, 0026:10–12 (`pg_advisory_xact_lock`), `FOR UPDATE [SKIP LOCKED]` in function bodies | Compatible | Transaction-scoped advisory locks need no privilege. No `LOCK TABLE`. |
| 16 | Statements that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`, `ALTER TYPE ... ADD VALUE`, `VACUUM`) or psql meta-commands; top-level `BEGIN/COMMIT/SET` | none | Compatible | grep: no matches, so all 33 files concatenate into one transaction. |
| 17 | Truncate/row triggers via `execute format(...)` in DO blocks | 0011:118, 0019:275 | Compatible | Owner may create triggers on its own tables. |
| 18 | PostgreSQL version-specific syntax | all | **Unknown-requires-live-check → SUP-03** | Executed only on PG 18.2. A grep for PG16–18 features (`any_value`, SQL/JSON constructors, `MERGE`, `uuidv7`, virtual generated columns, `NOT ENFORCED`, `WITHOUT OVERLAPS`, `RETURNING OLD/NEW`, `casefold`, etc.) found nothing. |
| 19 | PostgREST exposure of RPCs | 153 public functions | Compatible (live-check) | Local query: the set of public functions `authenticated` can execute equals `RPC_ALLOWLIST` in `src/lib/db/port.ts` exactly (153/153), with no overloaded names and no unnamed arguments, so no PGRST203 ambiguity. Renamed `*_prev`/`*_base` wrappers are revoked. Only 4 RPCs are STABLE (`list_public_clinics`, `get_my_context`, `my_children`, `my_appointments`); PostgREST runs those read-only, and none of them or their helpers write. `verify.sql` check 18 enforces the allowlist on the live DB. |
| 20 | Custom SQLSTATEs (`CV400`–`CV503`) and `hint` | all commands | Compatible (live-check) | PostgREST passes `code`/`hint` through in the error body (HTTP status 400 for unknown codes); the app maps by `code` (`fromDbError`). |
| 21 | Migration history | — | Decided | `supabase_migrations.schema_migrations(version, statements, name)`, version = 4-digit prefix, statements NULL. Whether the Supabase CLI accepts 4-digit versions/NULL statements for `migration list`/`db push` is unverified (no CLI available). |
| 22 | SQL Editor limits | `fresh-install.sql` is 662,611 bytes, 731 statements | **Unknown-requires-live-check** | Fallbacks documented: psql `-f`, or one file per run (install README §C). Install time locally: ~0.75 s. `set local statement_timeout = 0` is included. |
| 23 | Session search_path in the SQL Editor | — | Compatible | The editor's search_path may include `extensions`; the install pins `set local search_path = "$user", public` so name resolution matches the local test harness. |

## Findings

### SUP-01 — Migrations require pg_trgm/unaccent/pgcrypto in schema `extensions` but never create them
- Priority: P1
- Class: Missing required behavior
- Location: supabase/migrations/0003_registry.sql:14, 0003_registry.sql:78, 0003_registry.sql:842, 0027_certificate_attestation.sql:48; supabase/bootstrap.sql:15-17
- Evidence: `grep -i "create extension" supabase/migrations/*.sql` returns nothing; the only `create extension` lines are in bootstrap.sql, which must never run on Supabase. A new Supabase project has pgcrypto in `extensions` but not pg_trgm or unaccent, so 0003 (`extensions.unaccent`, `extensions.gin_trgm_ops`) would fail when the migrations are applied as documented in README ("Apply `supabase/migrations/*.sql` in order"). Local proof that a misplaced extension breaks resolution: with `alter extension pg_trgm set schema public`, the install refuses with `extension(s) installed outside schema extensions: pg_trgm in public` (see evidence below).
- Impact: The first real deployment fails at migration 0003 unless the operator happens to enable both extensions in the right schema.
- Root cause: The local shim supplies the extensions, hiding the dependency.
- Solution: Already done in packaging: `fresh-install.sql` creates the three extensions `with schema extensions` and refuses copies in other schemas; install README §C and manual-setup §1 cover the per-file path. Optional, for the orchestrator: make the migrations self-contained with a NEW file that sorts first. Proposed `supabase/migrations/0000_extensions.sql`:
  ```sql
  -- Extensions the migrations call as extensions.*; Supabase provides the schema, local tests get it from bootstrap.sql.
  create schema if not exists extensions;
  create extension if not exists pgcrypto with schema extensions;
  create extension if not exists pg_trgm with schema extensions;
  create extension if not exists unaccent with schema extensions;
  ```
  It is a no-op on every existing local/demo database (the demo launcher applies missing files by name and these statements are idempotent) and no Supabase database exists yet. If adopted, regenerate with `npm run db:install-sql`; the installer's own extension block then becomes redundant but harmless.
- Acceptance: Applying only `supabase/migrations/*` (no bootstrap extension lines) to a database that has the `extensions` schema succeeds.
- Verification: `verify.sql` check 14; local run with bootstrap's extension lines removed.

### SUP-02 — No supported way to create the first organization, clinic and staff grants on a real project
- Priority: P1
- Class: Missing required behavior
- Location: scripts/setup-local.ts:11-37; supabase/migrations/0002_staff_access.sql:24-26, 0002_staff_access.sql:65-74; scripts/demo-seed.ts:41; docs/operations/deployment.md:6
- Evidence: `setup-local.ts` connects only to `DB_URL` (local cluster) and creates no accounts or grants. `request_staff_membership` requires the caller to already hold `admin.users` or `grant.approve.clinical`; `approve_staff_membership` requires a different holder. On an empty database no one holds either, so the in-app process cannot start. The only code that creates active memberships is the fictional demo seed, which inserts them directly (`status 'active'`, mutual approvers), bypassing command receipts and audit. Docs say "initial two-person staff administration ... operator-approved process" without defining one.
- Impact: The operator cannot reach first use without hand-written SQL that leaves no audit trail of who was granted what.
- Root cause: Bootstrap of the authorization root was left to an unspecified external process.
- Solution: Decide and add (orchestrator/owner decision) a NEW forward migration with an operator-only, audited, one-time bootstrap callable from the SQL Editor (as `postgres`) and never through the API. Proposed SQL:
  ```sql
  create function private.bootstrap_initial_staff(p_org_name text, p_clinic_name text, p_timezone text,
                                                  p_admin_email text, p_lead_email text)
  returns jsonb language plpgsql security definer set search_path = '' as $$
  declare v_admin uuid; v_lead uuid; v_org uuid; v_clinic uuid;
  begin
    if exists (select 1 from public.staff_memberships where status in ('active','pending_approval')) then
      raise exception 'initial staff already exist; use the in-app two-person process' using errcode = 'CV409';
    end if;
    select p.id into v_admin from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(p_admin_email)) and p.status = 'active';
    select p.id into v_lead from auth.users u join public.profiles p on p.id = u.id
     where lower(u.email) = lower(btrim(p_lead_email)) and p.status = 'active';
    if v_admin is null or v_lead is null or v_admin = v_lead then
      raise exception 'two different, already signed-up accounts are required' using errcode = 'CV422';
    end if;
    insert into public.organizations (name) values (btrim(p_org_name)) returning id into v_org;
    insert into public.clinics (organization_id, name, timezone) values (v_org, btrim(p_clinic_name), p_timezone) returning id into v_clinic;
    insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, requested_by, approved_by)
    values (v_org, v_admin, v_clinic, 'tech_admin', 'active', v_lead, v_lead),
           (v_org, v_lead, v_clinic, 'clinical_lead', 'active', v_admin, v_admin);
    perform private.audit(v_org, null, 'staff.bootstrap', 'clinic', v_clinic, null,
      jsonb_build_object('techAdmin', v_admin, 'clinicalLead', v_lead), 'operator bootstrap');
    return jsonb_build_object('organizationId', v_org, 'clinicId', v_clinic);
  end $$;
  revoke all on function private.bootstrap_initial_staff(text, text, text, text, text) from public, anon, authenticated, service_role;
  ```
  (`private.audit` records `system_job_id = 'system'` when `auth.uid()` is null.) The governance decision (who may run it, what record of approval is kept) remains the operator's.
- Acceptance: On an empty DB, one call creates org + clinic + two mutually approved memberships and one audit row; a second call fails with CV409; anon/authenticated cannot execute it.
- Verification: new tests/db case; `verify.sql` checks 9–11 still PASS.

### SUP-03 — Migrations have only ever executed on PostgreSQL 18; Supabase runs 15 or 17
- Priority: P2
- Class: Inspection risk
- Location: supabase/migrations/* (all); scripts/db.ts:15; .github/workflows/quality.yml:20-21
- Evidence: `select version()` on the local cluster: `PostgreSQL 18.2`; the demo's embedded binaries are `18.4.0-beta.17`. CI uses the runner's preinstalled PostgreSQL (`pg_config --bindir`) and has never run in hosted CI (known-limitations L14). A grep for PG16–18-only syntax found none, but behavior differences (planner, function inlining, defaults) are untested.
- Impact: A version-specific failure would surface only during the live install (rolled back safely by the single transaction) or, worse, as different runtime behavior.
- Solution: Run `fresh-install.sql` + `verify.sql` + `npm run test:db` against PostgreSQL 17 (the Supabase CLI's `supabase/postgres` image or the staging project) before go-live; optionally pin the CI PostgreSQL major to the project's version.
- Acceptance: Same 20-row verify result and full DB suite pass on the Supabase project's major version.
- Verification: recorded command output in docs/implementation/verification.md.

### SUP-04 — docs/deployment.md names environment variables the code does not read
- Priority: P2
- Class: Reproduced defect (documentation)
- Location: docs/deployment.md:17, 38-44, 70
- Evidence: Doc lists `UPSTASH_REDIS_REST_URL/TOKEN`, `CVSRS_CERT_RENDER_SECRET`, `SEMAPHORE_API_KEY`, `MTALKZ_API_KEY`; `grep -rhoE "process.env\.[A-Z_]+" src scripts` shows the code reads `CVSRS_RATE_LIMIT_URL/TOKEN`, `CVSRS_CERTIFICATE_RENDER_SECRET`, `SMS_WEBHOOK_SECRET`, `CVSRS_SMS_WEBHOOK_DB_URL` and no Semaphore/Mtalkz keys. Line 70 says the worker needs only `process_outbox`; 0028 also grants `claim_sms`, `mark_sms`.
- Impact: An operator following that page deploys with rate limiting and certificate signing unconfigured; protected requests fail closed and certificates cannot be issued.
- Solution: Replace the table with the `.env.example` names (manual-setup §4 has the correct mapping) or delete the duplicate guide and link to docs/operations/deployment.md. Not edited here (outside my ownership).
- Acceptance: Every variable named in docs/deployment.md appears in `.env.example` and in code.
- Verification: grep comparison above returns no differences.

### SUP-05 — Email links work only in the same browser and only with default `{{ .ConfirmationURL }}` templates
- Priority: P2
- Class: Inspection risk
- Location: src/app/auth/callback/route.ts:25, 39; src/app/auth/sign-up/route.ts:30-34; src/app/account/forgot-password/recovery-request-form.tsx:18
- Evidence: The callback reads only `?code=` and calls `exchangeCodeForSession`. With `@supabase/ssr` PKCE, the code verifier is stored as a cookie in the browser that called `signUp`/`resetPasswordForEmail`; opening the email on another device has no verifier, so the exchange errors and the user lands on `/sign-in?auth=link-error`. There is no `token_hash`/`verifyOtp` branch, so the Supabase-documented SSR template pattern (`{{ .TokenHash }}`) cannot be used either.
- Impact: Guardians who sign up on a clinic tablet or desktop and open the email on their phone cannot confirm; recovery has the same limitation. Not reproducible without live Auth.
- Root cause: Only the PKCE code flow was implemented.
- Solution: Add a `token_hash` + `type` branch to the callback (`supabase.auth.verifyOtp({ token_hash, type })`) with the same destination allowlist, and switch both templates to `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=<email|recovery>&next=...`. Until then manual-setup §3 instructs keeping default templates.
- Acceptance: Confirmation and recovery links succeed when opened in a different browser.
- Verification: unit test for the new branch; live smoke test 3–4 in manual-setup §8.

### SUP-06 — Three helper functions lack a pinned search_path (Security Advisor noise)
- Priority: P3
- Class: Optional improvement
- Location: supabase/migrations/0001_foundation.sql:125, 136, 143
- Evidence: Local catalog query: the only functions in public/private without `search_path` in `proconfig` are `private.capability_vocab`, `private.clinical_caps`, `private.role_preset` (non-definer, immutable SQL returning array literals).
- Impact: No exploit path (they reference no relations or operators beyond literals/CASE), but Supabase's linter will report "function_search_path_mutable" and distract reviewers.
- Solution: NEW forward migration: `alter function private.capability_vocab() set search_path = ''; alter function private.clinical_caps() set search_path = ''; alter function private.role_preset(text) set search_path = '';` Note a SET clause prevents SQL-function inlining; these are called from `has_capability` and a CHECK constraint, so measure with `npm run perf` before adopting.
- Acceptance: Security Advisor shows no search_path warnings for CVSRS functions.
- Verification: catalog query above returns zero rows.

## Local execution evidence (plain PostgreSQL 18.2 + bootstrap shim — NOT Supabase)

Cluster: project-local, `127.0.0.1:54329`, binaries `C:/laragon/bin/postgresql/postgresql/bin`, user `postgres`. Database `cvsrs_audit_install` (disposable; dropped at the end).

1. Create, shim, install as ONE script, verify, rerun:
   ```
   psql -h 127.0.0.1 -p 54329 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists cvsrs_audit_install with (force)" -c "create database cvsrs_audit_install"
   DROP DATABASE / CREATE DATABASE
   psql ... -d cvsrs_audit_install -v ON_ERROR_STOP=1 -q -f supabase/bootstrap.sql                 -> exit=0
   psql ... -d cvsrs_audit_install -v ON_ERROR_STOP=1 -q -f supabase/install/fresh-install.sql
   NOTICE:  extension "pg_trgm" already exists, skipping   (likewise pgcrypto, unaccent — created by the shim)
   exit=0
   psql ... -d cvsrs_audit_install -v ON_ERROR_STOP=1 -f supabase/install/verify.sql               -> exit=0
     1..18 PASS (expected tables; RLS on every public table; anon/authenticated privileges; private schema;
                 SECURITY DEFINER search_path; anon/PUBLIC/authenticated EXECUTE allowlists; 0028 roles and grants;
                 extensions; auth.users trigger; deployment switches; history; RPC allowlist = port.ts)
     19 INFO  not yet provisioned: certificate issuance fails closed until it is
     20 INFO  0 organization(s), 0 clinic(s), 0 active staff membership(s)
   psql ... -d cvsrs_audit_install -v ON_ERROR_STOP=1 -q -f supabase/install/fresh-install.sql     (second run)
   ERROR:  CVSRS install refused: supabase_migrations.schema_migrations already has 33 row(s). fresh-install.sql is for a brand-new empty project only; to upgrade, apply only the missing migration files (supabase/install/README.md).
   exit=3
   select count(*), min(version), max(version) from supabase_migrations.schema_migrations   -> 33|0001|0033
   drop database cvsrs_audit_install with (force)  -> DROP DATABASE; pg_database count afterwards 0
   ```
2. Same sequence submitted the way a SQL console sends a pasted script — each file as ONE simple-protocol query via node-pg (scratchpad script): `bootstrap.sql: OK, 17 statements`; `fresh-install.sql: OK in 753 ms; statements=731; last=COMMIT`; `verify.sql`: 18 PASS + 2 INFO; second `fresh-install.sql`: `ERROR CVSRS install refused: ... already has 33 row(s)`.
3. Equivalence: `pg_dump --schema-only --no-owner -N supabase_migrations` after `fresh-install.sql` vs after applying the 33 files one by one with psql: identical apart from pg_dump's random `\restrict` token and carriage returns inside function bodies of the CRLF working-tree files 0017/0019/0021–0023/0025–0026 (the generator normalises to LF; git stores LF).
4. Upgrade procedure (install README §B/§C wrapper): prerequisites query, then 0001–0030 each as `begin; <file>; insert history; commit;`, then the missing 0031–0033 discovered from `supabase_migrations.schema_migrations` and applied the same way → `verify.sql` 18 PASS + 2 INFO.
5. Guard refusals (no change made in each case; `private`/`supabase_migrations` schema count stayed 0):
   - no bootstrap: `CVSRS install refused: Supabase roles/auth schema/extensions schema not found...`
   - pg_trgm moved to public: `CVSRS install refused: extension(s) installed outside schema extensions: pg_trgm in public...`
   - pre-existing `public.profiles`: `CVSRS install refused: public already contains table(s) that CVSRS creates: profiles`
   - history emptied but CVSRS present: `CVSRS install refused: schema "private" already exists...`
6. verify.sql negative test (inside a rolled-back transaction): an unprotected `public` SECURITY DEFINER function, a table without RLS, a PUBLIC-executable private function granted to authenticated, `demo_mode=true`, a deleted history row, a worker table grant, a revoked allowlisted RPC and a re-granted `*_prev` wrapper produced FAIL in checks 2, 3, 4, 5, 8, 9, 10, 11, 13, 16, 17 and 18 with the offending names.
7. Quality gates: `npm run db:install-sql -- --check` → `supabase/install is up to date (33 migrations)`; `npx vitest run tests/unit/supabase-install.test.ts` → 8/8 pass; `npm run typecheck` exit 0; eslint on the new files exit 0 (full `npm run lint` result in the handoff).

What this does **not** show: GoTrue inserting into `auth.users` as `supabase_auth_admin`, the SQL Editor's size/timeout limits, supautils role restrictions, PostgREST RPC marshalling and read-only handling, Supavisor logins, Supabase CLI history reconciliation, and PostgreSQL 15/17 behavior.
