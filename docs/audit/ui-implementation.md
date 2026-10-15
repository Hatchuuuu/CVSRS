# UI implementation — E01, E09, E10

30 September 2026. Status: **implemented in code; independent review and browser gate pending**. This note covers the UI-owned slice of the master plan. It does not claim production readiness.

## Root causes and changes

- **E09 false empty reads:** server pages were catching failed RPC reads and substituting `[]` or `null`, which made failed worklists, care content, privacy notices, stock/product lists, and settings appear empty or current. Removed those catch fallbacks in Today, My Children, Care Information, Questions and Plans, staff child record secondary panels, clinical configuration, inventory, reports, settings, messages, and public clinic discovery. A rejected read now reaches the existing page error boundary. Today only requests the queue for roles with queue permission. Its freshness label receives a timestamp from the completed server render; the 15-second refresh timer no longer advances that label itself. The global unread badge reports an unavailable count accessibly instead of coercing a failed read to zero.
- **E09 link search:** a failed guardian-link search previously produced the same empty array as a successful zero-match search. The review card now distinguishes idle, pending, success and error; clears a previous selection when the query changes; ignores older responses; disables repeated submit while pending; and only shows the no-match guidance after a successful search. It never uses a failed search to support an identity decision.
- **E10 theme and accessibility:** a single semantic CSS palette now has light and dark values for canvas, surfaces, text, borders, primary, and every status tone. Shared card, section, title, field, button, badge, notice, empty state, and child banner styles use it. Home, family list and sign-in surfaces also use semantic colors. The theme toggle reads `resolvedTheme` so system dark mode toggles on the first click, has an accurate accessible name, and uses a 44 px target. The root uses the self-hosted Atkinson font already installed instead of also loading Geist. The header wraps and horizontally scrolls its link row on narrow screens, keeps theme/sign-out controls visible, includes a scroll cue, and uses at least 44 px targets. The child banner does not stick over the taller mobile header.
- **E10 honest copy:** removed unsupported compliance, official affiliation, universal protection, permanent record, and guaranteed outcome claims from the shell/home page. Scanner instructions now match the rendered camera option and text fallback. The error boundary avoids promising that a failed save changed nothing. Production-facing sign-in, sign-up and account-security pages no longer offer local demo personas; without configured authentication, they show an unavailable state. The existing local development route and setup mechanics are owned by a separate task.
- **Nearby feedback:** question replies show an explicit success status. Appointment cancellation uses an inline confirmation and shows a success notice.
- **E01 lint:** ESLint continues to cover application and test files while ignoring vendored `.agents`, `.claude` and `.codex` tool assets. Application rules remain enabled. Removed the theme effect lint error and five unused import/variable warnings.

## Checks

- `npm run typecheck` — passed after UI edits.
- `npm run lint` — passed, zero warnings after UI edits.
- `npx vitest run tests/unit/ui-page-failures.test.ts` — 3 passed. These test that a failed queue read, privacy notice read, or public clinic list read rejects the server page instead of producing an empty state.
- Static search found no remaining `bg-white`, `bg-slate-*`, `text-slate-*`, `border-slate-*`, or `dark:` tokens in `*page.tsx` files. Remaining specialized components and runtime visual contrast still need browser inspection.

## Gaps and new finding

- **G04 remains failed:** no browser surface is connected. The 320/390 px, zoom, keyboard, focus, reduced-motion, status contrast and print checks in the master plan have not been run. The timestamp is deliberately shown as UTC until the separate clinic-timezone task establishes a clinic-specific display source.
- **N03 (copy, resolved in code):** the previous page error boundary asserted nothing entered was lost or changed, which a failed server request cannot prove. It now directs a user to check the record before repeating a save.
- Independent GPT-6 SOL review, integrated build and cross-domain regression are owned by the lead after concurrent changes settle.
