# Independent E13–E16 auth and runtime review

2026-09-30. Read-only source review and focused unit verification. No Supabase project, Redis store, SMS provider, deployment ingress, or live browser session was available; this review makes no provider-behavior or production-readiness claim.

## Re-review disposition

Source re-review on 2026-09-30 after the corrective edits. The original three findings below are **resolved in source, pending CI/deployment execution**:

- Every `api()` route now uses a default shared limit of 60 requests per minute when no override is specified (`src/lib/api/handler.ts:44-47`). `tests/unit/api-handler.test.ts` demonstrates that a previously bare route returns 503 before DB access when production has no store. Live Redis behavior remains unverified.
- `scripts/backup-integrity.ts` rejects missing documents for issued certificates and checks PDF bytes and snapshot hashes. `scripts/backup-drill.ts` selects certificate status and `issued_at` for that check. `tests/unit/backup-integrity.test.ts` covers the missing issued PDF and intact pending certificate cases.
- `.github/workflows/quality.yml` now runs `npm run drill:restore -- cvsrs_test` after DB tests and the build. `scripts/backup-drill.ts` checks the project cluster before `pg_dump` and again before dropping the restore target. The CI drill has not been observed in this review.

Focused re-verification: `npx vitest run tests/unit/api-handler.test.ts tests/unit/backup-integrity.test.ts tests/unit/shared-rate-limit.test.ts tests/unit/db-safety.test.ts tests/unit/auth-callback.test.ts` — 5 files, 16 tests passed.

### Medium — clinic UI accepts an expired or not-yet-valid active membership (open at re-review)

`supabase/migrations/0029_clinic_timezones.sql:12` returns every `active` membership to `get_my_context` without checking `valid_from`, `valid_until`, or clinic status. `src/lib/server/viewer.ts:53` and `src/app/clinic/page.tsx:12-15` also filter by status only. Thus a membership outside its validity interval, or at a suspended clinic, can enter the clinic shell and see clinic metadata and capability-driven controls; with one such membership the home page automatically routes there. `private.has_capability` does check the dates, clinic status, and MFA (`supabase/migrations/0001_foundation.sql:296-318`), so this is not evidence that protected database commands succeed. Align the viewer and context filtering with the database's effective-access predicate and show a clear unavailable or pending state.

## Original findings (resolved in source as noted above)

### High — production API rate limits cover only opt-in routes (release blocker)

`src/lib/api/handler.ts:29,44` makes `rate` optional and calls the shared limiter only when a route supplies it. At least 44 route files contain a bare `api({}` call, including sensitive mutation examples `src/app/api/v1/clinics/[clinicId]/catchup-plans/[planId]/submit/route.ts:3`, `src/app/api/v1/clinics/[clinicId]/staff/[membershipId]/revoke/route.ts:4`, and `src/app/api/v1/children/[childId]/record-transfers/[transferId]/cancel/route.ts:3`. Those requests still authenticate and use database permissions, but they never enter the Redis limit path. A compromised or abusive authenticated account can repeatedly invoke these routes without the application-level shared bound described in `docs/audit/runtime-security-implementation.md`. Apply a conservative default to every `api()` route, retaining explicit route-specific overrides; verify representative bare GET and mutation routes fail closed when the store is unavailable and return 429 after the limit.

### Medium — restore drill can pass with an issued certificate's PDF missing

`scripts/backup-drill.ts:44-47` left-joins `private.certificate_documents` and counts a checksum mismatch only if `d.sha256` exists. An `issued` or `revoked` certificate with no document therefore contributes zero to `badCert`; `scripts/backup-drill.ts:91` accepts that outcome. The drill compares the source and restore, so it can preserve and certify an already broken source invariant. Count a missing document as a failure for certificates that have been issued, while allowing a pending certificate to lack its PDF. Prove the check with a disposable fixture or a read-only query against a deliberately constructed copy.

### Medium — CI does not exercise the backup/restore drill

`package.json:23,27` defines `drill:restore` but omits it from `test:all`; `.github/workflows/quality.yml:25-27` runs `test:all` and `build` only. Migration and DB tests can pass while `pg_dump`, `pg_restore`, or the drill's invariants fail. Run the drill in CI after DB tests have populated the disposable source, with explicit local-cluster checks before dumping and restoring; preserve its result as release evidence. The current script checks the connected cluster before its destructive target drop (`scripts/backup-drill.ts:75-76`), but performs `pg_dump` before that check (`scripts/backup-drill.ts:69`).

## Reviewed controls and limits

- PKCE callback exchanges the code via Supabase Auth, masks exchange errors, rejects an origin different from configured production origin, and restricts `next` to three literal paths (`src/app/auth/callback/route.ts`; `src/lib/auth/redirect.ts`). Recovery requests use the callback; reset checks `getUser()` before offering password update (`src/app/account/forgot-password/recovery-request-form.tsx`; `src/app/account/reset-password/reset-password-form.tsx`). These source paths are coherent, but email template delivery, cookie persistence, expiry, refresh, and MFA AAL2 still need staging verification.
- The runtime no longer exposes a local-login route or local RPC client. `getRpcClient` constructs only the Supabase client (`src/lib/db/index.ts`); `scripts/setup-local.ts` creates clinic records without accounts. Production web processes do not launch the outbox worker (`src/lib/worker/outbox.ts:46`), and the signed SMS callback reads only `CVSRS_SMS_WEBHOOK_DB_URL` (`src/app/api/v1/webhooks/sms/route.ts:30`).
- Migration 0028 gives the non-login worker and callback roles separate function grants. The disposable DB role test asserts exact function entry points, no table grants, and cross-role denial (`tests/db/runtime-security.test.ts`). This is local PostgreSQL evidence, not proof of role provisioning or grants in a Supabase project.
- `scripts/db.ts` resolves and compares the connected `data_directory` before reset drops a database; the test harness confines its database name to `cvsrs_test` or `cvsrs_audit_*` (`tests/unit/db-safety.test.ts`). No destructive database command was run for this review.
- Focused verification: `npx vitest run tests/unit/auth-callback.test.ts tests/unit/auth-redirect.test.ts tests/unit/shared-rate-limit.test.ts tests/unit/webhook-route.test.ts tests/unit/db-safety.test.ts` — 5 files, 23 tests passed. These tests mock provider behavior and do not establish live integrations.
