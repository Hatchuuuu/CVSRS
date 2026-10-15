# Backend src/lib module and caller coverage — 2026-10-14

This is source-review evidence for the local laptop/classroom scope. It is a finite module/import/caller inventory, not a claim of every branch being tested or absence of undiscovered bugs. No tests or runtime/DB mutations were performed for this final inventory pass. Earlier runtime verification belongs to the main audit report.

## Scope and method

All backend/shared library TypeScript modules below were source-read during this audit, including transitive helpers. TypeScript AST import/export/dynamic-import traversal across src, scripts and tests resolves @/ and relative paths to collect exact named direct callers. Pure frontend client modules (client/api.ts, client/password.ts, client/supabase-browser.ts) and format.ts are covered by the frontend peer report; their imports into backend/shared helpers are still shown below. Runtime/framework dispatch, dependency-internal imports and SQL calls are separate boundaries and cannot be inferred from direct import counts.

Reviewed backend/shared modules: **48**. Review includes 5 API, 8 auth, 2 certificates, 3 DB, 2 security, 1 server, 2 reports, 5 SMS, 2 worker and 14 validation modules, plus env, health, legal and staff-roles.

The route boundary inventory covered 145 files (141 API and 4 auth), 167 exported methods, 158 shared-api methods and 9 custom methods. RPC inventory covered 168 allowlisted names/latest SQL definitions, 220 literal RPC call sites plus report/page-reader indirection; named argument structural checks found no mismatch. All 168 names occur in DB-test source, which is reference coverage, not behavioral branch coverage.

## Module responsibilities and risk review

### src/lib/api/body.ts

Reads streaming UTF-8 bodies with declared and actual byte ceilings; cancels/releases the reader on error. Does not buffer beyond the bounded accepted payload. Evidence: api-boundaries.test.ts.

Direct named callers/importers (4):

- src/app/api/v1/webhooks/sms/route.ts
- src/lib/api/handler.ts
- src/lib/auth/request.ts
- tests/unit/api-boundaries.test.ts

### src/lib/api/errors.ts

Maps SQLSTATE and curated hints to safe errors; hides raw infrastructure messages; preserves retry flags and no-store/request-id envelope. Evidence: security.test.ts, iteration4-hints.test.ts.

Direct named callers/importers (28):

- src/app/api/v1/certificates/[certificateId]/download/route.ts
- src/app/api/v1/clinics/[clinicId]/appointments/route.ts
- src/app/api/v1/clinics/[clinicId]/available-sessions/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/schedule/route.ts
- src/app/api/v1/clinics/[clinicId]/children/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/route.ts
- src/app/api/v1/clinics/[clinicId]/reports/[name]/export/route.ts
- src/app/api/v1/clinics/[clinicId]/reports/[name]/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/route.ts
- src/app/api/v1/webhooks/sms/route.ts
- src/app/layout.tsx
- src/lib/api/body.ts
- src/lib/api/handler.ts
- src/lib/api/list-cursors.ts
- src/lib/api/query.ts
- src/lib/auth/request.ts
- src/lib/certificates/pdf.ts
- src/lib/certificates/service.ts
- src/lib/db/index.ts
- src/lib/db/supabase.ts
- src/lib/security/rate-limit.ts
- src/lib/server/viewer.ts
- tests/unit/api-boundaries.test.ts
- tests/unit/audit-query.test.ts
- tests/unit/certificate-pdf.test.ts
- tests/unit/iteration4-hints.test.ts
- tests/unit/security.test.ts

### src/lib/api/handler.ts

Shared authentication, same-origin mutation guard, parameter UUID checks, required UUID operation keys, bounded JSON/schema parsing and two-tier rate limits. Auth opt-outs remain explicit. Evidence: api-handler.test.ts, api-boundaries.test.ts.

Direct named callers/importers (139):

- src/app/api/v1/appointments/[appointmentId]/cancel/route.ts
- src/app/api/v1/appointments/[appointmentId]/reschedule/route.ts
- src/app/api/v1/appointments/route.ts
- src/app/api/v1/children/[childId]/catchup-plan/route.ts
- src/app/api/v1/children/[childId]/certificates/route.ts
- src/app/api/v1/children/[childId]/checkins/route.ts
- src/app/api/v1/children/[childId]/edit-requests/route.ts
- src/app/api/v1/children/[childId]/history/route.ts
- src/app/api/v1/children/[childId]/outside-doses/route.ts
- src/app/api/v1/children/[childId]/qr/route.ts
- src/app/api/v1/children/[childId]/queue-status/route.ts
- src/app/api/v1/children/[childId]/record-transfers/[transferId]/cancel/route.ts
- src/app/api/v1/children/[childId]/record-transfers/route.ts
- src/app/api/v1/children/[childId]/schedule/route.ts
- src/app/api/v1/children/route.ts
- src/app/api/v1/clinics/[clinicId]/administrations/[eventId]/corrections/route.ts
- src/app/api/v1/clinics/[clinicId]/administrations/[eventId]/exception-decision/route.ts
- src/app/api/v1/clinics/[clinicId]/appointments/route.ts
- src/app/api/v1/clinics/[clinicId]/audit/route.ts
- src/app/api/v1/clinics/[clinicId]/available-sessions/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-items/[itemId]/status/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-plans/[planId]/cancel/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-plans/[planId]/review/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-plans/[planId]/submit/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-reviews/route.ts
- src/app/api/v1/clinics/[clinicId]/certificates/[certificateId]/retry/route.ts
- src/app/api/v1/clinics/[clinicId]/certificates/[certificateId]/revoke/route.ts
- src/app/api/v1/clinics/[clinicId]/checkin-policy/route.ts
- src/app/api/v1/clinics/[clinicId]/checkins/[checkinId]/answer/route.ts
- src/app/api/v1/clinics/[clinicId]/checkins/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/administration-exceptions/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/appointments/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/catchup-plans/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/certificates/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/followup-attempts/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/history/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/holds/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/outside-doses/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/qr/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/record-status/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/record-transfer/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/schedule/route.ts
- src/app/api/v1/clinics/[clinicId]/children/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/antigens/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/products/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/status/route.ts
- src/app/api/v1/clinics/[clinicId]/content/[versionId]/retire/route.ts
- src/app/api/v1/clinics/[clinicId]/content/[versionId]/review/route.ts
- src/app/api/v1/clinics/[clinicId]/content/[versionId]/submit/route.ts
- src/app/api/v1/clinics/[clinicId]/content/route.ts
- src/app/api/v1/clinics/[clinicId]/corrections/[caseId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/corrections/[caseId]/reject/route.ts
- src/app/api/v1/clinics/[clinicId]/encounters/[encounterId]/administrations/route.ts
- src/app/api/v1/clinics/[clinicId]/evidence/[eventId]/verify/route.ts
- src/app/api/v1/clinics/[clinicId]/followup/refresh/route.ts
- src/app/api/v1/clinics/[clinicId]/followup/route.ts
- src/app/api/v1/clinics/[clinicId]/guardians/[guardianId]/contact-invalid/route.ts
- src/app/api/v1/clinics/[clinicId]/guardians/[guardianId]/verify-contact/route.ts
- src/app/api/v1/clinics/[clinicId]/holds/[holdId]/release/route.ts
- src/app/api/v1/clinics/[clinicId]/merges/route.ts
- src/app/api/v1/clinics/[clinicId]/ops/route.ts
- src/app/api/v1/clinics/[clinicId]/paper-tallies/route.ts
- src/app/api/v1/clinics/[clinicId]/privacy-notice/acknowledge/route.ts
- src/app/api/v1/clinics/[clinicId]/privacy-notice/route.ts
- src/app/api/v1/clinics/[clinicId]/profile/route.ts
- src/app/api/v1/clinics/[clinicId]/qr/resolve/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/[entryId]/priority/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/[entryId]/transition/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/call-next/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/check-in/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/display/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/route.ts
- src/app/api/v1/clinics/[clinicId]/record-transfers/[transferId]/accept/route.ts
- src/app/api/v1/clinics/[clinicId]/record-transfers/[transferId]/decline/route.ts
- src/app/api/v1/clinics/[clinicId]/record-transfers/[transferId]/release/route.ts
- src/app/api/v1/clinics/[clinicId]/record-transfers/route.ts
- src/app/api/v1/clinics/[clinicId]/relationships/[relationshipId]/status/route.ts
- src/app/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify/route.ts
- src/app/api/v1/clinics/[clinicId]/reports/[name]/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve-link/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/activate/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/discard/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/impact/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/retire/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/return/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/submit/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/route.ts
- src/app/api/v1/clinics/[clinicId]/service-days/close/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/[sessionId]/cancel/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/[sessionId]/capacity/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/[sessionId]/roster/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/route.ts
- src/app/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/accept/route.ts
- src/app/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/reject/route.ts
- src/app/api/v1/clinics/[clinicId]/staff-applications/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/[membershipId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/[membershipId]/revoke/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/reject/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/adjustments/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/locations/[locationId]/close/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/locations/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/lots/[lotId]/disposition/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/lots/[lotId]/ledger/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/lots/[lotId]/trace/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/lots/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/receipts/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/reconcile/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/temperature/[readingId]/review/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/temperature/limits/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/temperature/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/cancel/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/receive/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/resolve/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/wastage/route.ts
- src/app/api/v1/clinics/route.ts
- src/app/api/v1/guardian-links/route.ts
- src/app/api/v1/me/care-content/route.ts
- src/app/api/v1/me/contact-preferences/route.ts
- src/app/api/v1/me/messages/read/route.ts
- src/app/api/v1/me/messages/route.ts
- src/app/api/v1/me/profile/route.ts
- src/app/api/v1/me/route.ts
- src/app/api/v1/me/staff-applications/[applicationId]/withdraw/route.ts
- src/app/api/v1/me/staff-applications/route.ts
- src/app/api/v1/verify/[token]/route.ts
- tests/unit/api-handler.test.ts
- tests/unit/rate-limit-isolation.test.ts
- tests/unit/supabase-session.test.ts

### src/lib/api/list-cursors.ts

Validates paired timestamp/id and bounded JSON follow-up cursors, refuses repeated values, preserves page parameter multiplicity. Page invalid-cursor fallback is deliberately separate from strict API validation. Evidence: list-cursors.test.ts.

Direct named callers/importers (7):

- src/app/api/v1/clinics/[clinicId]/followup/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/route.ts
- src/app/api/v1/me/messages/route.ts
- src/app/clinic/[clinicId]/followup/page.tsx
- src/app/clinic/[clinicId]/review/page.tsx
- src/app/messages/page.tsx
- tests/unit/list-cursors.test.ts

### src/lib/api/query.ts

Rejects unsafe/nonpositive query integers and invalid audit instants; translates selected validated values into named SQL arguments. Evidence: audit-query.test.ts.

Direct named callers/importers (9):

- src/app/api/v1/clinics/[clinicId]/audit/route.ts
- src/app/api/v1/clinics/[clinicId]/followup/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/temperature/route.ts
- src/app/api/v1/me/messages/route.ts
- src/app/clinic/[clinicId]/audit/page.tsx
- src/lib/api/list-cursors.ts
- tests/unit/api-boundaries.test.ts
- tests/unit/audit-query.test.ts

### src/lib/auth/clinic-access.ts

Filters inactive/expired memberships and unions capabilities across roles per clinic; does not grant database privileges. Evidence: clinic-access.test.ts.

Direct named callers/importers (4):

- src/app/clinic/page.tsx
- src/app/layout.tsx
- src/lib/server/viewer.ts
- tests/unit/clinic-access.test.ts

### src/lib/auth/cookies.ts

Central host-only SameSite=Lax cookie policy, production Secure, bounded age, deletion preservation, chunk/verifier identification and guarded cookie writes. Browser MFA/reset needs script-readable cookies. Evidence: auth-cookies.test.ts, sign-out.test.ts.

Direct named callers/importers (9):

- src/app/auth/callback/route.ts
- src/app/auth/sign-in/route.ts
- src/app/auth/sign-out/route.ts
- src/app/auth/sign-up/route.ts
- src/lib/client/supabase-browser.ts
- src/lib/db/supabase.ts
- src/proxy.ts
- tests/unit/auth-cookies.test.ts
- tests/unit/sign-out.test.ts

### src/lib/auth/destination.ts

Selects role-admitted clinic landing routes from the union of capabilities. Database authorizes every subsequent command. Evidence: clinic-access.test.ts, staff-entry.test.ts.

Direct named callers/importers (4):

- src/app/clinic/page.tsx
- src/app/layout.tsx
- src/app/page.tsx
- src/lib/server/viewer.ts

### src/lib/auth/password-policy.ts

Shared minimum password length and UTF-8 byte ceiling; explicitly requires Auth service settings to enforce equivalent policy for direct SDK calls. Evidence: auth-password-policy.test.ts.

Direct named callers/importers (5):

- src/app/account/account-forms.tsx
- src/app/account/reset-password/reset-password-form.tsx
- src/app/auth/sign-up/route.ts
- src/app/sign-up/sign-up-form.tsx
- tests/unit/auth-password-policy.test.ts

### src/lib/auth/redirect.ts

Whitelists family/staff entry and strictly validates clinic return paths before MFA/callback redirects, preventing arbitrary external destinations. Evidence: auth-redirect.test.ts, mfa-return-path.test.ts.

Direct named callers/importers (6):

- src/app/account/security/page.tsx
- src/app/auth/callback/route.ts
- src/app/auth/sign-in/route.ts
- src/app/auth/sign-up/route.ts
- src/lib/server/viewer.ts
- tests/unit/auth-redirect.test.ts

### src/lib/auth/request.ts

Bounded native/JSON credential parsing; rejects duplicate form keys and nonstring fields; separates credential errors from service outages; account/address/global throttling and successful sign-in refunds. Evidence: auth-entry.test.ts, rate-limit-isolation.test.ts.

Direct named callers/importers (3):

- src/app/auth/sign-in/route.ts
- src/app/auth/sign-up/route.ts
- tests/unit/rate-limit-isolation.test.ts

### src/lib/auth/session-policy.ts

Parses and bounds cookie lifetime and staff idle settings without permissive numeric coercion. Evidence: auth-cookies.test.ts, idle-monitor.test.ts.

Direct named callers/importers (4):

- src/components/staff-idle-sign-out.tsx
- src/lib/auth/cookies.ts
- src/lib/env.ts
- tests/unit/auth-cookies.test.ts

### src/lib/auth/staff-entry.ts

Canonicalizes exact staff entry paths only; unlisted path is convenience rather than authorization. Evidence: staff-entry.test.ts.

Direct named callers/importers (7):

- src/app/api/v1/clinics/[clinicId]/staff/route.ts
- src/app/clinic/[clinicId]/access/page.tsx
- src/app/clinic/[clinicId]/admin/page.tsx
- src/app/evactrackstafflogin/create-account/page.tsx
- src/app/evactrackstafflogin/page.tsx
- src/proxy.ts
- tests/unit/staff-entry.test.ts

### src/lib/certificates/pdf.ts

Renders frozen snapshots with bundled Unicode font, glyph validation, line wrapping/page breaks and QR link; fontkit compatibility adapter supplies a stream subset. Unsupported glyphs fail explicitly. Evidence: certificate-pdf.test.ts.

Direct named callers/importers (2):

- src/lib/certificates/service.ts
- tests/unit/certificate-pdf.test.ts

### src/lib/certificates/service.ts

Derives deterministic operation keys, validates public base, renders a pending certificate, binds bytes/snapshot/token with HMAC and stores via authorized RPC. Replays issued documents; pending failure remains recoverable. Evidence: certificate-pdf.test.ts, certificates.test.ts.

Direct named callers/importers (4):

- src/app/api/v1/clinics/[clinicId]/certificates/[certificateId]/retry/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/certificates/route.ts
- tests/unit/api-boundaries.test.ts
- tests/unit/certificate-pdf.test.ts

### src/lib/db/index.ts

Selects the publishable-key Supabase adapter and converts configuration absence into safe503. No service-role path. Evidence: config-errors.test.ts.

Direct named callers/importers (7):

- src/app/api/v1/certificates/[certificateId]/download/route.ts
- src/app/api/v1/clinics/[clinicId]/reports/[name]/export/route.ts
- src/app/auth/sign-up/route.ts
- src/app/verify/[token]/page.tsx
- src/lib/api/handler.ts
- src/lib/certificates/service.ts
- src/lib/server/viewer.ts

### src/lib/db/port.ts

Defines168 allowed RPC names and session/RPC contracts; arbitrary names are refused by adapter. Static latest-definition/caller mapping completed separately. Evidence: sweep.test.ts, api-handler.test.ts.

Direct named callers/importers (7):

- src/app/clinic/[clinicId]/children/[childId]/page.tsx
- src/lib/api/handler.ts
- src/lib/db/index.ts
- src/lib/db/supabase.ts
- src/lib/reports/catalog.ts
- src/lib/server/viewer.ts
- tests/unit/operational-gaps.test.ts

### src/lib/db/supabase.ts

Uses only publishable key plus session cookies, revalidates user with Auth getUser, distinguishes service failures from anonymous state, validates allowlist and maps DB errors. Evidence: supabase-session.test.ts.

Direct named callers/importers (2):

- src/lib/db/index.ts
- tests/unit/supabase-session.test.ts

### src/lib/env.ts

Validates connection settings, canonical production HTTPS origin, trusted client-address opt-in and session settings; local mode uses real Supabase. Evidence: config-errors.test.ts, security.test.ts.

Direct named callers/importers (17):

- src/app/api/v1/health/ready/route.ts
- src/app/auth/callback/route.ts
- src/app/auth/sign-in/route.ts
- src/app/auth/sign-out/route.ts
- src/app/auth/sign-up/route.ts
- src/app/sign-up/availability.tsx
- src/lib/certificates/service.ts
- src/lib/db/index.ts
- src/lib/security/origin.ts
- src/lib/security/rate-limit.ts
- src/lib/server/viewer.ts
- tests/unit/api-boundaries.test.ts
- tests/unit/auth-cookies.test.ts
- tests/unit/auth-entry.test.ts
- tests/unit/health-ready.test.ts
- tests/unit/inventory-controls.test.ts
- tests/unit/rate-limit-isolation.test.ts

### src/lib/health.ts

Configuration and abortable database readiness deadline, independent liveness contract; timeout cleanup in finally. Evidence: health-ready.test.ts, readiness-concurrency.test.ts.

Direct named callers/importers (2):

- src/app/api/v1/health/ready/route.ts
- tests/unit/health-ready.test.ts

### src/lib/legal.ts

Single current legal version shared by registration and legal UI; documents list. No independent authorization mechanism. Evidence: registration-outcomes.test.ts.

Direct named callers/importers (10):

- src/app/auth/sign-up/route.ts
- src/app/privacy/page.tsx
- src/app/sign-up/sign-up-form.tsx
- src/app/sitemap.ts
- src/app/terms/page.tsx
- src/components/legal-page.tsx
- src/components/site-footer.tsx
- tests/e2e/01-accounts.spec.ts
- tests/unit/auth-entry.test.ts
- tests/unit/auth-password-policy.test.ts

### src/lib/reports/catalog.ts

Finite four-report mapping to typed RPCs, approved column lists and clinic-date default period; no caller-chosen function name. Evidence: reports.test.ts, clinic-timezone.test.ts.

Direct named callers/importers (3):

- src/app/api/v1/clinics/[clinicId]/reports/[name]/export/route.ts
- src/app/api/v1/clinics/[clinicId]/reports/[name]/route.ts
- src/app/clinic/[clinicId]/reports/page.tsx

### src/lib/reports/csv.ts

Quotes cells, escapes embedded quotes/newlines, prefixes leading spreadsheet formula markers and explicitly represents suppressed cells; only catalog columns exported. Evidence: csv.test.ts.

Direct named callers/importers (3):

- src/app/api/v1/clinics/[clinicId]/reports/[name]/export/route.ts
- src/lib/reports/catalog.ts
- tests/unit/csv.test.ts

### src/lib/security/origin.ts

Matches exact request origin; development loopback-alias exception constrained to same port; production requires canonical configured origin and explicit Origin header. Evidence: security.test.ts.

Direct named callers/importers (6):

- src/app/auth/sign-in/route.ts
- src/app/auth/sign-out/route.ts
- src/app/auth/sign-up/route.ts
- src/lib/api/handler.ts
- tests/unit/api-boundaries.test.ts
- tests/unit/security.test.ts

### src/lib/security/rate-limit.ts

Bounded memory fixed-window counters locally; trusted single-IP identities with IPv6 prefix handling; production atomic Redis increments, hashes keys, bounds I/O, rejects redirects, validates response, and fails closed or explicitly degrades. Evidence: shared-rate-limit.test.ts, rate-limit-isolation.test.ts.

Direct named callers/importers (19):

- src/app/api/v1/certificates/[certificateId]/download/route.ts
- src/app/api/v1/clinics/[clinicId]/reports/[name]/export/route.ts
- src/app/api/v1/health/ready/route.ts
- src/app/api/v1/webhooks/sms/route.ts
- src/app/verify/[token]/page.tsx
- src/lib/api/handler.ts
- src/lib/auth/request.ts
- tests/unit/auth-cookies.test.ts
- tests/unit/auth-entry.test.ts
- tests/unit/auth-password-policy.test.ts
- tests/unit/config-errors.test.ts
- tests/unit/database-deadlines.test.ts
- tests/unit/download-export-limits.test.ts
- tests/unit/health-ready.test.ts
- tests/unit/privacy-acknowledgement-api.test.ts
- tests/unit/rate-limit-isolation.test.ts
- tests/unit/security.test.ts
- tests/unit/shared-rate-limit.test.ts
- tests/unit/supabase-session.test.ts

### src/lib/server/viewer.ts

Request-scoped React cache shares revalidated session/context; inactive account context discarded; clinic membership and MFA required before page reads. Evidence: viewer-access.test.ts, viewer-cache.test.ts.

Direct named callers/importers (36):

- src/app/account/page.tsx
- src/app/account/security/page.tsx
- src/app/children/[childId]/page.tsx
- src/app/children/layout.tsx
- src/app/children/page.tsx
- src/app/clinic/[clinicId]/access/page.tsx
- src/app/clinic/[clinicId]/admin/page.tsx
- src/app/clinic/[clinicId]/audit/page.tsx
- src/app/clinic/[clinicId]/children/[childId]/page.tsx
- src/app/clinic/[clinicId]/clinical/page.tsx
- src/app/clinic/[clinicId]/clinical/schedules/[versionId]/page.tsx
- src/app/clinic/[clinicId]/content/page.tsx
- src/app/clinic/[clinicId]/followup/page.tsx
- src/app/clinic/[clinicId]/inventory/cold-chain/page.tsx
- src/app/clinic/[clinicId]/inventory/page.tsx
- src/app/clinic/[clinicId]/inventory/transfers/page.tsx
- src/app/clinic/[clinicId]/layout.tsx
- src/app/clinic/[clinicId]/outage-forms/page.tsx
- src/app/clinic/[clinicId]/page.tsx
- src/app/clinic/[clinicId]/questions/page.tsx
- src/app/clinic/[clinicId]/reports/page.tsx
- src/app/clinic/[clinicId]/review/page.tsx
- src/app/clinic/[clinicId]/settings/page.tsx
- src/app/clinic/[clinicId]/today/page.tsx
- src/app/clinic/[clinicId]/transfers/page.tsx
- src/app/clinic/page.tsx
- src/app/display/[clinicId]/page.tsx
- src/app/evactrackstafflogin/create-account/page.tsx
- src/app/help/page.tsx
- src/app/layout.tsx
- src/app/messages/page.tsx
- src/app/page.tsx
- tests/unit/mfa-return-path.test.ts
- tests/unit/shell-layout.test.ts
- tests/unit/viewer-access.test.ts
- tests/unit/viewer-cache.test.ts

### src/lib/sms/dispatch.ts

Claims bounded leased SMS rows, sends outside DB transaction with idempotency id, then completes matching attempt; stale lease completion ignored. Evidence: sms-dispatch.test.ts, sms.test.ts.

Direct named callers/importers (2):

- src/lib/worker/outbox.ts
- tests/db/sms-dispatch.test.ts

### src/lib/sms/index.ts

Only none or sandbox providers supported; sandbox prohibited in production. Real SMS adapter is explicitly unimplemented. Evidence: sms.test.ts, worker-security.test.ts.

Direct named callers/importers (2):

- src/lib/worker/outbox.ts
- tests/unit/sms.test.ts

### src/lib/sms/provider.ts

Defines send/idempotency contract and bounded E.164 normalization with Philippine default; no actual external sender. Evidence: sms.test.ts.

Direct named callers/importers (6):

- src/app/api/v1/me/contact-preferences/route.ts
- src/app/auth/sign-up/route.ts
- src/lib/sms/dispatch.ts
- src/lib/sms/index.ts
- src/lib/sms/sandbox.ts
- tests/unit/sms.test.ts

### src/lib/sms/sandbox.ts

Deterministic process-local no-send provider, deduplicates ids and exposes fixture-only failure hooks. Demo simulation is not real SMS delivery. Evidence: sms.test.ts.

Direct named callers/importers (3):

- src/lib/sms/index.ts
- tests/db/sms-dispatch.test.ts
- tests/unit/sms.test.ts

### src/lib/sms/webhook.ts

Authenticates raw callback body with timing-safe HMAC comparison, validates event fields then performs parameterized restricted DB function call. Receipt duplicate/late handling lives in SQL. Evidence: webhook-route.test.ts, sms.test.ts.

Direct named callers/importers (3):

- src/app/api/v1/webhooks/sms/route.ts
- tests/db/sms-dispatch.test.ts
- tests/unit/sms.test.ts

### src/lib/staff-roles.ts

Display vocabulary mirrors SQL role names with readable fallback; labels never authorize access. Evidence: staff-entry.test.ts, staff-applications.test.ts.

Direct named callers/importers (9):

- src/app/clinic/[clinicId]/access/page.tsx
- src/app/clinic/[clinicId]/access/staff-forms.tsx
- src/app/clinic/[clinicId]/admin/application-decision.tsx
- src/app/clinic/[clinicId]/admin/page.tsx
- src/app/clinic/[clinicId]/layout.tsx
- src/app/clinic/application-forms.tsx
- src/app/clinic/page.tsx
- src/app/sign-up/sign-up-form.tsx
- tests/unit/staff-entry.test.ts

### src/lib/validation/account.ts

Own profile name/language; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (2):

- src/app/api/v1/me/profile/route.ts
- tests/unit/operational-gaps.test.ts

### src/lib/validation/administration.ts

Planned and exception recording, discriminated correction kinds; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (6):

- src/app/api/v1/clinics/[clinicId]/administrations/[eventId]/corrections/route.ts
- src/app/api/v1/clinics/[clinicId]/administrations/[eventId]/exception-decision/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/administration-exceptions/route.ts
- src/app/api/v1/clinics/[clinicId]/corrections/[caseId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/corrections/[caseId]/reject/route.ts
- src/app/api/v1/clinics/[clinicId]/encounters/[encounterId]/administrations/route.ts

### src/lib/validation/care.ts

Human-authored catch-up items, review decisions and staffed questions; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (7):

- src/app/api/v1/children/[childId]/checkins/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-items/[itemId]/status/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-plans/[planId]/cancel/route.ts
- src/app/api/v1/clinics/[clinicId]/catchup-plans/[planId]/review/route.ts
- src/app/api/v1/clinics/[clinicId]/checkin-policy/route.ts
- src/app/api/v1/clinics/[clinicId]/checkins/[checkinId]/answer/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/catchup-plans/route.ts

### src/lib/validation/certificates.ts

Issuance/revocation/read ids and public verification token; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (5):

- src/app/api/v1/clinics/[clinicId]/certificates/[certificateId]/revoke/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/certificates/route.ts
- src/app/api/v1/me/messages/read/route.ts
- src/app/api/v1/verify/[token]/route.ts
- src/app/verify/[token]/page.tsx

### src/lib/validation/clinical.ts

Outside-dose evidence, master data and bounded schedule envelope; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (13):

- src/app/api/v1/children/[childId]/outside-doses/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/outside-doses/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/antigens/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/products/route.ts
- src/app/api/v1/clinics/[clinicId]/clinical-master/status/route.ts
- src/app/api/v1/clinics/[clinicId]/evidence/[eventId]/verify/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/activate/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/retire/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/[versionId]/return/route.ts
- src/app/api/v1/clinics/[clinicId]/schedules/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/reject/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/locations/[locationId]/close/route.ts

### src/lib/validation/config.ts

Clinic profile, authored content and operations evidence; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (5):

- src/app/api/v1/clinics/[clinicId]/content/[versionId]/retire/route.ts
- src/app/api/v1/clinics/[clinicId]/content/[versionId]/review/route.ts
- src/app/api/v1/clinics/[clinicId]/content/route.ts
- src/app/api/v1/clinics/[clinicId]/ops/route.ts
- src/app/api/v1/clinics/[clinicId]/profile/route.ts

### src/lib/validation/followup.ts

Exact notice acknowledgement, holds and outreach outcomes; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (5):

- src/app/api/v1/clinics/[clinicId]/children/[childId]/followup-attempts/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/holds/route.ts
- src/app/api/v1/clinics/[clinicId]/holds/[holdId]/release/route.ts
- src/app/api/v1/clinics/[clinicId]/privacy-notice/acknowledge/route.ts
- src/app/api/v1/clinics/[clinicId]/privacy-notice/route.ts

### src/lib/validation/inventory.ts

Locations, lots, positive quantities, counts and disposition; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (7):

- src/app/api/v1/clinics/[clinicId]/stock/adjustments/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/locations/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/lots/[lotId]/disposition/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/lots/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/receipts/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/reconcile/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/wastage/route.ts

### src/lib/validation/messages.ts

Global plain-language Zod defaults, schema-written errors remain preferred; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (2):

- src/lib/api/handler.ts
- tests/unit/validation-messages.test.ts

### src/lib/validation/schemas.ts

Child registration/nullable patch fields, identity/link/review/merge/lifecycle boundaries; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (17):

- src/app/api/v1/children/[childId]/edit-requests/route.ts
- src/app/api/v1/children/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/record-status/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/route.ts
- src/app/api/v1/clinics/[clinicId]/children/route.ts
- src/app/api/v1/clinics/[clinicId]/guardians/[guardianId]/contact-invalid/route.ts
- src/app/api/v1/clinics/[clinicId]/merges/route.ts
- src/app/api/v1/clinics/[clinicId]/qr/resolve/route.ts
- src/app/api/v1/clinics/[clinicId]/relationships/[relationshipId]/status/route.ts
- src/app/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve-link/route.ts
- src/app/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve/route.ts
- src/app/api/v1/guardian-links/route.ts
- tests/unit/child-patch.test.ts
- tests/unit/operational-gaps.test.ts
- tests/unit/schemas.test.ts

### src/lib/validation/staff.ts

Role/capability vocabulary, membership/application versions and decisions; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (8):

- src/app/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/accept/route.ts
- src/app/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/reject/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/[membershipId]/approve/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/[membershipId]/revoke/route.ts
- src/app/api/v1/clinics/[clinicId]/staff/route.ts
- src/app/api/v1/me/staff-applications/route.ts
- src/app/auth/sign-up/route.ts
- tests/unit/iteration4-hints.test.ts

### src/lib/validation/transfer.ts

Child-record transfer targets and reasons; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (3):

- src/app/api/v1/children/[childId]/record-transfers/route.ts
- src/app/api/v1/clinics/[clinicId]/children/[childId]/record-transfer/route.ts
- src/app/api/v1/clinics/[clinicId]/record-transfers/[transferId]/decline/route.ts

### src/lib/validation/transfers.ts

Stock-custody quantities, temperature/time readings and excursion decisions; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (7):

- src/app/api/v1/clinics/[clinicId]/stock/temperature/[readingId]/review/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/temperature/limits/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/temperature/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/cancel/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/receive/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/resolve/route.ts
- src/app/api/v1/clinics/[clinicId]/stock/transfers/route.ts

### src/lib/validation/visits.ts

Session capacity/time relationships, booking and queue state/version vocabulary; schemas use bounded typed fields and strict objects except the intentionally loose schedule envelope validated authoritatively in SQL. Cross-field/state/authorization rules remain in SQL; API schema success never authorizes a mutation. Evidence: schemas.test.ts, api-boundaries.test.ts and associated DB workflow suite.

Direct named callers/importers (12):

- src/app/api/v1/appointments/[appointmentId]/cancel/route.ts
- src/app/api/v1/appointments/[appointmentId]/reschedule/route.ts
- src/app/api/v1/appointments/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/[entryId]/priority/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/[entryId]/transition/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/call-next/route.ts
- src/app/api/v1/clinics/[clinicId]/queue/check-in/route.ts
- src/app/api/v1/clinics/[clinicId]/service-days/close/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/[sessionId]/cancel/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/[sessionId]/capacity/route.ts
- src/app/api/v1/clinics/[clinicId]/sessions/route.ts
- tests/unit/operational-gaps.test.ts

### src/lib/worker/loop.ts

Retries failed passes with capped backoff, structured redacted logs, once exit codes and abortable sleep; finishes in-flight pass before shutdown. Evidence: worker-loop.test.ts.

Direct named callers/importers (2):

- scripts/worker.ts
- tests/unit/worker-loop.test.ts

### src/lib/worker/outbox.ts

Least-privilege separate DB URL, bounded connection/statement/read deadlines, maintenance then outbox/SMS; closes connection in finally and serializes in-process ticks. Production web process does not start poller. Evidence: worker-security.test.ts, worker-loop.test.ts.

Direct named callers/importers (6):

- scripts/worker.ts
- src/instrumentation.ts
- src/lib/worker/loop.ts
- tests/unit/database-deadlines.test.ts
- tests/unit/worker-loop.test.ts
- tests/unit/worker-security.test.ts

## Assets and limits

Certificate font asset src/lib/certificates/fonts/NotoSansSC.ttf is loaded by path in pdf.ts, rather than a TS import. Its README and SIL license document the static/subset font workflow; existing PDF test evidence covers glyphs/pagination/storage. This pass did not re-render it.

No further verified backend defect was found during this module inventory. The inventory and chained-correction defects identified earlier were fixed with migrations 0045 and 0047 and regression tests; existing historical erroneous stock movements are not automatically rewritten. Production Redis, hosted ingress, real SMS/provider delivery and clinical-policy acceptance remain outside local verification.
