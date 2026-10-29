# Application overhaul implementation plan

**Goal:** Upgrade the existing family and clinic application consistently, preserve the landing page and current working-tree changes, and verify actual workflows.
**Architecture:** Keep Next.js 16.3, React 19, the existing semantic palette, shared controls, Supabase commands, authorization and two-person approvals. Extend existing operational components and add a stylesheet explicitly excluded from the landing page. No new dependencies or clinical rules.
**Spec:** User attachment, 16 October 2026; PRODUCT.md and DESIGN.md supply existing brand and domain constraints.

## Protected baseline
- Initial git status and patch: tmp/overhaul-2026-10-16/baseline-status.txt and baseline.patch.
- Landing route /: src/app/page.tsx, src/app/_landing/*, root layout/global CSS, shared brand/header/footer/mascot/viewer dependencies and public assets hashed in landing-baseline.json. Preserve their starting bytes.
- Baseline npm run check: typecheck and lint pass; 666 unit tests in 99 files pass.

## Tasks
- [x] Inspect routes, shared UI, auth/API boundaries, data commands, migration/test infrastructure, design guidance and existing audits.
- [x] Capture fresh desktop/mobile landing baseline before UI edits.
- [x] Implement an isolated operational visual system: consistent section hierarchy, understated surfaces, compact readable navigation, usable inputs and table focus/scroll regions. Apply it through existing shared components across all app modules.
- [x] Improve family records into a readable record list with a clear per-child next action. Preserve clinic verification, privacy acceptance, QR and registration/link behavior.
- [x] Fix demonstrated read-error recovery wording in shared API client; retain mutation uncertainty/idempotency guarantees. Add regression coverage.
- [x] Add browser coverage spanning secondary clinic modules, account/auth/error screens, mobile/tablet/desktop, keyboard and accessibility. Keep existing full workflow suites.
- [x] Run check, disposable DB suite, matrix validation, production build and isolated full browser suite. Inspect screenshots and console errors; correct verified defects.
- [x] Independently review the incremental patch against the starting working tree; verify landing hashes and screenshot equality, then publish an evidence-based audit/report.

## Review focus
- Stylesheets remaining loaded after client navigation must never change the landing page.
- Long record names, narrow screens and browser zoom must not hide controls or data.
- Read failures must offer recovery without claiming a write occurred; write failures must still retain safe retry keys.
- Staff role boundaries and immediate signup access must remain intact.
- Tests use disposable DBs; never reset development records or print saved credentials.

## Decisions
User explicitly requests continuous implementation; no additional design-approval gate is inserted. Existing brand commitments settle palette/type; the generic design search suggested marketing/neumorphism and was rejected as inappropriate for a working clinical application. Use readable civic-blue operational UI and restrained state feedback. No optional modules, replacement stack or schema additions without observed need.
