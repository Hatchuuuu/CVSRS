# Master engineering plan and issue registry

2026-09-30. Status: PLANNED. Goal: improve CVSRS against the user's complete functional, security, reliability, design, accessibility, maintainability and production gates. Architecture: retain the existing RPC/database authority; repair demonstrated defects with forward migrations and focused client/server changes. Stack: Next.js, React, TypeScript, PostgreSQL, Supabase, Tailwind, Zod, Vitest. Specification: the user's autonomous engineering brief; actual system boundaries in [system-map.md](system-map.md).

Detailed findings and evidence: [database](data-audit.md), [API/security](api-audit.md), [UI/workflows](ui-audit.md). These reports form the initial issue registry; every listed finding remains tracked even when deferred below.

## Constraints and rulings

- User steering: production deployment is the target; remove demo accounts/experience; do not set up Supabase because the user will configure it later. Supabase provisioning is excluded from this execution. Live Auth/MFA/PostgREST validation remains explicitly unverified; never describe unconfigured external services as 100% verified.
- E15 (HIGH / SECURITY UX): remove selectable development personas and the dev-login route, remove automatic fictional staff/guardian account creation from setup, and make deployment/configuration instructions production-focused. Keep synthetic fixtures isolated in disposable tests only. Do not delete existing user data as a side effect of source cleanup.
- E16 (HIGH / BUG UX): complete production auth wiring without provisioning Supabase: safe PKCE confirmation callback, self-service password-recovery request and authenticated reset form, generic enumeration-safe messages, pending/failure recovery, safe redirect allowlist and defensive MFA errors. Validate callback/error behavior with contracts; provider email templates, allowed redirects and real MFA remain later operator staging checks.
- Preserve all preexisting user changes. No blanket reset, clean, seed, or development database rebuild. Database tests may rebuild disposable `cvsrs_test`; the lead serializes test runs.
- Ruling: use the supplied dirty checkout on a dedicated audit branch, retaining a baseline diff, because a clean worktree would omit the user's current implementation. No automatic commit, push, deployment or publication.
- The user explicitly requests autonomous planning, implementation and GPT-6 SOL review. Routine approval handoffs in skills do not override that execution authorization.
- No invented medical rules, clinic policy, affiliation, compliance claim or production evidence. Same-day multiple services remain a policy question; do not prohibit them without evidence.
- Separate code inspection, test reproduction, local integration, browser verification, staging verification and external approval.
- Each code task needs root-cause evidence, acceptance criteria, meaningful validation and an independent GPT-6 SOL reviewer. New findings reopen the registry.

## Required for production: engineering tasks

| ID | Severity / classification | Objective and acceptance | Files / validation | State |
|---|---|---|---|---|
| E01 | HIGH / CODE QUALITY | Restore useful lint scope; fix theme lint error and existing application warnings, without weakening application rules | eslint config, theme and unused imports; typecheck/lint/unit/build | NEEDS REVIEW |
| E02 | HIGH / LOGIC BUG | Booking requires destination enrollment; cancelled sessions reject arrival; final walk-in slot cannot admit concurrent unapproved overflow | forward SQL migration; visits regression tests incl. forced concurrent interleaving | NEEDS REVIEW |
| E03 | HIGH / LOGIC BUG | Merge preserves usable appointments/queue and explicitly handles collisions; transfer cannot leave a new old-clinic booking | registry/visit/transfer forward migration; merge and transfer tests, lock-order review | NEEDS REVIEW |
| E04 | HIGH / LOGIC BUG | Evaluation never credits doses after as-of date; hold and backdated dose checks obey effective dates without inventing policy | schedule/administration forward migration; historical and backdated tests | NEEDS REVIEW |
| E05 | HIGH / LOGIC BUG | Repair never overwrites a concurrent stock movement | inventory forward migration; deterministic two-connection regression and ledger invariants | NEEDS REVIEW |
| E06 | HIGH / LOGIC BUG | Certificate render/store binds current token generation so concurrent stale renderer cannot issue invalid QR | certificate forward migration + service; race/retry/token verification tests | NEEDS REVIEW |
| E07 | HIGH / SECURITY BUG | Direct report export RPC audited; paper counts/differences/status cannot bypass configured suppression | reports forward migration; direct RPC/audit/suppression tests | NEEDS REVIEW |
| E08 | HIGH / SECURITY PERFORMANCE | Reject oversized/invalid SMS webhook before DB connection; byte-bounded JSON parsing; canonical production certificate URL | webhook, API body utility, config/service; unit/HTTP sequencing tests | NEEDS REVIEW |
| E09 | HIGH / UX BUG | Failed worklist/history/policy reads cannot display empty or current clinical state; link search failure cannot imply no child | all catch-to-empty page paths, review search, freshness; failure rendering tests and type/build checks | NEEDS REVIEW |
| E10 | HIGH / UI DESIGN ACCESSIBILITY | Cohesive semantic light/dark palette and shared components; honest copy; usable narrow header; resolved system theme; self-hosted consistent font | globals/shared UI/layout/theme/home/QR copy; rendering checks, lint/build; browser gate separate | NEEDS REVIEW |
| E11 | MEDIUM / LOGIC BUG | SMS completion requires current lease/attempt to reject stale worker writes | SMS SQL + dispatcher; expiry/reclaim/stale completion integration tests | NEEDS REVIEW |
| E12 | MEDIUM / BUG UX | Clear optional identity/profile fields deliberately; use clinic timezone for booking/session/report display | schemas/forms/SQL as needed, clinic read model/format; unit/DB boundary tests | NEEDS REVIEW |
| E13 | HIGH / SECURITY ARCHITECTURE | Enforce PDF content trust boundary; restricted worker/webhook credentials; shared trusted rate limit and denial telemetry | requires threat/deployment decisions, follow-up design; do not declare resolved by documentation | IMPLEMENTING |
| E14 | MEDIUM / MAINTAINABILITY | Add portable CI for clean migration + app checks; reconcile stale limitations/status and preserve evidence | scripts/db portability, workflow/docs; local full checks and clean-migration test, CI execution separate | NEEDS REVIEW |

## Required for production: validation and external prerequisites

| ID | Severity / category | Required evidence | State |
|---|---|---|---|
| G01 | CRITICAL / SECURITY | Live Supabase Auth/signup/callback/recovery/MFA/expiry/refresh/PostgREST direct-RPC authorization verification | QUALITY GATE FAILED |
| G02 | CRITICAL / LOGIC | Clinic-approved clinical schedule and product mappings, fixtures and UAT | QUALITY GATE FAILED |
| G03 | HIGH / SECURITY | Privacy owner notice, lawful basis/retention, export suppression policy and certificate/signatory approval | QUALITY GATE FAILED |
| G04 | HIGH / ACCESSIBILITY UI UX | Browser workflow checks, 320/390/tablet/desktop, light/dark, contrast, keyboard/focus, zoom/reduced motion and printed outage pages | QUALITY GATE FAILED |
| G05 | HIGH / RELIABILITY PERFORMANCE | Deployment worker/ingress/least-privilege roles, monitoring/alerts, staging load, backup/PITR/Storage restore, independent security test | QUALITY GATE FAILED |
| G06 | MEDIUM / ENHANCEMENT | Actual SMS provider contract/callback test and device camera test, if enabled | QUALITY GATE FAILED |

No browser is connected and no staging/provider/clinic approval has been supplied. Continue all independent engineering work; keep these gates failed until evidence exists.

## Recommended and future registry

Recommended: consistent query-limit validation and custom error envelopes (API-08/10); bounded/paginated search and lists after staging measurements (API-11, L7/L25); state-specific question reply feedback and cancellation confirmation; print layout validation; font support in certificate PDFs; expiry alerts/follow-up scheduling; route HTTP contracts and password recovery/callback coverage; motion restraint and touch target consistency. Same-day multiple reservations need service policy before a new restriction.

New discovery N01 (HIGH / SECURITY): paper reconciliation CSV contains staff-authored free-text notes although the UI promises reports contain no names. Notes can contain identifiers; exclude them from exported report RPC payloads and CSV, while preserving authorized staff on-screen notes. Owned by E07. N02 (HIGH / RELIABILITY): destructive local DB guards check a local marker but not the connected server's actual data directory; verify server identity before any reset/restore target replacement. Owned by E14. Dependency audit at discovery (`npm audit --json`) reported zero known vulnerabilities; this is registry evidence at that time, not a penetration-test result.

E17 (MEDIUM / BUG DESIGN): certificate renderer silently replaces unsupported name characters with question marks and does not wrap long identity/issuer strings. Embed a licensed bundled Unicode font for supported scripts, reject missing glyphs explicitly rather than alter identity, split overlong words and wrap headings/identity/issuer lines. Validate PDF generation, actual character preservation and bounded text-line widths; printed visual approval remains G04.

Future enhancements: evidence file storage, multi-dose vial sessions, closure calendars/wait estimates/realtime, community assignments/campaigns, cross-organization exchange, growth reference, offline encrypted writes. These are not silently added to the MVP. Existing limitations L1-L45 remain a secondary registry until reconciled.

## Execution batches and review focus

1. E02-E04: scheduling/identity integrity, independent from web/theme work. E01/E09/E10: interface hardening. E08: bounded request and canonical URL security. Implement in parallel with disjoint files.
2. E05-E07/E11: transactional concurrency/report/certificate fixes. E12 and E14: form/timezone and automation, assigned after preceding interfaces stabilize.
3. Independent cross-domain review; reopen all significant findings. Lead runs complete checks only after mutations settle.
4. Re-audit changed and surrounding modules, reconcile registry and quality gates, publish an accurate final report. External verification remains open; engineering improvements do not constitute a passed production gate.

Review focus: expired/unenrolled access; concurrent same-key and different-key writes; stale render/worker generations; failed reads versus true emptiness; historical dates and clinic timezone boundaries; direct RPC callers bypassing HTTP; migration-upgrade path and original grants; preserving the dirty baseline.

## Regression checklist

- Public clinics, certificate verification and ticket display disclose only intended data.
- Guardian provisional registration/link/verification/privacy gate, own-child reads and denied stranger access.
- Session creation, last-slot booking/walk-in, repeated submissions, cancel/move/closed-session arrival.
- Merge and transfer maintain history, bookings, custody and permissions.
- Schedule fixtures, as-of boundaries, evidence, holds, backdated administration and corrections.
- Stock nonnegative balance/ledger consistency, transfers/counts/disposition/cold-chain and concurrent repair.
- Certificate snapshot/token/store/retry/download/revoke and current generation only.
- Outbox dedupe and SMS consent/retry/stale-lease completion.
- Direct report reads/exports, suppression including derived values, CSV formula safety and audit.
- Failed reads, form pending/error/success, navigation/theme/mobile/focus/print where available.

## Current quality gates

| Gate | State | Evidence / gap |
|---|---|---|
| Functional / logic | QUALITY GATE FAILED | Baseline 280 DB tests pass; significant uncovered defects identified |
| UX / UI / theme / responsive | QUALITY GATE FAILED | Static audit found false states/theme gaps; browser unavailable |
| Accessibility | QUALITY GATE FAILED | Semantics exist; unsupported compliance claim and manual validation gap |
| Code quality | QUALITY GATE PASSED | Fresh app/tools types, lint and88units pass; subsequent certificate edits require final rerun |
| Architecture / security | QUALITY GATE FAILED | Good DB boundaries; transactional and deployment issues remain |
| Testing / regression | NEEDS REVIEW | Fresh88units/build/matrix pass; full DB309/310 exposed outdatedfutureassignment test and cachedassignment bug, repaired with41 focusedtests; fullrerun pending |
| Production readiness | QUALITY GATE FAILED | G01-G05 and engineering blockers open |

## Iteration ledger

### Iteration 0 — DISCOVERY → PLANNED

Current objective: map the whole app before modifying product code. Findings: three complete domain audits, 24 migrations, 29 page routes, 124 API v1 files/145 handlers; significant untested failure/concurrency paths. Plan: prioritized E01-E14 and explicit G01-G06 release gates. Implementation: audit documents and dedicated branch only. Validation: types/build/matrix pass, 35 unit and 280 DB tests pass; lint fails. Review: audits independently identify gaps despite passing tests. New issues: false empty clinical state, trust claims and lost merge bookings. Remaining work: implementation batches, independent review and all external validation gates.

### Iteration 1 — IMPLEMENTING → NEEDS REVIEW → REWORK REQUIRED

Current objective: transactional and interface hardening. Implementation: scheduling migration0025, ledger/report/SMS0026, certificate attestation0027, bounded APIs, semantic themes, failure states. Validation: first integrated check passed49units/types/lint and build; focused scheduling125,transactional87,certificate20 DB tests pass. Review: initial reviewer failed with usage limit; a replacement read-only review identified null inbox false emptiness, test override selecting cvsrs_dev, and queue locks before authorization. Rework: root reproduced null inbox and queue lock failure; fixed both, constrained test names and checked actual server cluster. Inbox/guard8units and full visits34tests pass. Independent reviewer confirms queue/test guard repairs. New issues: custom downloads/exports/public verification still used local rate limit; all have been switched to shared limit. Remaining: E12 forms/timezones, E15/E16 auth review, runtime security/CI review, E17 PDF identity integrity and complete regression. All engineering tasks await final integrated verification; external gates remain open.

### Iteration 2 — NEEDS REVIEW → REWORK REQUIRED → IMPLEMENTING

Current objective: effective auth, runtime isolation, timezone/form correctness and final regressions. Findings: optional rate declarations bypassed limits, issued PDF absence could pass restore, inactive/expired/future staff context remained visible, sandbox could simulate production SMS delivery, field borders missed contrast, cached future evaluations skipped current program assignment. Implementation: default rate limit, custom route coverage, stronger restore/CI, effective context filtering, production sandbox refusal, form clears and timezone metadata, border token correction and cached-assignment repair. Validation:88units/types/lint/build and287matrix rows pass; full DB initially309/310, evidence/schedule41 pass after corrected future-preview contract and cached-row repair; E12 focused94DB/5unit pass. Review: independent auth/runtime and adversarial reports confirm repairs with external limits. New issue: unsupported PDF glyph freezes an unretirable pending certificate; E17 now includes authorized pending retirement and actionable feedback. Remaining: E17 review, final fullDB/restore/check/build, documentation reconciliation and G01-G06. Current browser inventory was rechecked and remains empty.
