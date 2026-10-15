# eGov-Inspired CVSRS System Plan

**Goal:** Apply the approved eGovPH-inspired interface throughout CVSRS and verify the application's local functionality.

**Design reference:** The user's eGovPH screenshot and the approved CVSRS landing page. Royal blue actions, white and pale-gray surfaces, Plus Jakarta Sans, compact navigation, 6px controls, 8px records, and restrained semantic status colors. Operational screens remain task-focused and preserve role permissions and clinical wording.

**Architecture:** Promote the landing page's brand tokens to the shared theme. Refine the shared header, clinic sidebar, forms, notices, schedules, and record components. Fix route-specific issues found by authenticated browser checks without changing unrelated work.

**Tech stack:** Next.js 16.3.7 App Router, React 19, Tailwind 4, Lucide, PostgreSQL, Vitest, Playwright, axe-core.

## Implementation and Verification Loop

- [x] Establish the current typecheck, lint, unit, database, and sandbox-test baseline.
- [x] Promote the approved typography and palette to every route, including dark mode.
- [x] Refine shared controls, navigation, page titles, child records, schedules, and authenticated page structure.
- [x] Audit public, family, clinic, and administration screens on desktop and mobile using fictional sandbox accounts.
- [x] Exercise registration, verification, booking, queue transitions, vaccination recording, inventory, reports, messages, downloads, and sign-out where the local sandbox supports them.
- [x] Fix reproduced failures, add meaningful regression coverage, and rerun the affected checks.
- [ ] Complete full automated checks and a production build; document route coverage and remaining external validation.

## Acceptance Criteria

- Every route inherits the same royal-blue brand and typography; no remaining teal identity or decorative gradients.
- Normal, hover, focus, disabled, pending, empty, validation, and error states remain legible and usable.
- Role-specific navigation and data access remain enforced by existing application and database boundaries.
- Browser checks find no unintended page overflow, overlapping controls, uncaught errors, or serious automated accessibility violations on audited screens.
- Local workflow results and automated tests are recorded with their actual counts and outcomes.
- No claim of live authentication, provider delivery, clinical acceptance, or deployment readiness without corresponding evidence.

## Worktree Constraints

The working tree contains existing user changes. Preserve them. Do not reset databases containing user records, alter external services, or commit unrelated changes. Browser mutations use the isolated fictional demo database.
