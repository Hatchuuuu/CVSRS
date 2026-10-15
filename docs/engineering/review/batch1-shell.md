# Batch 1 shell / accessibility review (Impl D + B1/B2 rework status)

Date: 2026-10-02, about 18:16 to 18:35 +08. Reviewer role: R2-D, an independent frontend and accessibility reviewer. Model: claude-opus-5-5. I did not write any of this code and edited no source, test or config file. My scratch output is in `.local/audit-scratch/review2-shell/` (gitignored).

**Static review only.** I did not run `next build`, a dev server, the demo or a browser. Browser QA belongs to another role. The items that need a browser are listed at the end.

**The tree changed while I was reviewing it.** Three files changed after the loop's baseline manifest (`baseline-manifest-2026-10-02.txt`, 18:15). `LOOP_STATE.md` "Files Changed" does not record any of them:

| File | Changed at |
|---|---|
| `src/components/theme-provider.tsx` | 18:19:01 |
| `src/app/layout.tsx` | 18:20:00, again at 18:23:09 |
| `src/components/interactive-constellation.tsx` | 18:22:01 |

Together these force light theme only: `forcedTheme="light"`, and `ThemeChoice`/`ThemeToggle` now return `null` and were removed from the header. For one interval `layout.tsx` still referenced the removed components, and lint failed with `react/jsx-no-undef`. This review judges the tree as it stood at 18:23 or later. See RV2-D-03.

## Gates

| Check | Result |
|---|---|
| `npx tsc --noEmit` | PASS (exit 0). Run at 18:19, and again after the 18:23 layout change. |
| `npx eslint <shell files>` (`layout.tsx`, `mobile-nav`, `header-height`, `scroll-shadow`, `sign-out-button`, `theme-provider`, `ui.tsx`, `schedule-view`, `disclosure`, `toaster`, clinic `layout`/`staff-nav`, `visits.tsx`, child `page.tsx`, `proxy.ts`, `tests/unit/shell-*`, `theme-contrast`, `csp`) | PASS (exit 0) on the 18:23 tree. At 18:20 it gave 3 errors (`ThemeChoice`/`ThemeToggle` not defined) because of the in-flight edit. `globals.css` is ignored by the ESLint config. |
| `npx vitest run tests/unit` (full unit suite) | **FAIL: 387/388, 1 failed of 55 files.** `tests/unit/shell-controls.test.ts:18-23` "offers light and dark themes with native radio state (UI-09)" fails with `expected '' to contain '<legend'`, because `ThemeChoice` now returns `null`. The orchestrator's baseline at 18:15 was 388/388. The failure comes from the concurrent edit, not from Impl D. |
| Targeted run (`shell-*`, `theme-contrast`, `csp`, `civic-brand`, `sign-out`, `family-controls`, `staff-ui-review-cases`, `staff-ui-today`, `staff-ui-actions`) | 98/99. Same single failure. |
| `next build`, browser, axe | Not run (out of role). I only read the CSS that the orchestrator's 18:12 build had already emitted (`.next/static/chunks/14c550fl40xj9.css`) as evidence for RV2-D-02. |

## Verdicts: Impl D items

| ID | Verdict | Reason (file:line) |
|---|---|---|
| UI-01 | APPROVE | The unread count is now named only by the link's `aria-label` (`src/app/layout.tsx:62-79`, `:100`). The badge is `aria-hidden`, and no `sr-only` span is left to escape the nav. The "unavailable" case is also an `aria-label`. Tested in `tests/unit/shell-layout.test.ts:45-53`. Browser re-probe at 320/360/375 is still needed. |
| UI-02 | APPROVE with follow-up | Below `sm`, one labelled "Menu" disclosure carries the unread count in its name and lists every destination (`src/components/mobile-nav.tsx:89-123`; `layout.tsx:152-170`). From `sm` up the row wraps instead of scrolling (`layout.tsx:171`). There is no `sticky right-0` group. The clinic nav is a "Clinic menu" disclosure below `lg` that names the current page (`src/app/clinic/[clinicId]/staff-nav.tsx:56-99`). Follow-up RV2-D-05 (where focus lands when the menu opens). |
| UI-03 | APPROVE | Neither the header nav nor the clinic nav is a scroll container any more. Links inside the scrolling mobile panel use `.focus-inset` (`layout.tsx:60`, `globals.css:237-240`), and so do clinic nav links (`staff-nav.tsx:87`). Sign-out and other controls in the panel have 12–16 px of panel padding, more than the 5 px the ring needs. Browser Tab check pending. |
| UI-04 | APPROVE with follow-up | Cancel, move and book results live in a per-child store rendered by `BookVisit`. `BookVisit` stays mounted across `router.refresh()` (`src/app/children/[childId]/visits.tsx:40-95`; `page.tsx:166-177`, where the slot position is stable). Each new notice replaces the previous one, so a stale booking error is replaced, and focus moves to the notice (`visits.tsx:79-81`). The cancel notice names the date and the move notice names the new time (`:199`, `:218`). The double-booking conflict is mapped to family copy (`:63-73`). The form is reset after booking (`:124`). Tests are in `tests/unit/shell-visits.test.ts`. Follow-up RV2-D-06 (the notice is announced through three mechanisms at once). Residual: a failed cancel or move leaves its `Outcome` error inside the row (`visits.tsx:235-236`) after a later successful booking. Minor. |
| UI-08 (UI) | APPROVE | A family "Not Yet Eligible" item now shows "Earliest date" plus a plain reason that only restates the engine's codes (`src/components/schedule-view.tsx:53-56`, `:73-76`, `:115-120`, `:143-148`). An open window reads "(open-ended)" (`:59-63`), and the dates are `text-sm` (`:101`). Tested in `tests/unit/shell-schedule.test.ts`. Still open as a user decision in LOOP_STATE: the scheduling owner has not decided whether a target date may fall after its window. |
| UI-09 | APPROVE | The layout reads `x-nonce` (`layout.tsx:90`) and passes it to `ThemeProvider` (`:111`), which spreads it into next-themes (`theme-provider.tsx:7-12`). next-themes 0.4.6 sets `nonce` on the server render and `""` on the client, with `suppressHydrationWarning`, so there is no hydration mismatch. The proxy puts the same nonce in the request CSP and in `x-nonce` (`src/proxy.ts:28-32`), which is the documented Next 16 flow (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` §"How nonces work"). The root layout is `force-dynamic` (`layout.tsx:33`). Tested in `shell-layout.test.ts:40-43`. Production smoke test pending. Light is now forced, so the dark flash this item was about cannot happen at the moment, but the script must still run, and it does. |
| UI-10 (brand) | **REWORK** | `text-[10px]` was removed from the markup, but unlayered CSS now pins the brand to fixed pixel sizes: `.civic-brand-caption { font-size: 10px }` and `.civic-brand-name { font-size: 23px }` (`src/app/globals.css:405-407`). Unlayered rules override the `text-xs`/`text-2xl` utilities, so the caption is 10 px and does not scale with the user's text size. That is the defect UI-10 named. The test `shell-layout.test.ts:63-67` only greps the markup, so it passes while the defect stands (RV2-D-04). |
| UI-11 | APPROVE with follow-up | `HeaderHeight` publishes the measured `--header-h` through a ResizeObserver (`src/components/header-height.tsx:6-22`), with a fallback in `globals.css:123-125`. The sidebar and the staff child banner use `top: calc(var(--header-h) + 1rem)` (`src/app/clinic/[clinicId]/layout.tsx:28`, `src/components/ui.tsx:220`). The compiled CSS has the correct `calc(var(--header-h) + 1rem)`. The header is opaque and z-40, above `main` (z-10). Follow-up RV2-D-07 (short viewports). |
| UI-12 | APPROVE | The trigger stays mounted with `aria-expanded` and `aria-controls`. The confirmation is an absolutely positioned popover, so the header does not reflow; inside the mobile menu it opens in flow (`src/components/sign-out-button.tsx:10-55`). Focus goes to "Confirm" through `data-autofocus` (`src/components/disclosure.ts:60`, `:80-84`). Cancel and Escape return focus to the trigger (`sign-out-button.tsx:46`, `disclosure.ts:93-98`). The POST contract is unchanged. Escape in the nested sign-out panel stops propagation, so the mobile menu stays open. |
| UI-13 (footer) | APPROVE | "Back to top" is `inline-flex min-h-11` (`layout.tsx:231`), tested in `shell-layout.test.ts:66`. |
| UI-15 | APPROVE with follow-up | `.animate-in` is renamed to `.enter-up`/`.enter-stagger` (`globals.css:353-365`), and only the landing page uses them. Reduced motion keeps entrance content visible (`:261-264`). The pulse runs 4 cycles (`:368-370`). No `transition-all` is left in shell files (tested in `shell-motion.test.ts`). One remains in the unused shadcn scaffold `src/components/ui/button.tsx:6` (untracked, imported nowhere), so the acceptance "no `transition-all` in `src/`" does not hold literally. Delete that file or change it. |
| UI-16 (banner) | **REWORK / user decision** | The banner is not wrapped in a landmark. It is switched off with a literal: `{false ? (<aside aria-label="Demo notice">…) : null}` (`layout.tsx:114-118`). The test was inverted to require that it is absent (`shell-layout.test.ts:69-73`). axe `region` therefore passes only because the notice is gone. This contradicts `DESIGN.md` ("Keep fictional sandbox notices visible") and drops the HEAD "Local dev session shim" notice. See RV2-D-01. |

## RV1 rework status (from `review/batch1-frontend.md`)

None of the B1/B2 rework items has been addressed. The owning files have not changed since the earlier review (12:00–12:15). Modification times are given below.

| ID | Status | Evidence |
|---|---|---|
| RV1-01 (confirm steps drop focus) | **Not done** | No `autoFocus`, `.focus()`, `useConfirmStep` or `useDisclosure` in any of the seven flows. The trigger and the confirm group are still swapped on `confirming`: `src/app/children/forms.tsx:184-201` (12:02); `clinic/[clinicId]/children/[childId]/actions.tsx:127-140` (06:32); `settings/forms.tsx:65-79` (06:33); `clinical/schedules/[versionId]/schedule-actions.tsx:116-135` (06:33); `transfers/forms.tsx:33-46` (06:33); `inventory/forms.tsx:404-428` (06:34); `children/[childId]/certificates.tsx:51-64` (06:34). Only the discard-draft flow (`schedule-actions.tsx:64`) keeps its trigger mounted with `aria-expanded`. |
| RV1-02 (stock review links 404 for the role) | **Not done** | `review/cases.tsx:491` still always links to `/inventory/transfers`, and `:517` to `/inventory`, with no capability gate (file 11:54). The tests still assert the links unconditionally (`tests/unit/staff-ui-review-cases.test.ts:55`, `:62`). There is no assistant-capability case. |
| RV1-03 (signing an unreadable time) | **Not done** | `administration.tsx:121` computes `givenAt`. `:131` shows "Not a valid time" when it is null, but the "Sign and record" button at `:146` is disabled only while pending. `toIso` (`:46`) still sends `undefined`, so the server records `now()` (file 06:31). |
| RV1-04 ("clear" shown as "(left empty)") | **Not done** | `review/cases.tsx:401` is still `{k}: <strong>{textOf(v) ?? "(left empty)"}</strong>`, with raw keys such as `dobPrecision`. `edit-request.tsx:17-19` still sends `null` and `"unknown"`. |
| RV1-05 ("Now calling" after hold → requeue) | **Not done** | `today/queue-logic.ts:16` still accepts `waiting` as "still calling" (file 11:53). `board.tsx:239` has no seen-other-status or version check. `staff-ui-today.test.ts:20-23` has no hold → requeue sequence. |
| RV1-07 (kind test reads a fixed migration) | **Not done** | `tests/unit/staff-ui-review-cases.test.ts:70` still reads only `supabase/migrations/0012_visits.sql`. `record_review_cases_kind_check` appears in `0011` and `0012` only, so the test is still correct today, but the guard is brittle. |

## New defects

### RV2-D-01 — Sandbox and dev-session notice permanently disabled, and a test now requires its absence
- Priority: P2
- Class: Missing required behavior
- Location: `src/app/layout.tsx:114-118`; `tests/unit/shell-layout.test.ts:69-73`; `DESIGN.md` ("Keep fictional sandbox notices visible")
- Evidence:
  - The banner is rendered under the constant `{false ? (<aside aria-label="Demo notice">…) : null}`. `demo` is still computed (`:83`) but is used only for the "Explore demo" link.
  - HEAD rendered `<aside aria-label="Development notice">Local dev session shim…</aside>` for any `local-dev` viewer. No equivalent remains.
  - After sign-in, nothing in the shell says that records are fictional and that schedules are "never clinical use". The sandbox wording now exists only on `/sign-in`, `/sign-up`, `/verify` and `/account/security`.
  - The test was rewritten (13:35) to `expect(html).not.toContain("Local demo")` with `stub.demo = true`.
- Impact:
  - Demo users, reviewers and anyone shown screenshots lose the persistent "fictional / not for clinical use" cue on clinical pages.
  - A developer running `local-dev` against a non-demo database has no sign that authentication is simulated.
  - UI-16's axe `region` result is met by deleting content, not by fixing the landmark.
- Root cause: The banner was turned off (most likely in the eGov redesign session) instead of being given a landmark.
- Solution: Restore `{demo ? <aside aria-label="Demo notice">…</aside> : viewer?.mode === "local-dev" ? <aside aria-label="Development notice">…</aside> : null}`. An `<aside>` is a landmark, so axe `region` passes. Invert the test so that `demo=true` renders `aside[aria-label="Demo notice"]` and `demo=false` with a non-dev viewer renders nothing. If the user intentionally removed it, record that decision and update `DESIGN.md` instead.
- Acceptance: In the demo, every signed-in page shows the notice inside a labelled `aside`. axe `region` = 0. In production mode, no notice appears.
- Verification: `shell-layout.test.ts` (both branches), plus the QA axe sweep on one family page and one clinic page.

### RV2-D-02 — Global CSS imports Google Fonts, which the app's own CSP blocks (and it is a third-party request from a health app)
- Priority: P2
- Class: Reproduced defect (static: compiled CSS plus the CSP source; the browser console line is still to be confirmed)
- Location: `src/app/globals.css:1` (`@import url('https://fonts.googleapis.com/css2?family=Comfortaa…&family=Nunito…')`), `:9-12` (`.font-egov`); `src/proxy.ts:19-20` (`font-src 'self'`, `style-src 'self' 'unsafe-inline'`); `src/app/layout.tsx:139` (`font-egov` on the wordmark)
- Evidence:
  - The orchestrator's 18:12 build emitted `@import "https://fonts.googleapis.com/css2?…"` as the first line of `.next/static/chunks/14c550fl40xj9.css`.
  - The CSP that `buildCsp` sends in both dev and production allows stylesheets only from `'self'` and fonts only from `'self'`. The browser therefore refuses the cross-origin `@import` (a style-src violation) and would refuse `fonts.gstatic.com` (font-src).
  - `tests/unit/csp.test.ts:13` explicitly asserts "no third-party origins". `DESIGN.md` specifies locally hosted typography, and `public/fonts/` holds only Jakarta.
- Impact:
  - Every page logs a CSP violation.
  - The wordmark's Comfortaa/Nunito never loads, so it renders in `system-ui` and differs between devices.
  - If someone "fixes" this by widening the CSP, every family's browser would contact Google on each visit to a children's health-record app. That is a privacy regression.
- Root cause: A design-time font import outside the self-hosted font pipeline.
- Solution: Remove the `@import`. Either self-host the two weights under `public/fonts/` with `@font-face` (license permitting: both fonts are OFL), or drop `.font-egov` and use `CVSRS Jakarta` 700. Do not add Google origins to the CSP.
- Acceptance: No `@import url(http…)` in `src/**/*.css`. The compiled CSS has no third-party URL. The production console shows 0 CSP violations.
- Verification: Add a unit test asserting that `globals.css` has no `https?://` URL. QA runs a production-mode console check.

### RV2-D-03 — The unit gate is red after an unrecorded concurrent theme change (forced light, theme controls removed)
- Priority: P2
- Class: Reproduced defect
- Location:
  - `src/components/theme-provider.tsx:7-22` (18:19)
  - `src/app/layout.tsx:9`, `:111` (18:20, 18:23)
  - `tests/unit/shell-controls.test.ts:18-23`
  - `docs/engineering/LOOP_STATE.md` "Files Changed"
- Evidence:
  - `npx vitest run tests/unit` gives 387/388. The failure: `shell-controls … (UI-09)` with `AssertionError: expected '' to contain '<legend'`.
  - `git hash-object` differs from `baseline-manifest-2026-10-02.txt` for `layout.tsx`, `theme-provider.tsx` and `interactive-constellation.tsx`. None of them is listed in LOOP_STATE "Files Changed".
  - Between 18:20 and 18:23, `layout.tsx` referenced the removed components, and ESLint gave 3 errors.
- Impact:
  - The loop's "all gates green" baseline no longer holds.
  - `DESIGN.md` still documents dark tokens, and `globals.css:91-120` still defines them, but users can no longer choose dark mode. Users who chose dark before keep `localStorage.theme="dark"`; see RV2-D-08.
- Root cause: An edit made outside the loop record. It is probably the user's deliberate decision to go light-only.
- Solution:
  - The orchestrator confirms the intent with the user and records the files.
  - If light-only is intended: update `shell-controls.test.ts` to assert that no theme control is rendered and that `forcedTheme="light"` is passed; update `DESIGN.md`; optionally delete the dead `.dark` tokens and `dark:` utilities (`layout.tsx:139`, `:143`).
  - If it is not intended: restore the 18:15 versions from the manifest hashes. Do not use `git checkout`; reconstruct the content.
- Acceptance: The full unit suite passes, and LOOP_STATE lists the files.
- Verification: `npx vitest run tests/unit`.

### RV2-D-04 — Brand caption and name pinned to fixed px by unlayered CSS (UI-10 brand regression; the test is blind to it)
- Priority: P3
- Class: Reproduced defect (static: cascade analysis)
- Location: `src/app/globals.css:405-408`; `src/app/layout.tsx:139`, `:145`; `tests/unit/shell-layout.test.ts:63-67`
- Evidence:
  - `.civic-brand-caption { font-size: 10px; }` and `.civic-brand-name { font-size: 23px; … }` are not inside `@layer`. Tailwind 4 utilities live in `@layer utilities`, so the unlayered rules win over `text-xs`/`text-2xl`.
  - The caption "Vaccination Services" is 10 px and ignores the root font size. The 200 % text probe in UI-10 is exactly the case that px sizes do not follow.
  - The test checks only for the string `text-[10px]` in the markup.
- Impact: Low-vision users who raise the browser text size get an unscaled, very small caption in the header on every page.
- Solution: Use rem sizes: `.civic-brand-caption { font-size: 0.75rem }` and `.civic-brand-name { font-size: 1.4375rem }`. Better still, drop these overrides and keep the utilities. Extend the test to read `globals.css` and reject `font-size: \d+px` in `.civic-brand*` rules.
- Acceptance: No px font sizes in the shell brand rules. At 390 px with 200 % root text, the caption scales and the header does not overflow.
- Verification: The extended unit test, plus the QA `probe.cjs` zoom run.

### RV2-D-05 — Opening the mobile menu does not move focus into it (the first-focus selector matches a hidden nested button)
- Priority: P3
- Class: Inspection risk (logic trace)
- Location: `src/components/disclosure.ts:60`, `:83-84`; `src/components/mobile-nav.tsx:114-121`; `src/app/layout.tsx:153-169` (`HeaderNavLink` sets no `aria-current`)
- Evidence:
  - On open, `useDisclosure` focuses `panel.querySelector('[data-autofocus], input:checked, [aria-current="page"]')`. That returns the first match in document order.
  - In the mobile panel, no header link carries `aria-current`. The only match is sign-out's "Confirm" (`data-autofocus`), which sits inside the sign-out sub-panel that is still `hidden`. `focus()` on a `display:none` element is a no-op, so focus stays on the Menu button. Because the selector did match, the `FOCUSABLE` fallback never runs.
  - Before the 18:19 change, the match was the checked theme radio in the middle of the panel, where an arrow key would immediately change the theme.
- Impact: The component's documented contract ("focus moves into the panel on open") does not hold. Screen-reader users get only `aria-expanded`, and any future `data-autofocus` control nested in a panel will steal the initial focus.
- Solution:
  - In `useDisclosure`, ignore candidates inside a nested `[hidden]` element (`el.closest('[hidden]') === null`, or check `el.getClientRects().length > 0`), and fall back to the first visible focusable element.
  - Give `HeaderNavLink` `aria-current="page"` for the current route. This needs the path, so it means a small client wrapper, or the menu can match the path itself. The current link is then focused, as in `StaffNav`.
- Acceptance: After the menu is opened with Enter at 390 px, `document.activeElement` is the first link (or the current-page link) in the panel.
- Verification: A DOM test of `useDisclosure` with a nested hidden `data-autofocus`, plus a Tab check by QA.

### RV2-D-06 — A visit notice is announced through three mechanisms at once (focus + role + an outer live region)
- Priority: P3
- Class: Inspection risk (needs AT confirmation)
- Location: `src/app/children/[childId]/visits.tsx:79-92`; `src/components/ui.tsx:179-198` (`Notice` role, `ResultRegion` `aria-live="polite" aria-atomic="true"`)
- Evidence: Each new notice is:
  - inserted into an always-mounted `aria-live="polite"` region;
  - wrapped in `role="status"` (success) or `role="alert"` (error), which is itself an implicit live region;
  - then focused through a `tabIndex={-1}` wrapper, which makes screen readers read its content.

  NVDA and JAWS commonly speak nested live regions twice, and speak the focused content once more.
- Impact: "Visit cancelled for Thu, Oct 1, 2026" may be read two or three times. It is noisy but does no harm.
- Solution: Pick one mechanism. Because focus is moved deliberately (UI-04 acceptance), render the notice without `role` and outside `ResultRegion`, and keep the focus move with `aria-labelledby` on the title. Alternatively keep the live region and drop the focus move, but UI-04 requires `activeElement ≠ body`, so the focus approach fits.
- Acceptance: With NVDA + Chrome, a cancellation is announced once.
- Verification: A manual AT check by QA. A unit test can assert that the focused wrapper has no live ancestor.

### RV2-D-07 — Sticky staff sidebar and child banner can hide content on short viewports
- Priority: P3
- Class: Inspection risk (arithmetic; browser confirmation needed)
- Location: `src/app/clinic/[clinicId]/layout.tsx:26-33`; `src/components/ui.tsx:213-221`; `src/app/layout.tsx:132` (the header became sticky in this batch; it was not sticky at HEAD)
- Evidence:
  - **Sidebar.** For the lead persona: 13 items × 44 px + 12 × 4 px gaps ≈ 620 px, plus about 60 px of clinic name and role, gives a sidebar of about 680 px. It sticks at `--header-h + 16 ≈ 89 px`. A 1366×768 laptop has about 650 px of browser viewport, so the bottom items (Clinical setup, Staff access) sit below the fold. A sticky box taller than the viewport cannot be scrolled independently, so those items show only when the page reaches its end. The new offset (89 px instead of 24 px) makes this worse.
  - **Child banner.** It is sticky from `sm` up. On a landscape phone (for example 740×360) the sticky header (65–121 px) plus the banner (about 170 px) covers most of the viewport (WCAG 1.4.10 concern).
- Impact: Staff on small laptops lose access to the bottom nav items while working. Landscape phone users see little content.
- Solution:
  - Sidebar: `lg:max-h-[calc(100dvh-var(--header-h)-2rem)] lg:overflow-y-auto`. The links are already `focus-inset`.
  - Banner: apply `sticky` only from `lg` and on tall viewports, for example `[@media(min-height:700px)]:lg:sticky`, or keep it unstuck below `lg`.
- Acceptance: At 1366×657 every sidebar item can be reached without scrolling the page to its end. At 740×360 the sticky regions cover less than 50 % of the viewport.
- Verification: QA `probe_banner.cjs` extended to 1366×657 and 740×360.

### RV2-D-08 — Toasts follow the stored theme, not the forced light theme
- Priority: P3
- Class: Inspection risk (code trace)
- Location: `src/components/toaster.tsx:6-8`; `node_modules/next-themes/dist/index.mjs` (`useTheme().theme` is the stored value; `forcedTheme` is a separate field)
- Evidence: `AppToaster` passes `theme={theme}`. When a theme is forced, next-themes still returns the user's stored `theme`, so a user who chose dark before 18:19 has `"dark"`. Sonner injects unlayered styles keyed on `data-sonner-theme`, which override the `bg-surface text-ink` utilities.
- Impact: Dark toasts appear on an otherwise light-only page for returning dark-mode users. This is a visual inconsistency only.
- Solution: Use `const { forcedTheme, resolvedTheme } = useTheme(); theme={(forcedTheme ?? resolvedTheme ?? "light") as …}`.
- Acceptance: With `localStorage.theme="dark"`, a toast renders with the light palette.
- Verification: QA browser check (toast after "New QR pass ready.").

### RV2-D-09 — The wordmark reproduces eGov's tri-colour ring (flag colours) and calls itself "eGOV.ph visual brand"
- Priority: P3
- Class: Inspection risk (needs a user decision; not a code defect)
- Location: `src/app/globals.css:8-39` (comment "eGOV.ph visual brand typography & tri-color ring"; `conic-gradient(#fcd116 …, #004ce6 …, #ce1126 …)`); `src/app/layout.tsx:139-143`
- Evidence:
  - The "o" in "eVacTrack" is replaced by a ring in Philippine flag yellow, blue and red, styled after the eGovPH mark.
  - `DESIGN.md` and the eGov verification note both say: "an inspired design, not an eGovPH product or government-affiliation claim".
  - The verification note asks to "preserve the user's eVacTrack wordmark", so this is likely the user's own choice.
- Impact: Families could read the service as a government (eGovPH) product. That is a trust and legal risk for a health-records app.
- Solution: The user decides. Keep it with explicit sign-off, or use a neutral ring or the plain shield. Either way, rename the CSS comment and classes so they do not claim eGov branding.
- Acceptance: A recorded user decision.
- Verification: N/A.

## Notes (not findings)

- **MFA banner colours.** The banner uses raw Tailwind amber colours instead of the attention tokens (`layout.tsx:124`). Contrast is fine in both palettes (and only light is live now). Moving it to `bg-attention-bg text-attention` would follow `DESIGN.md`.
- **Date format.** `visits.tsx:26` formats days with `toLocaleDateString("en-PH")` ("Thu, Oct 1, 2026"), while schedule and record dates use "1 Oct 2026". Parsing and formatting both happen in the runtime zone, so the weekday cannot shift between server and client. Node and browser ICU should agree for en-PH, but QA should watch the console for hydration warnings on `/children/:id`. Using `formatDate`/`formatClinicDate` would remove both the inconsistency and the risk.
- **Unlabelled schedule wrapper.** `schedule-view.tsx:67` puts `aria-label` on a role-less `div`, so the label is ignored. This is the same pattern as the `/children` list note in the earlier review.
- **Focus ring radius.** `:focus-visible { border-radius: 6px }` (`globals.css:230-234`) reshapes round or pill controls while they are focused. Cosmetic.
- **CSP and nonce.** The CSP and nonce wiring is otherwise correct. Prefetch requests skip the proxy (matcher `missing` rules), but RSC payloads never execute inline scripts, and the root layout does not re-render on client navigation.

## Rework list

1. **RV2-D-01 (UI-16).** In `src/app/layout.tsx:114-118`, replace `false` with `demo`, and add the `local-dev` "Development notice" aside. Invert `tests/unit/shell-layout.test.ts:69-73`. If the user wants no notice, get that decision recorded instead.
2. **RV2-D-02.** Delete `src/app/globals.css:1`. Self-host the brand fonts (`public/fonts/` plus `@font-face`) or use Jakarta. Add a test that `globals.css` contains no `https?://`.
3. **RV2-D-03.** The orchestrator confirms the light-only change with the user. Then either update `tests/unit/shell-controls.test.ts:18-23` and `DESIGN.md`, or restore the theme controls. Record the three files in LOOP_STATE.
4. **RV2-D-04 (UI-10 brand).** Change `src/app/globals.css:405-407` px font sizes to rem, or remove them. Extend `shell-layout.test.ts:63-67` to check the CSS.
5. **RV1-01.** Add focus management to the seven confirm flows listed in the table, for example a shared `useConfirmStep` built on `disclosure.ts`. Still B1's only blocking item.
6. **Follow-ups (non-blocking):**
   - RV2-D-05: `src/components/disclosure.ts` (hidden-ancestor filter); `aria-current` in header links.
   - RV2-D-06: `src/app/children/[childId]/visits.tsx:84-94`.
   - RV2-D-07: `src/app/clinic/[clinicId]/layout.tsx:28`, `src/components/ui.tsx:220`.
   - RV2-D-08: `src/components/toaster.tsx`.
   - UI-15: delete or change `src/components/ui/button.tsx`.
   - RV1-02 (`review/cases.tsx:491`, `:517`, plus the test), RV1-03 (`administration.tsx:146`, disable when `givenAt` is null), RV1-04 (`review/cases.tsx:401`), RV1-05 (`today/queue-logic.ts:16`, `board.tsx:239`), RV1-07 (`staff-ui-review-cases.test.ts:70`).
7. **User decision:** RV2-D-09 (eGov ring); UI-08 target-after-window (scheduling owner).

## Needs browser confirmation (QA)

1. **UI-01.** Family with unread messages at 320, 360 and 375 px: `scrollWidth === innerWidth` on `/children`, `/children/:id`, `/messages`, `/help`.
2. **UI-02.**
   - At 360/390: every destination and the unread count are reachable from "Menu".
   - axe `target-size` = 0.
   - At 640–1023 the wrapped header row hides nothing.
   - The clinic menu lists all items below `lg`.
3. **UI-03.** Tab through the header and clinic nav at 390, 1024 and 1440: all four sides of the ring are visible, inside the open mobile menu as well.
4. **UI-04.** Replay the book → conflict → move → cancel journey:
   - The notice survives the refresh.
   - No stale error remains.
   - `activeElement` is not `body`.
   - Count the NVDA announcements (RV2-D-06).
5. **UI-09 / RV2-D-02.** Run `next build && next start` behind the proxy:
   - The theme script has a `nonce`.
   - The console shows 0 CSP violations. Today the Google Fonts `@import` violation is expected.
   - `html` has the class on first paint.
6. **UI-10 / RV2-D-04.** At 390 px with 200 % root text: the header brand caption scales and the page does not overflow.
7. **UI-11 / RV2-D-07.** Run `probe_banner.cjs` at 768, 1024, 1280 and 1440 (hidden = 0), plus 1366×657 (sidebar reachability) and 740×360 landscape (banner coverage).
8. **UI-12.** Desktop: Enter on "Sign out" focuses "Confirm"; Escape and Cancel return focus; header height is unchanged. Repeat inside the mobile menu.
9. **RV2-D-05.** Open the mobile menu with the keyboard and check where focus lands.
10. **RV2-D-01.** Signed-in demo pages show the notice in a labelled `aside`, with axe `region` = 0.
11. **Hydration.** Console on `/children/:id` and on clinic pages: no hydration warnings.
12. **RV2-D-08.** With `localStorage.theme="dark"`, check the toast palette.
