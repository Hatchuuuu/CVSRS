# Review R2-A: batch 1 security work (Impl A)

Reviewer: independent code reviewer R2-A, model `claude-opus-5-5`, 2026-10-02. I did not write this code. I edited no source, test, migration or config file. Throwaway probe tests are in `.local/audit-scratch/review2-sec/` (gitignored) and are not part of the suite.

Scope: SEC-01, SEC-02, SEC-03 (cookies + staff idle sign-out; step-up was deferred and is not judged), SEC-04, SEC-06, FE-19, and a check that FE-03 still works. I reviewed against the Location / Solution / Acceptance text in `docs/engineering/discovery/security.md` and `frontend.md`.

Files reviewed (changes since `HEAD` from `git diff HEAD`, or untracked): `src/lib/security/rate-limit.ts`, `src/lib/api/handler.ts`, `src/lib/api/errors.ts`, `src/lib/env.ts`, `src/lib/db/index.ts`, `src/lib/db/supabase.ts`, `src/lib/auth/{request,cookies,session-policy,password-policy,redirect}.ts`, `src/app/auth/{sign-in,sign-up,callback,sign-out}/route.ts`, `src/app/auth/signed-out/page.tsx`, `src/proxy.ts`, `src/lib/client/supabase-browser.ts`, `src/components/{idle-monitor.ts,staff-idle-sign-out.tsx,sign-out-button.tsx}`, `src/app/api/v1/{webhooks/sms,verify/[token],guardian-links}/route.ts`, `src/app/api/v1/clinics/[clinicId]/{queue/display,qr/resolve}/route.ts`, `src/app/api/v1/certificates/[certificateId]/download/route.ts`, `src/app/api/v1/clinics/[clinicId]/reports/[name]/export/route.ts`, `src/app/verify/[token]/page.tsx`, `src/app/sign-up/sign-up-form.tsx`, `src/app/account/reset-password/reset-password-form.tsx`, `src/app/account/security/page.tsx`, `src/lib/server/viewer.ts`, `src/app/layout.tsx` (only the idle mount and config error), `src/lib/security/origin.ts`, `src/lib/sms/webhook.ts`, `.env.example`, `README.md:72`, `docs/engineering/manual-setup.md`. I also read auth-js `GoTrueClient._signOut` (the installed version) and the Next 16 `cookies()` docs (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/cookies.md`: in Route Handlers, `.set` writes outgoing `Set-Cookie`).

## Gates run

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **First run (18:20) FAILED** at `src/app/layout.tsx:167,176,198`: `ThemeChoice` and `ThemeToggle` not found. The file had been modified at 18:20:00, 23 s earlier, by a concurrent session. It is not Impl A's code. **Re-run (18:23, after that edit settled): PASS (exit 0).** |
| `npx eslint` on every file listed above | PASS (exit 0) |
| `npx vitest run` on `rate-limit-isolation`, `shared-rate-limit`, `sign-out`, `auth-callback`, `auth-cookies`, `auth-entry`, `auth-password-policy`, `auth-redirect`, `idle-monitor`, `api-handler`, `config-errors`, `webhook-route`, `worker-security`, `mfa-return-path`, `security`, `viewer-access` | 16 files, 147/147 PASS, run twice (before and after the layout edit) |
| Scratch probes: `npx vitest run --config .local/audit-scratch/review2-sec/vitest.scratch.config.ts` | 6/6 pass. Each probe asserts that a defect is present, so a pass means the defect was reproduced (see RV2-A-01, -02, -04, -05) |

Not run, as instructed: `npm run test:db`, `next build`, dev servers.

## Verdicts

| ID | Verdict | Reason |
|---|---|---|
| SEC-01 | **REWORK** (narrow) | The structure is right. `handler.ts:61-76,106`: a pre-auth bucket per trusted address and route, a post-auth bucket per user, and display keys that include the clinic id. `env.ts:49-61`: production refuses to start without a trusted source or an explicit opt-in. `sms/route.ts:21-35`: the HMAC is checked before any shared allowance is charged. The listed acceptance tests pass. However, the client identity is the raw header string (`rate-limit.ts:52-53`), and sign-in still has a deployment-wide hard deny of 1,000/min (`auth/request.ts:66-69,81`). Ten addresses, or one IPv6 host rotating inside its /64, lock every user out of sign-in. I reproduced this (RV2-A-01, P1). That is the outage SEC-01 was raised for, at a slightly higher attacker cost. |
| SEC-02 | **APPROVE** | `sign-out/route.ts:59-70` expires every `sb-*-auth-token*` cookie (chunks and verifier, `cookies.ts:121-123`) whatever the SDK returns. Revocation is bounded at 2.5 s (`:22-34`, `SIGN_OUT_TIMEOUT_MS`). Late SDK writes are blocked (`isOpen`). An unconfirmed revocation, including a config failure (`cfg` null), lands on `/auth/signed-out`, which says so plainly. POST is same-origin only (`:39`, `origin.ts`, which requires `Origin` in production). Redirects are fixed relative paths. When there is no session, auth-js `_signOut` returns `{error:null}` (`GoTrueClient.js:3433-3456`), so a duplicate sign-out from a second tab correctly gets `/`. `sign-out.test.ts` uses the real SDK. |
| SEC-03 | **REWORK** (idle monitor only; cookie policy approved) | Cookies: one policy (`cookies.ts:112-118`) is applied at every write site: sign-in, sign-up, callback, sign-out, proxy, the RPC client and the browser client. It sets `Path=/`, `SameSite=Lax`, host-only, `Secure` when `NODE_ENV=production`, a bounded `Max-Age` (12 h by default, range checked, a typo fails closed through `getConfig`), and keeps removals as removals. Not HttpOnly, as documented (needed by the browser SDK). The callback comment is corrected. Idle sign-out mounts for active staff only (`layout.tsx:235`). It is SSR-safe, cleans up listeners and the interval on unmount, shares activity across tabs, warns for 60 s, and the warning needs an explicit choice. Defects: input that arrives after the deadline but before the next tick restarts the period instead of signing out (reproduced). A sign-out in one tab leaves other tabs showing records (RV2-A-02, P2). Browser-side cookie writes lose the `Max-Age` (RV2-A-03, P3, follow-up only). |
| SEC-04 | **APPROVE** | `limitRequest(..., { onStoreFailure })` (`rate-limit.ts:85-111`). `"closed"` is used by sign-in and sign-up (`auth/request.ts:84`), the verify API (`verify/[token]/route.ts:5`), the verify page (`verify/[token]/page.tsx:35`), guardian-links, qr/resolve and the SMS webhook. Other routes default to `"degrade"` (`handler.ts:63`). The acceptance test exists (`rate-limit-isolation.test.ts:149`) and README:72 is corrected. |
| SEC-06 | **APPROVE with follow-up** | `db/index.ts:15-20` returns `safeMessage("misconfigured")` and logs the detail with the request id. The same holds for `rate-limit.ts:43-47`, `layout.tsx:35-46`, auth routes (`authException` → generic 503) and the callback (bare 503). `config-errors.test.ts` covers this. Follow-up RV2-A-05 (P3, already present before this work): a *malformed* value raises a ZodError, which becomes 500 "internal", and operators see only "unhandled ZodError". |
| FE-19 | **APPROVE with follow-up** | One constant, one hint and one check (`password-policy.ts:41-50`) are used by the sign-up form, the sign-up route (server-enforced, `sign-up/route.ts:28-29`) and the reset form. The messages are identical. Follow-up RV2-A-06 (P3): the reset path is enforced on the server only by Supabase's own minimum, and `manual-setup.md:33` tells operators "8 or more". |
| FE-03 | **APPROVE** (nothing broken) | `requireClinicStaff` → `securityPageFor('/clinic/<id>')` (`viewer.ts:67`). `clinicReturnPath` is strict (`redirect.ts:9-20`). The security page validates `next` again before use (`account/security/page.tsx`). `mfa-return-path.test.ts` passes. Nit only: the comment at `viewer.ts:61` ("does not take a return address yet") is now stale. |

## New defects

### RV2-A-01 — Rate-limit client identity is the raw header string, and sign-in keeps a 1,000/min deployment-wide hard deny: ten addresses, or one IPv6 host, lock all users out of sign-in
- Priority: P1
- Class: Reproduced defect (unit level). Ingress behaviour for IPv6 is inferred.
- Location: `src/lib/security/rate-limit.ts:50-53` (`value = headers.get(header)?.trim().slice(0,128)` is used verbatim as the identity); `src/lib/auth/request.ts:66-69` (`"sign-in": { …, global: 1_000 }`, `"sign-up": { …, global: 300 }`), `:79-86` (every attempt, successful or not, is charged to `auth/<page>|global`).
- Evidence: `.local/audit-scratch/review2-sec/probes.probe.ts`, "deployment-wide sign-in ceiling". With `CVSRS_TRUSTED_CLIENT_IP_HEADER=x-client-ip`, 10 addresses `2001:db8::0`…`2001:db8::9` each sent 100 failed sign-ins with distinct emails. Each address stays at its own per-address limit (100/min), so every attempt also counts toward the global bucket. Output: `victim status after 10x100 distributed attempts: 429`. A different, innocent client signing in to a different account was refused. A host on a residential or cloud IPv6 /64 controls 2^64 such addresses, and the ingress real-IP headers that the docs point to normally carry the full IPv6 address. Related probe ("appending forwarders"): when the configured header holds a list (an operator naming `x-forwarded-for` behind an appending proxy), `"1.1.1.1, 198.51.100.7"` and `"2.2.2.2, 198.51.100.7"` become two identities. A spoofed prefix mints a fresh identity on every request, which bypasses all per-address limits. `.env.example:42` warns against this, but the code does not enforce it.
- Impact: Anyone with one IPv6-connected machine (or about 10 IPv4 addresses) can deny sign-in to every guardian and staff member for as long as they send about 17 requests per second. This is the essential-flow outage in SEC-01's acceptance ("31 failed sign-ins from client X do not change client Y's outcome" holds only for a single non-rotating client). IPv6 rotation also bypasses every other per-address bucket (pre-auth API, verify, display, unsigned webhook).
- Root cause: The address is not normalized to the unit an attacker actually controls. The deployment-wide sign-in valve is a hard deny for everyone, set low enough that a small distributed client can reach it, and legitimate successful sign-ins also count toward it.
- Solution: (1) In `clientAddress`, parse the header value. Reject or treat as missing any value that is not one IP literal (no lists, no ports). Key IPv4 by address and IPv6 by its /64 prefix. (2) In `authRateLimit`, charge the `address` and `global` buckets only for failed attempts (check them first, increment after a credential failure), or keep counting attempts but raise `global` well above reach and treat it as an alerting valve, with the reasoning documented. Either way, a fresh client must not be refused because other addresses failed. (3) Note in `manual-setup.md` that Supabase Auth's own per-IP sign-in limit applies to the web server's single address (carried over from SEC-01, external).
- Acceptance: 100 failed sign-ins from each of 64 different addresses in one IPv6 /64 are throttled as one client. 10 IPv4 addresses × 100 failed attempts do not produce 429 for a fresh client. A list-valued or non-IP header value is not used as an identity.
- Verification: Add both cases to `tests/unit/rate-limit-isolation.test.ts`. Add unit tests for `clientAddress` normalization in `shared-rate-limit.test.ts`.

### RV2-A-02 — Idle sign-out can be cancelled by input that arrives after the deadline but before the next tick, and a sign-out in one tab leaves other tabs showing records
- Priority: P2
- Class: Reproduced defect (unit level for the revival). Cross-tab behaviour is inferred from the code.
- Location: `src/components/idle-monitor.ts:46-52` (`reset`), `:65-69` (`activity` checks only the stored `phase`, never the clock); `src/components/staff-idle-sign-out.tsx:109-150` (no sign-out broadcast between tabs).
- Evidence: Probe "idle monitor revival": `createIdleMonitor({ idleMs: 15 min })`, `start()`. The clock moves to 40 min with no tick having run, as happens with a sleeping laptop or a hidden tab under Chrome's intensive timer throttling (one wake-up per minute). Then `activity(now)` → returns `true`, and the next tick never reports `expired` (`phases: []`). The existing test `idle-monitor.test.ts:69` covers only the order where the tick comes first. Cross-tab: the expiring tab submits `/auth/sign-out`, but nothing tells the other tabs. A hidden tab keeps its rendered clinic page until its own throttled tick, and if anyone touches it before that tick, the revival above gives it another full 15 minutes on screen. A manual "Sign out" in one tab leaves other tabs showing records indefinitely.
- Impact: On a shared clinic terminal, the shift-handover case the control exists for, an unattended session's records can stay visible, and in the revival case the session itself continues, after the agreed idle period. This defeats SEC-03's acceptance "an idle staff terminal is signed out after the agreed period" in plausible timing conditions.
- Root cause: `activity()` trusts the cached phase instead of re-evaluating against the wall clock. There is no signal between tabs when one tab signs out.
- Solution: In `activity()` (and `dismiss()`), first compute `idlePhase(now(), last, idleMs, warningMs)`. If it is `expired`, set the phase, call `onChange`, stop, and return `false`. In `StaffIdleSignOut`, when expiry or "Sign out now" happens, and from `SignOutButton` on confirm, write a `cvsrs:staff-signed-out` key to `localStorage` (or use a `BroadcastChannel`). Every tab that receives it submits its own sign-out form, or navigates to `/auth/signed-out`. Optionally also listen for `visibilitychange` and evaluate immediately when the tab becomes visible.
- Acceptance: With no tick past the deadline, `activity()` returns false and the monitor reports `expired`. Signing out in tab A causes tab B to leave the staff page within one second of the storage event.
- Verification: Add a unit test in `tests/unit/idle-monitor.test.ts` (the probe above, inverted). Add a component test, or a jsdom test with a dispatched `StorageEvent`, for the broadcast.

### RV2-A-03 — Session cookies written by the browser SDK lose the bounded Max-Age and become browser-session cookies
- Priority: P3
- Class: Inspection risk
- Location: `src/lib/auth/cookies.ts:107-109` (`browserSessionCookiePolicy` → `maxAgeSeconds: null`); `src/lib/client/supabase-browser.ts:11-16`; users: `src/app/account/security/mfa-panel.tsx` (MFA verify writes the aal2 session), `src/app/account/reset-password/reset-password-form.tsx`.
- Evidence: After MFA verification, the browser SDK rewrites `sb-*-auth-token` without `Max-Age`. The proxy rewrites it with the server `Max-Age` only when it refreshes an expired access token (`proxy.ts:42-52`). Until then, typically up to an hour and only if the user navigates, the staff aal2 session is a session cookie. Browsers with "continue where you left off" restore session cookies with no time limit, so the 12-hour bound (SEC-03 acceptance "the agreed Max-Age") does not hold for that window. This is still far better than the previous 400 days, hence P3.
- Impact: Narrow. A staff terminal whose browser restores sessions can keep a freshly MFA-verified session past the configured lifetime if the browser is closed soon after verification.
- Solution: Send the lifetime to the browser policy, either as a build-time `NEXT_PUBLIC_CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS` validated by the same parser, or by using `DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS` in the browser policy. Alternatively, after MFA verify, call a small same-origin POST route that rewrites the cookies with the server policy.
- Acceptance: Every non-removal cookie write, browser or server, carries the configured `Max-Age`.
- Verification: Extend `tests/unit/auth-cookies.test.ts` for the browser policy.

### RV2-A-04 — A non-id route segment lets an unauthenticated client mint a fresh pre-auth bucket per request, and the in-process limiter map is bounded only by expiry
- Priority: P3
- Class: Reproduced defect (key minting). The memory growth is inferred.
- Location: `src/lib/security/rate-limit.ts:57-59` (`routePattern` normalizes only UUIDs and `verify/<token>`); `src/lib/api/handler.ts:61,71` (pre-auth key = address + `routePattern`); `src/app/api/v1/clinics/[clinicId]/reports/[name]/route.ts` (the `[name]` segment is not an id, so it is not validated before the limit); `src/lib/security/rate-limit.ts:11-16` (`hit()` evicts only expired entries, scanning the whole map on each insert above 10,000).
- Evidence: Probe "pre-auth key minting": a route with `limit: 1` queried 30 times by one unauthenticated address, with `/reports/x0`…`/reports/x29` → never 429, while 30 requests to a fixed `/reports/x` → 429. In production the keys go to Redis with a TTL, so the cost there is store quota. While the circuit is open (`degrade`), and in development, each minted key is an in-process `Map` entry that lives for the window. Above 10,000 live entries, every new key triggers a full scan.
- Impact: Low. The request still ends at 401, but the pre-auth limit on that route is ineffective. During a store outage an attacker can grow process memory and CPU on authenticated routes.
- Solution: Pass a static scope (the route template) into `api()` instead of deriving it from the URL, or replace every dynamic segment rather than only UUIDs. Validate `name` against the report allowlist before charging. Give `hit()` a hard cap: when the map is full, evict the oldest entries, or fail closed for new keys.
- Acceptance: Varying a non-id path segment does not create new pre-auth buckets. The map never exceeds its cap.
- Verification: Add a unit test in `tests/unit/api-handler.test.ts` and one for `hit()` capping.

### RV2-A-05 — A malformed configuration value becomes a generic 500 with no usable operator log
- Priority: P3
- Class: Reproduced defect (behaviour existed before this work; it is part of SEC-06's "still useful to operators")
- Location: `src/lib/env.ts:76-81` (`schema.parse` throws `ZodError`, not `ConfigError`); `src/lib/db/index.ts:15-21` (re-throws non-ConfigError); `src/lib/api/handler.ts:118` (logs the error class only).
- Evidence: `.local/audit-scratch/review2-sec/config.probe.ts` with `NEXT_PUBLIC_SUPABASE_URL=project.supabase.co` (no scheme): `status 500 {"code":"internal","message":"Something went wrong on our side."}`. The operator log is exactly `"[<requestId>] unhandled ZodError"`. A missing value gives a clear 503 plus a logged reason. A malformed one gives a 500 that looks like a code fault and names no variable.
- Impact: Operators cannot tell a configuration typo from an application bug during deployment. Clients get a non-retryable 500 instead of the documented "not configured" 503.
- Solution: Wrap `schema.parse` in `getConfig`. On failure, throw `ConfigError` listing the failing variable names (from `issue.path`, never the values).
- Acceptance: A malformed `NEXT_PUBLIC_SUPABASE_URL` returns 503 `misconfigured` with the safe message. The server log names `NEXT_PUBLIC_SUPABASE_URL` and the request id, and does not contain the value.
- Verification: Add a second case to `tests/unit/config-errors.test.ts`.

### RV2-A-06 — The operator guide sets Supabase's password minimum to 8, below the 12-character rule, so the reset path is not enforced at 12 on the server
- Priority: P3
- Class: Missing required behavior (documentation and external setting)
- Location: `docs/engineering/manual-setup.md:33` ("Password minimum length | 8 or more | the app rejects shorter passwords before calling Auth"); `src/lib/auth/password-policy.ts:38` ("keep that minimum at or below this one"); `src/app/account/reset-password/reset-password-form.tsx:46` (`browserSupabase().auth.updateUser({ password })` goes straight from the browser to Supabase Auth).
- Evidence: Sign-up is enforced on the server at 12 (`sign-up/route.ts:28-29`). A password change goes from the browser directly to Supabase, so the only server-side rule there is the Supabase project minimum, which the guide sets to 8. The comment allows any value at or below 12.
- Impact: Anyone who calls Auth directly with the publishable key and a session can set a password shorter than the documented rule. The rule is consistent in the UI but not enforced at one boundary.
- Solution: Set the Supabase "Minimum password length" to 12 (equal to `PASSWORD_MIN_LENGTH`). Change the guide row and the `password-policy.ts` comment to say "equal to".
- Acceptance: `manual-setup.md` and the code comment state 12. The setting is recorded as external evidence once applied.
- Verification: Review the documents. Supabase dashboard evidence is a manual setup item.

## Residual notes (not defects; for the record)

- The pre-auth bucket per address on authenticated routes (`PRE_AUTH_FACTOR × limit`) is shared by every user behind one carrier-grade NAT address, which is common on mobile networks. One unauthenticated client on that address can exhaust it for the others, for example 100/min for guardian check-ins. Finding SEC-01's Solution asked for this design, and it protects the per-request `getUser()` call to Auth. Revisit if mobile families report 429s.
- The SMS signature covers the body only, with no timestamp (`src/lib/sms/webhook.ts:6-13`). A captured signed callback could be replayed to fill the shared `sms-webhook|signed` bucket. Capturing one requires breaking TLS, and SMS is documented as off until a real adapter exists. Add a signed timestamp when the provider contract is known.
- While the circuit is half-open, every request that arrives in the probe window waits up to 2.5 s and then gets 503, not just a single probe (`rate-limit.ts:107-136`). This is acceptable degradation and is documented in README:72.
- The proxy returns `500 "Service Configuration Error"` in production for any exception thrown during the session refresh (`proxy.ts:53-57`). auth-js returns network failures as values, so in practice this is limited to unexpected faults. The wording is generic, so nothing leaks.

## Rework list

1. **SEC-01 / RV2-A-01 (P1)**:
   - `src/lib/security/rate-limit.ts` `clientAddress`: accept only a single IP literal from the trusted header. Treat lists, ports and other values as `missing-client-header`. Key IPv6 by /64.
   - `src/lib/auth/request.ts` `authRateLimit`: stop a small set of addresses from hard-denying every user. Either charge `address` and `global` only on credential failure (the sign-in and sign-up routes would then report the outcome back), or raise `global` beyond small-attacker reach and document it as an alerting valve.
   - Tests: `tests/unit/rate-limit-isolation.test.ts` and `tests/unit/shared-rate-limit.test.ts` as in the Acceptance above.
2. **SEC-03 / RV2-A-02 (P2)**:
   - `src/components/idle-monitor.ts`: `activity()` and `dismiss()` must re-evaluate the wall clock and refuse to revive an expired period.
   - `src/components/staff-idle-sign-out.tsx` and `src/components/sign-out-button.tsx`: broadcast sign-out to the other tabs (storage key or BroadcastChannel). Receiving tabs sign out or leave the staff page.
   - Tests: `tests/unit/idle-monitor.test.ts`.
3. Follow-ups that need no rework for approval, and can go to batch 2:
   - RV2-A-03: browser cookie `Max-Age` in `src/lib/auth/cookies.ts` and `src/lib/client/supabase-browser.ts`.
   - RV2-A-04: route-template scope in `src/lib/api/handler.ts`, and a cap on `hit()` in `rate-limit.ts`.
   - RV2-A-05: ConfigError for schema failures in `src/lib/env.ts`.
   - RV2-A-06: `docs/engineering/manual-setup.md:33` and the `password-policy.ts:38` comment, plus the Supabase setting.
   - The stale comment at `src/lib/server/viewer.ts:61`.
