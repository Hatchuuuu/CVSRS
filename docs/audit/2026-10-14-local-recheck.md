# Local recheck — 2026-10-14

The normal application is ready for local account, patient-registration and clinic-setup testing. All current automated checks passed, including a fresh complete 51-case browser run. The full normal-clinic care walkthrough still requires clinic configuration and patient/guardian review; human screen-reader acceptance remains unobserved. This report supersedes the test-execution caveat in [the normal-account audit](2026-10-14-normal-accounts-and-flow.md), while retaining its scope, account setup and historical failures.

## Fresh verification

| Check | Observed result |
|---|---|
| `npm run check` | Types and lint pass; 592 unit tests / 80 files pass |
| `npm run test:db` | 427 database tests / 30 files pass |
| `npm run test:e2e` | **51 passed in one clean run, 14.5 minutes**; no failures or skipped cases |
| `npm run build` | Production build passes; normal development server restarted afterward |
| `npm run matrix:check` | 287 rows current |
| `npm run db:install-sql -- --check` | Generated install SQL matches all 48 migrations |
| `npm run drill:upgrade` | Populated 0030 database upgrades through 0047; checks pass |
| `npm run drill:restore` | 69 tables / 12,013 rows restored; 22 certificates, 2,439 audit rows and 172 function grants checked; no integrity problems |
| Normal database verification | 18 PASS / 2 INFO; 48 migrations through 0047, RLS/grants verified, staff MFA required, immediate signup enabled |
| All seven normal accounts | Sign-in, role workspace and reload pass; 375/1280 px automated accessibility and overflow checks pass |
| Normal family/assistant patient views | Saved example record visible with intended provisional-access restrictions; responsive/accessibility checks pass |
| Ordinary normal page loads/reloads | All seven roles report no console or uncaught errors; family/assistant patient captures also pass |
| Final normal data comparison | Requested accounts, six memberships/MFA enrollments, profiles, child and guardian hashes exactly match the saved preflight snapshot |

The complete browser run exercises real isolated Auth/PostgREST/PostgreSQL: registration, independent staff approvals and MFA, role denials/revocation, stock and corrections, booking/queue, signed vaccination, certificate PDF and public validity, reports, messages, follow-up, outage forms, password changes/recovery, responsive layouts and keyboard/opened-state accessibility. Its connected care flow passed after the earlier revocation journey, using a newly approved assistant grant through ordinary APIs. Prior failed intermediate runs remain documented; this run closes their full-suite rerun caveat.

Raw outputs are retained in ignored `.local/recheck-2026-10-14-*.log`. The final snapshot comparison used `.local/snapshot-normal-roles.ts verify .local/normal-patient-restart-snapshot.json`. Tests used disposable environments, leaving the normal database with seven requested accounts, six active staff/MFA enrollments, one example child, zero vaccination events and zero stock transactions. The additional pre-existing identity was preserved.

An earlier screenshot-time hydration warning matched Playwright's injected transparent caret styling. Rechecking ordinary loads/reloads and captures with `caret: 'initial'` produced no errors. Only ignored verification helpers changed during this recheck; no application behavior, dependency, schema or clinical data was changed.

## Local use and remaining acceptance

The normal server remains available at **http://localhost:3000**. Private login and MFA details are in `.local/local-login-credentials.json`; keep that file off the projector. Follow [the classroom walkthrough](../operations/classroom-walkthrough.md).

Before showing a complete care flow in this normal clinic, review the example patient's identity/guardian link and configure approved clinic rules/products, usable stock and a session. Synthetic clinical fixtures were tested only in isolation. Example identities are not actual people or vaccination history.

Actual screen-reader speech and physical camera/printer operation were not observed. Public deployment and external transport were not part of this laptop recheck. Automated accessibility is passing but does not establish spoken-reader acceptance.

The existing **96% criterion-completion ledger** remains unchanged: technical regression verification passes, while the configured normal-clinic walkthrough and human screen-reader criteria remain open. This is an evidence ledger, not a guarantee of zero defects or a claim of 100% readiness.
