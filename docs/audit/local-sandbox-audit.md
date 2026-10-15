# Local sandbox audit and implementation blueprint

Date: 2026-09-30. Reviewer: ASTRA. Scope: source audit and bounded implementation plan for a locally usable CVSRS sandbox without operator-supplied backend services or API keys. Existing uncommitted work is the baseline and must be preserved.

This document records findings at the start of this change, not a claim that all findings remain open. Implementation and final verification are tracked separately. The review inspected configuration, authentication, PostgreSQL adapters, database fixtures, clinical setup, certificates, worker behavior and shared UI. It is not exhaustive production, clinical or accessibility certification.

## Existing foundation

The application already has a local PostgreSQL RPC adapter that invokes the same allowlisted database commands under real `authenticated`/`anon` roles and JWT-style claims. Database authorization, transactions and clinical approvals can therefore be exercised locally without a substitute in-memory clinical implementation. Supabase Auth, MFA and PostgREST remain separate integration concerns.

`supabase/demo/demo-schedule.ts` already contains explicitly fictional antigens, products, arbitrary schedule rules and engine fixtures. `tests/db/clinical-setup.ts` demonstrates the governed creation, approval and activation sequence. These should be reused rather than introducing medical recommendations. Semantic color tokens, visible focus styles, shared fields/status components, timezone-aware clinic dates and explicit two-person approvals are useful foundations to retain.

## Confirmed baseline findings

| Priority | Finding and source | Impact / required action |
| --- | --- | --- |
| P0 | `package.json` starts Next only; `scripts/setup-local.ts` assumes a migrated database and intentionally creates no accounts. | The requested local experience cannot start unaided. Add one automatic, isolated demo launcher. |
| P1 | `src/app/auth/sign-in/route.ts` accepts email-prefix matching and silently falls back to the clinical lead when no identity matches. | Invalid input selects a privileged synthetic account. Require an explicit eligible persona and reject unknown identities. |
| P1 | `src/app/auth/sign-up/route.ts` signs into an existing email without verifying credentials and labels newly inserted guardian contacts verified. | Local registration implies account ownership and verification that never occurred. Replace local signup with explicit sandbox persona selection or a separately bounded synthetic-only creation flow. |
| P1 | `src/app/sign-in/sign-in-form.tsx` always renders fixed test identities and advertises phone/staff-ID authentication while the Supabase branch accepts email/password. | Test shortcuts leak into the real-authentication UI; advertised input types cannot work. Render server-listed demo accounts only for demo mode and label the real form accurately. |
| P1 | Sign-in/signup pages claim an official Philippine registry, DOH regulation/affiliation, privacy-law compliance and “SHA-256 TLS” without supporting project evidence. | Misleading institutional/security assurances. Use factual clinic-managed CVSRS wording. |
| P1 | `src/app/layout.tsx` does not display available demo context; `src/lib/certificates/pdf.ts` has no synthetic-record marking. | A fictional clinical demonstration can resemble a real record, especially when exported. Label anonymous/authenticated pages, certificate verification and each PDF page. |
| P2 | `src/app/account/security/page.tsx` describes simulated local MFA as missing setup. | Users are directed toward configuration that is intentionally absent in the demo. Explain simulated authentication. |
| P2 | README, implementation status and limitations say local login was removed although the source still includes it. | Operating instructions disagree with actual runtime behavior. Document the isolated demo and separate Supabase deployment path accurately. |
| P2 | `src/lib/security/rate-limit.ts` switches production requests to a per-process memory limiter after five shared-store failures. README/limitations describe fail-closed behavior. | The implementation does not maintain a shared production limit during that degradation window. Preserve this as an explicit production limitation or separately change and test the contract; do not claim it fails closed on every outage. |

## Design engineering review

The requested work is an operational refinement. Preserve existing teal clinical identity, task hierarchy, patient identity emphasis and clinical semantics. No new visual world or invented clinical/organizational claims are needed.

| Before | After | Why |
| --- | --- | --- |
| Clinic navigation staggers into view and moves laterally on hover. | Immediate navigation with short explicit color/background feedback. | Repeated clinical navigation should be stable and fast. |
| Shared section titles and containers replay entrance motion. | Static routine operational content; reserve motion for occasional state changes. | Repeated work does not benefit from decorative delays. |
| Reduced-motion rule sets `0.01ms` durations but leaves stagger delays up to 300 ms. | Immediately visible content without movement or animation delay; retain short color/opacity feedback when useful. | Delayed appearances remain under the old override. |
| Password reveal lacks a guaranteed 44-pixel target; role selection lacks exposed selected-state semantics. | Adequate touch target and explicit pressed/selected state. | Improves touch and assistive-technology interaction. |
| Form container rises on hover. | Stable form container with feedback on the actual controls. | Keeps text entry visually steady. |

Impeccable context ran once and identified an incumbent implementation without PRODUCT.md/DESIGN.md. Narrow refinement is permitted on existing evidence. The source detector found one stylistic issue at the patient strip's thick left border (`src/components/ui.tsx`). That accent can legitimately reinforce patient identity; it is not a demonstrated functional defect. No numerical accessibility/visual score is assigned without browser evidence.

## Bounded implementation blueprint

1. Add `npm run demo`. Use a dedicated persisted cluster at `.local/demo-pgdata`, database `cvsrs_demo`, loopback PostgreSQL port 54330 and loopback Next server. Bundle/download PostgreSQL through `embedded-postgres` so no manual database installation is required. Never reset the existing `.local/pgdata` cluster, `cvsrs_dev`, another configured database, or untracked data.
2. Create a migration manifest with checksums and an idempotent seed marker. Repeat launches preserve user edits. Refuse unexpected paths, mismatched migration history and occupied ports rather than silently attaching to unrelated services.
3. Build a clean child environment. Suppress inherited Supabase, worker, SMS and deployment service credentials; prevent `.env.local` from repopulating them. Generate and persist a local certificate secret, provision the same isolated DB secret, and pass it to Next. Keep production local-mode rejection intact.
4. Set database demo mode and provision explicitly synthetic personas: two clinical leads, nurse, assistant, inventory, technical administrator, BHW and two families. Use reserved `.test` email addresses and a seed metadata marker. Initial identities/grants may be setup fixtures; subsequent clinical records use real command/RLS paths.
5. Reuse the fictional schedule and governed approval flow. Seed a small number of fictional children and guardian relationships with varied verification states, current/future sessions, received stock, a waiting visit and one recorded administration. Keep date handling in the clinic timezone and avoid real vaccine rules.
6. Share one guarded local persona selector across authentication entry routes and session reads. Require demo-mode database, eligible synthetic account and active profile. Reject unknown, ambiguous, production, non-demo and inactive identities. Route each staff role to a page its capabilities actually permit.
7. Show the demo state on anonymous and authenticated pages, simulated-MFA information on account security, and explicit nonclinical marking on every certificate PDF page and public verification. Do not imply real SMS/email transport, approved clinical policy or real identity verification.
8. Apply the focused UI corrections above and reconcile documentation with actual operating behavior. Keep the supplied production and clinical limitations explicit.

## Acceptance and evidence boundaries

- Baseline check reported by the coordinating agent: typecheck, lint and 92 unit tests passed before this change. The reviewer did not independently rerun that baseline.
- New checks must cover explicit account rejection, disabled demo mode, production isolation, malformed/bounded requests, seed/relaunch persistence and PDF demo marking.
- Run typecheck, lint, unit checks and relevant real-database regressions. Compilation alone does not establish browser or Supabase correctness.
- Exercise anonymous/family and each staff role in the local application. Verify a real booking or registration mutation, queue progression, recorded-dose/inventory behavior, messages, sign-out and certificate download/verification, with fresh-page persistence.
- Inspect desktop and narrow mobile together, including keyboard focus and reduced motion; fix findings in one batch and confirm once. Do not enter an open-ended polish cycle.
- Supabase Auth/MFA/PostgREST, real SMS, deployment ingress/shared-limit capacity, approved clinical policy, assistive-technology certification and production readiness remain separate unverified concerns.

## Integration review preparation

Source review during implementation identified two concrete cross-component checks for the final pass:

1. The launcher initially emitted `CVSRS_DEMO_MODE="true"`, while certificate and verification code checked for `"1"`. Standardize the flag or use one shared predicate; otherwise the running demo silently omits PDF marking.
2. The initial shared persona selector and existing clinic-entry links routed every staff role to `/today`. Inventory, BHW and technical-administrator roles lack that page's capabilities and receive a not-found result. Reuse capability-based landing-route selection for login, clinic chooser and global/home entry links.

These are reported integration findings, not final-state assertions. A final review must verify their resolution and record actual checks separately.

## Integrated local-sandbox review, 2026-10-01

The two integration findings above are resolved in inspected source: the launcher and document paths use `CVSRS_DEMO_MODE="1"`; the persona selector and clinic entry links use capability-aware destinations. The final inspected local authentication path requires an active, explicitly seeded synthetic persona and enabled database demo mode. Local signup no longer impersonates existing accounts. Migration tracking, persisted secrets, loopback runtime and rejection of unrelated database targets are present. No blocking defect was found in the tested JSON sign-in/local-sandbox entry path during this review.

The coordinator reported successful production build, typecheck/lint, 135 unit tests at that point and 313 database tests. ASTRA independently read `.local/final-browser-report.json`: all nine personas landed on their expected pages; the four recorded axe scans (assistant, family, sign-in light and dark) had no violations; captured browser errors were empty. The later report also records booking refresh, UI check-in ticket, a recorded administration linked to a stock transaction, completed visit and a 13,089-byte issued certificate with unauthorized nurse issuance rejected. Desktop/mobile overflow and sign-out verification were reported by the coordinator. These observations establish the bounded local scope, not every branch of every clinical workflow or production readiness.

A remaining native-form authentication redirect issue was reported: routes constructing absolute redirects from Next's reconstructed `req.url` could move a 127.0.0.1 browser session to localhost. The visible JSON sign-in path uses relative destinations; native-form contract coverage is tracked in the subsequent controls audit.

The user's subsequent request to inspect every button/function opens a broader controls audit. Inventory aging-window, error-feedback and permission-specific navigation findings from that pass do not retroactively imply that the earlier smoke test covered those cases. The existing production memory rate-limit fallback remains an explicit incoming limitation; local success does not establish a fail-closed shared production limiter, real Supabase/MFA, SMS delivery, approved clinical policy or manual accessibility certification.

## Final verification — 2026-10-01

The implementation resolves the launcher/flag integration, guarded persona selection, role-specific navigation, truthful local authentication and demo labels. It preserves the existing clinical design while correcting contrast, redundant entrance motion and reduced-motion behavior. The isolated demo boots automatically and retains data on restart; no Supabase, OAuth, SMS account or manually provisioned database is required.

Recorded checks: typecheck and lint pass; 136 unit tests, 313 database tests and four embedded demo integration tests pass; the 287-row implementation matrix check and production compilation pass. Browser checks exercised all nine personas, correct landing pages, sign-out, booking with refresh persistence, check-in, queue progression, dose recording with a stock transaction, visit completion and clinical-lead certificate issuance/download. Nurse issuance was correctly rejected. Four axe scans (assistant, family, light sign-in and dark sign-in) reported zero violations. Desktop and 390px mobile screenshots were inspected; these scans do not constitute comprehensive accessibility certification.

Print inspection caught invalid CFF subsets and missing glyph outlines that text extraction alone did not reveal. The renderer now uses a bundled static Noto Sans SC TrueType font with fontkit 2 and a streaming adapter for pdf-lib. Tests check the embedded outlines where the local PDF/font tools are available, Unicode extraction, page bounds and the existing storage size limit. The downloaded final 13,089-byte PDF was rasterized and visually checked: complete glyphs, readable layout, QR and demo marking. Issued documents were replaced through the existing certificate workflow rather than rewriting immutable stored bytes. Anonymous public verification returned HTTP 200 with demo context and without a child name.

Production Supabase authentication/MFA, real messaging delivery, deployment infrastructure, shared rate-limit degradation, clinical policy approval and full assistive-technology coverage remain outside this local verification. The wider repository contained extensive pre-existing changes; this report is scoped to the local sandbox and associated corrections.
