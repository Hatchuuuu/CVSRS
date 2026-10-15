# E15/E16 authentication implementation

2026-09-30. Source changes only; no Supabase project was provisioned and no existing database records were removed.

## Root cause and changes

The application still accepted a local cookie containing an arbitrary synthetic `auth.users` ID. `/dev/login` issued that cookie, and `scripts/setup-local.ts` inserted eight fictional role accounts plus a setup identity. This conflicted with the approved production-only Supabase authentication boundary. The runtime local client, cookie, persona listing, dev-login route, and dev-only axe route were removed. `getRpcClient` now uses Supabase Auth/PostgREST only. The local database tests retain disposable synthetic fixtures; the setup script creates only organization and clinic records and no accounts or grants. Existing rows were left untouched.

Signup previously directed email confirmation straight to `/children`, leaving the PKCE code unexchanged. Sign-up now sends the link to `/auth/callback?next=/children`. The callback exchanges the one-use code with `@supabase/ssr`, sets the session cookies, and permits only `/children`, `/account/security`, or `/account/reset-password` as destinations. Invalid, expired, or provider-error links get a generic sign-in error. A password-recovery request sends links through the same callback to the reset form; the form verifies the current user and submits the new password. Request responses do not disclose whether an address exists. MFA reads now inspect returned errors, recover from rejected requests, clear busy state, and offer retry after a failed security-state read.

Deployment operators must configure the canonical HTTPS origin, Supabase URL and publishable key, email templates, and the two exact callback redirect URLs in `.env.example`; initial real staff identities and grants require an approved provisioning procedure. [Supabase redirect URL guidance](https://supabase.com/docs/guides/auth/redirect-urls) and [PKCE exchange documentation](https://supabase.com/docs/reference/javascript/auth-exchangecodeforsession) are the provider references. The application remains deliberately unavailable before that configuration.

## Validation and limits

- `npx vitest run tests/unit/auth-redirect.test.ts tests/unit/auth-callback.test.ts`: 11 tests passed, including missing code, exchange error, intended reset destination, and hostile redirect input.
- Focused ESLint over changed auth source, setup script, and tests: exit 0.
- After the shared schema edit settled, `npm run typecheck` passed and `npm run test:unit` passed (71 tests across 15 files). `git diff --check` passed for the auth change set.
- No live Supabase project was available. Confirmation email delivery/template behavior, recovery delivery, cookie persistence across a real browser, token expiry/refresh, MFA TOTP and AAL2 propagation, and PostgREST authorization remain G01 staging checks. Unit mocks prove local callback routing only.
