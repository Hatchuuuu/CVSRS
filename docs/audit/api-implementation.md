# API hardening implementation — 2026-09-30

## E08 and recommended API-07/08/10 changes

- The shared JSON handler reads request streams with a byte bound before `JSON.parse` or RPC client creation: 1,000,000 bytes by default, 5,000,000 bytes for schedule import. It counts UTF-8 bytes across chunks, rejects declared oversized bodies early, rejects invalid UTF-8 and malformed JSON, and returns a safe 413 or 400 response. The SMS callback has a separate 10,000-byte bound.
- The SMS callback verifies a strictly formatted HMAC-SHA256 signature and validates the event before asking for the worker DB URL or constructing a privileged client. A valid callback still records through `private.record_sms_event`. Missing secret, absent/bad signature, oversized body, and malformed event fail before connection construction.
- `CVSRS_PUBLIC_URL` must be one canonical HTTPS origin in production when app configuration is initialized. Certificate QR links always use this origin in production; no request-host fallback is allowed. In development only, an unset URL falls back to the request origin. Explicitly configured URLs are validated in every environment.
- CSRF checks compare the complete origin (scheme, host, and port) with the server request URL. In production, that URL must match `CVSRS_PUBLIC_URL`; a forged Host header cannot make a foreign origin acceptable. If Origin is absent, the existing `Sec-Fetch-Site: same-origin` fallback remains. The deployment ingress must normalize the URL/Host/scheme and strip client-supplied forwarding headers. This code does not treat `x-forwarded-host` or `x-forwarded-proto` as authoritative.
- Message, audit, follow-up, and temperature list query counts now accept only positive, whole, in-range integers, using the existing defaults when absent. Invalid values receive `invalid_request` 400 rather than reaching SQL.
- Shared and custom routes use the same error envelope (`error.code`, safe message, retryable flag, request ID), `x-request-id`, no-store, and a `Retry-After` value for rate limiting. Binary PDF/CSV success bodies retain their respective content types.

## Validation

- Red-green unit tests reproduced: scheme mismatch acceptance, request-host certificate fallback, absent body limits, negative/decimal query limits, pre-validation webhook DB construction, multibyte webhook overflow, and a hex HMAC with a trailing nibble being accepted.
- Focused tests cover webhook connection sequencing with a client constructor spy, malformed signed JSON, 10,000-byte overflow, stream chunk UTF-8 byte accounting, declared body size, generic malformed JSON and 1 MB multibyte rejection before RPC construction, public URL validation, and production origin pinning.
- After the final HMAC format change, `npm run test:unit` passed (46 tests), `npm run typecheck` passed, and targeted ESLint passed for changed API/security/test files.

## Remaining dependencies and new discoveries

- The sign-up form directs confirmation links straight to `/children` and the app has no `/auth/callback` handler. Browser Supabase client behavior and deployed Auth email template/redirect allow-list must be tested together in staging; no provider-backed confirmation or PKCE exchange was proven locally. Password recovery has no self-service route or form; the sign-in UI sends users to clinic support. G01 remains failed. This implementation does not create an untested token exchange or recovery policy.
- E13 remains: the callback and in-process worker still use the configured privileged worker connection, and the IP key for rate limiting still relies on an ingress-normalized `x-forwarded-for` plus process-local counters. Shared ingress limits and least-privilege worker credentials remain deployment work.
- E13 certificate content authenticity remains separate from canonical URL validation: a checksum proves byte integrity only. A public `store_certificate_pdf` caller may need renderer attestation or a restricted storage role; the certificate transaction work must address generation binding and this trust boundary independently.
