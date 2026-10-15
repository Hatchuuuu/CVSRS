# Local Readiness Verification

Scope: the existing application running locally, not production deployment or new product capabilities. This follows the [full system audit](2026-10-07-full-system-audit.md). Percentage estimates are not test results; readiness below is recorded as concrete checks.

## Changes

- Supabase email confirmation is disabled. New family and staff accounts are automatically confirmed and receive an immediate session; signup sends no confirmation email.
- Removed the obsolete signup email-link redirect and messaging. An unexpected missing session or confirmation requirement now reports a service configuration problem instead of fake success or asking for an email link.
- Local development and browser-test startup check the running Auth policy, catching stale containers even when the config file is correct. Both local stacks were restarted without resetting development data.
- Removed the redundant public auto-confirm trigger/function. Native Auth handles new accounts; development startup enables existing unconfirmed local accounts under the new policy. RLS, staff approvals, MFA and clinical/guardian access checks remain enforced.
- Updated local setup instructions, deployment policy and browser journeys. Password recovery still uses the existing local test inbox; it is not signup verification.

## Verification

| Check | Result |
|---|---|
| `npm run check` | After the password follow-up: types and ESLint clean; 77 files / 573 unit tests passed. |
| `npm run build` | Production compilation, type checking, static generation and route collection passed. |
| `npm run test:db` | 28 files / 418 tests passed against a rebuilt disposable database. |
| Development Auth settings | Running service reports `mailer_autoconfirm: true`. |
| Development `supabase/install/verify.sql` | All 18 schema/security checks PASS; certificate secret provisioned. No demo fixtures; staff MFA required. |
| `npm run db:install-sql -- --check` | Generated installation SQL matches all 45 migrations. No new migration was required. |
| `npm run matrix:check` | 287 requirement rows consistent. |
| `npm run drill:restore` | 69 tables / 11,562 rows restored and matched; 22 certificate hashes and 2,358 audit rows checked; no integrity problems. |
| `npm run drill:upgrade` | Populated 0030-to-0044 upgrade passed: 67 table counts preserved; role-scoped reads/writes, RLS, pinned search paths and the 168-RPC allowlist checked. |
| `npm run test:e2e` | Clean isolated-stack run: all 38 Chromium journeys passed in 10.7 minutes. Includes immediate signup, no confirmation email, duplicate signup, reload persistence, recovery, first-staff bootstrap, permissions/MFA and the existing clinical, inventory and administration workflows. |
| Accessibility/responsiveness | Signed-in axe A/AA scans passed at 375/1280 px; 27 page/viewport combinations at 320/768/1440 px passed overflow checks. Skip-link focus and mobile-menu keyboard recovery passed; the final phone screenshot was inspected. |
| App readiness | `http://localhost:3000/api/v1/health/ready` returns HTTP 200. |

## First-Use Configuration

At the user's subsequent request to choose and create local logins, the existing first-staff command provisioned "Local Development" / "Local Clinic" (Asia/Manila) with `admin@cvsrs.test` as technical administrator and `lead@cvsrs.test` as clinical lead. Both accounts have generated passwords stored only in the ignored `.local/local-login-credentials.json`. Signup, automatic confirmation, password sign-in, active role grants, no confirmation email and the required MFA enrolment redirect were verified. Both users must enrol their own authenticator before clinic access; MFA was not bypassed.

Clinic-owned privacy wording, vaccine definitions and approved schedules belong to the clinic, not to the software. Their existing setup workflows are exercised with synthetic data only in the isolated test database. Do not substitute those fixtures for real clinical policy.

## Password Change Follow-Up

The account and recovery forms had gaps: React state alone did not block simultaneous submissions, a missing returned user could show false success, and lost responses were presented as definite failures even when Auth might have saved the password. Session, password-policy and rate-limit errors also lacked specific recovery guidance.

Both existing forms now share password-result handling, synchronously guard submissions, disable fields during saving and clear sensitive fields only after confirmed success. Uncertain responses explain how to check the new password before retrying. Expired or old sessions direct the user to sign out and sign in again; no verification email was added. Native Auth still enforces password policy, recent-session checks and staff MFA.

Verification after these changes:

- Four focused Chromium journeys passed: account validation and concurrent submits; server failure and a response lost after an actual save; old/missing-session recovery; staff MFA preservation and enforcement on the next sign-in; and password-reset regression. Old passwords were rejected and new passwords accepted after successful writes.
- Fourteen focused unit tests passed, including reproduced pre-fix failures. The complete unit suite passed: 573 tests across 77 files, with clean type checking and lint.
- Production build passed. The main local readiness endpoint returned HTTP 200 after verification.
- The 38-journey full-suite result above predates this follow-up; the four password journeys were rerun separately against the final changes. No database schema changed.

Tests used isolated fictional accounts. The user's local administrator and clinical-lead passwords were not changed. These results establish the tested local workflows, not a guarantee against every possible future infrastructure failure.

## Status

Confirmed local software gaps are repaired, and all automated local acceptance gates listed above pass. The application is running in the background at `http://localhost:3000`. No new product capabilities, patients or clinical-rule fixtures were added.

Local accounts and initial clinic access are now provisioned using the user-authorized defaults. Replace the generic clinic details and enter clinic-approved policy before real clinical use. This document does not certify production readiness, clinical suitability or universal absence of defects.

Reference: native automatic-confirmation behavior is described in [Supabase's Auth configuration](https://supabase.com/docs/guides/auth/general-configuration); this run verifies it directly rather than relying on the documentation alone.
