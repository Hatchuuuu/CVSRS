# UI / UX / accessibility / theme / responsive discovery (browser)

1–2 October 2026. Owner: UI QA specialist. Method: live `npm run demo` (Next 16.3.7 dev server + embedded PostgreSQL 54330, fictional personas only). No source was edited.

Two browser surfaces were used:

1. **Claude-in-Chrome (Edge) tab**, at about 1028 × 719 CSS px (DPR 1.25), with the OS in dark mode. I used it for the hands-on journeys: family booking, moving and cancelling a visit; assistant check-in and queue progression; theme toggle; keyboard Tab focus; sign-out. The extension disconnected after the demo was restarted (an API-limit interruption), so the remaining journeys ran through (2).
2. **Headless Chromium 153** (cached `playwright-core` 1.63, not a project dependency). The scripts are in `.local/audit-scratch/ui/` (`sweep.cjs`, `probe*.cjs`, `j_inv2.cjs`). It covered all 7 personas and every navigation page: 1440 × 900 and 390 × 844 (mobile + touch), light and dark (`localStorage.theme` plus `prefers-color-scheme`). Each page got **axe-core 4.x** (injected from `node_modules/axe-core/axe.min.js`; tags wcag2a/aa, 21a/aa, 22aa, best-practice), overflow, touch-target, computed-contrast, heading/landmark and console-error checks, and a full-page screenshot.

Raw data: `.local/audit-scratch/ui/sweep-<persona>.json` (300 page × viewport × theme records, all HTTP 200), `sweep-*-extra.json` (verified child pages), `probe.json`, `summary.txt`, and screenshots in `shots/`, `crops/` and `chrome/`.

## Headline numbers

- **Console errors:** 0 across 312 page loads (both themes, both widths).
- **Overflow at 1440/390:** 0 pages with `scrollWidth > innerWidth`. At **320, 360 and 375 px**, every page for a user with unread messages has `scrollWidth = 383` (UI-01).
- **axe-core violations.** Each of these rules gave the same result in light and dark:
  - `region`: 1 node on 156/156 records per theme. This is the local-demo banner outside landmarks, so it is demo-only.
  - `target-size`: 1 node on 72 staff records at 390 (36 per theme). This is the header Messages link, obscured by the sticky control group (UI-02).
  - `landmark-unique`: 1 node on the assistant `/review` page, at both widths.
  - **0** `color-contrast` violations in either theme.
- **Computed contrast**, lowest observed per role, light / dark:
  - Muted text (`ink-soft`): 6.92 / 7.81
  - Success badge: 5.21 / 8.81
  - Attention: 6.84 / 8.49
  - Danger/error: 5.91 / 7.25
  - Review: 6.48 / 7.29
  - Info: 6.16 / 6.54
  - Primary text on `primary-soft`: **4.86** / 7.98 (lowest AA margin)
  - Field borders (non-text, need 3:1): 4.55 / 5.14
  - Focus ring (`--color-info`) on surface: 6.70 / 8.53
  - Primary button text: 5.47 / 9.78
  - Card hairline border (`line`): 1.23 / 1.70. This is decorative; cards are also separated by shadow and background, so it is not a WCAG failure.
  - Disabled controls use `opacity-50`. WCAG exempts inactive controls, and none were present at page load to measure.
- **Dark theme:** the 30 September P1 "partial dark mode" is **fixed**. All 29 sampled desktop dark screenshots render dark surfaces end to end, with no light islands (contact sheets: `crops/sheet_dark_0.jpg`, `crops/sheet_dark_1.jpg`).
- **Theme toggle.** First click from OS-dark/system goes to light (`resolvedTheme` fix verified). The label updates ("Switch to dark mode"). There is no way back to "system" after a choice (P3, noted under UI-09).
- **Theme flash (dev):** none. The next-themes inline script runs in `<body>` before content, and `html.dark` was present at first read. The production CSP is a separate risk (UI-09).
- **Reduced motion:** `prefers-reduced-motion: reduce` gives 0 running animations, stagger children at opacity 1, and transitions limited to opacity/colour at 100 ms. Without it, the guardian child page runs 17 `fadeInUp` entrances plus 1 `pulse`.
- **Headings/landmarks:** every record has exactly 1 `<h1>`, 1 `main`, 1 `header`, 1 `footer` and 0 heading-level skips. The skip link works: it is the first Tab stop and becomes visible.
- **Journeys:**
  - Family books, double-books, moves and cancels a visit. Each change persisted after reload. Cancel and move success feedback is missing (UI-04).
  - Family schedule, certificate and question pages.
  - Assistant checks in a booked child: ticket 1001-002, then call, start service, finish. Persisted after reload ("2 finished").
  - Inventory receives stock: 5 vials of `DEMO-P-ALPHA-DEMO-LOT`, on-hand 0 → 5, persisted after reload. Empty submit is blocked by native `required` on quantity and reference. Form reset and success notice "Stock received." match the real change.
  - Admin and lead settings and access pages loaded in all four combinations.
  - Family messages page.

## Findings

### UI-01 — Unread-count screen-reader text causes horizontal page scroll below 383 px
- Priority: P2
- Class: Reproduced defect
- Location: src/app/layout.tsx:87, src/app/layout.tsx:108, src/app/layout.tsx:111
- Evidence: Family persona (6 unread), `/children`, `/children/:id`, `/messages` and `/help`, at viewport widths 320, 360 and 375 px. In every case `document.documentElement.scrollWidth` is 383, and the culprit is `header nav .sr-only` (" unread") with `getBoundingClientRect().right = 383`. `scrollTo({left:1000})` gives `scrollX` = 63 / 23 / 8 px. The page visibly shifts left and cuts the start of every line (`.local/audit-scratch/ui/crops/w360_family_scrolled_right.png`). Staff with no unread messages stayed at 320 (admin, bhw and inventory probes).
- Impact: Families and staff on common 360 px Android phones get a sideways-scrolling page whenever they have unread messages. This breaks WCAG 1.4.10 Reflow and makes the page feel broken.
- Root cause: `.sr-only` is `position:absolute`. Neither the nav (`overflow-x-auto`) nor the link is positioned, so the span's containing block is the sticky `<header>`, and it escapes the nav's scroll clip. Its static position (end of the third link) extends the document width.
- Solution: Add `relative` to the nav (`className="relative flex …"`) or to the Messages `<Link>`. Do the same for the `Unread count unavailable` span. Alternatively move the unread text into `aria-label` only; it is already in `aria-label`, so the inner sr-only span is redundant.
- Acceptance: With 1+ unread message, `scrollWidth === innerWidth` at 320, 360 and 375 px on all guardian and staff pages; the screen-reader name still announces the count.
- Verification: Re-run `.local/audit-scratch/ui/probe360.cjs` (expects `sw` = W). Add a Playwright/axe smoke check at 320 px if a browser test suite is introduced.

### UI-02 — Mobile header navigation hides most destinations and the sticky controls cover links
- Priority: P2
- Class: Reproduced defect
- Location: src/app/layout.tsx:87-149 (nav row, sticky control group at :124, swipe hint at :149), src/app/clinic/[clinicId]/staff-nav.tsx:17
- Evidence (390 × 844, touch; `probe.json`):
  - Header row, lead: 5 links in a 358 px scroll box with `scrollWidth` 784. Only "My Children" is fully visible; **Messages, Clinic workspace and Security are entirely hidden**.
  - Header row, family: Messages (with "6 unread") and Security hidden.
  - Clinic nav, lead: 13 items with `scrollWidth` 1963. Only "Today" and "Find or register" are visible; 10 items are fully hidden.
  - The sticky theme/sign-out group (`sticky right-0 … bg-surface`) overlaps the scrolled links. axe `target-size` flags `a[aria-label="Messages"]` as "partially obscured (smallest space is 8px by 44px)" on **72 staff records at 390** (36 per theme).
  - At 200 % text size (390 px), the visible nav strip shrinks to a single icon (`crops/text200_family.png`).
  - The "Swipe the navigation row…" hint does render on coarse pointers, but the unread badge is invisible unless the user scrolls.
  - Screenshots: `crops/top_nurse__clinic_…_today_390_light.jpg`, `crops/top_family__children_390_dark.jpg`.
- Impact: Families on phones do not see that they have unread messages. Staff cannot see most of their task list, including their way back to the clinic workspace from the guardian pages.
- Root cause: Up to 6 header links plus a 2-control sticky group share one 358 px row, and no compact navigation pattern exists.
- Solution: Below `sm`, collapse the header links into a labelled menu button (disclosure listing all links, with the unread count shown on the trigger), or move them to a bottom tab bar. Remove `sticky right-0` from the control group once links no longer scroll beneath it. For the clinic nav below `lg`, use a "Clinic menu" disclosure, or a wrapping grid with a visible "N more" affordance.
- Acceptance: At 360 and 390 px, every header destination and the unread count are reachable within one tap without horizontal swiping. No axe `target-size` violations. The clinic nav exposes all items without hidden horizontal scroll.
- Verification: Re-run `sweep.cjs` at 390 (target-size count 0) and `probe.cjs` `nav390_*` (no `hidden` entries).

### UI-03 — Keyboard focus ring is clipped in the header nav at every width and in the clinic nav below `lg`
- Priority: P2
- Class: Reproduced defect
- Location: src/app/layout.tsx:87, src/app/clinic/[clinicId]/staff-nav.tsx:17, src/app/globals.css:196-200
- Evidence:
  - Chrome: Tab from the skip link to "My Children" shows only the right edge of the 3 px blue outline; the top, left and bottom are cut off (`.local/audit-scratch/ui/chrome/03-header-nav-focus-ring-clipped.png`).
  - Measured, header nav: `outline: solid 3px, offset 2px` needs 5 px outside the link box. The header nav has `overflow-x:auto` (so `overflow-y:auto`) with gap 0 around links, giving `clippedTop/Bottom/Left = true` at 390 **and at 1440**.
  - Clinic nav at 390: same result, with only 4 px of padding against the 5 px needed.
- Impact: Keyboard users (WCAG 2.4.7) lose a clear indicator on the primary navigation used on every page.
- Root cause: The focus outline is drawn outside the element, and the scroll container clips it.
- Solution: In scrolling navs, use an inset indicator, e.g. `focus-visible:outline-offset-[-3px]` or `focus-visible:ring-inset` on nav links. Alternatively add `p-1.5` / `py-1.5` inside the scroll containers, so the 5 px fits.
- Acceptance: Tabbing through both navs shows all four sides of the focus indicator at 390, 1024 and 1440 px, in both themes.
- Verification: Re-run `probe.cjs` `focusClip_*` (all `clipped*` false) and a manual Tab screenshot.

### UI-04 — Family visit cancel/move gives no success confirmation, keeps a stale error, and drops focus
- Priority: P2
- Class: Reproduced defect
- Location: src/app/children/[childId]/visits.tsx:96-139 (AppointmentItem), :41-74 (BookVisit), src/app/children/[childId]/page.tsx:168
- Evidence (Chrome, family persona, Maya Rivera demo):
  1. "Book this time" for 7 Oct shows "Your visit is booked…". The form keeps the selection and the note (`chrome/01-…`).
  2. Clicking again shows "That could not be booked / this child already has an appointment in this session" (`chrome/02-…`). That raw lowercase DB text is shown to families.
  3. "Change time" then "Move my visit" moves the booking to 1 Oct: the badge counter goes 2 → 3, but **no success notice appears**, and the stale "could not be booked" error stays visible.
  4. "Cancel visit" then "Yes, cancel visit": the appointment disappears and the messages counter goes to 4, but **"Visit cancelled." never renders** (`document.body.innerText.includes('Visit cancelled') === false`). The stale error still claims the child "already has an appointment" (`chrome/04-…`). `document.activeElement` is `BODY`.
  5. Reload confirms the cancellation persisted.
- Impact: Families get no confirmation that a cancellation or move happened, and the page shows a false error. Keyboard and screen-reader users lose their place (focus drops to `<body>`), so they may repeat actions or call the clinic.
- Root cause:
  - The success `<Outcome>` lives inside `AppointmentItem`, which unmounts after `router.refresh()`: cancelled items are no longer listed, and a move re-renders under the new item. The move outcome has no `ok` text at all.
  - BookVisit's mutation state is never reset after a later success elsewhere.
- Solution:
  - Lift the cancel/move result into a parent-level `ResultRegion` that survives refresh, with "Visit cancelled for Thu 1 Oct" and "Visit moved to Thu 1 Oct".
  - Reset BookVisit state (and form) on any successful appointment change, and clear the form after a successful booking.
  - Move focus to the result notice or to the "Clinic visits" heading.
  - Map the conflict error to plain family copy.
- Acceptance: After cancel or move, a success notice is visible and announced (`role=status`) after the refresh. No previous error remains. `activeElement` is not `body`.
- Verification: Component test for AppointmentItem/BookVisit with a mocked refresh that removes the item, plus a manual browser replay of steps 1–5.

### UI-05 — Booked-appointment check-in shows no ticket at the point of action, and queue notices go stale
- Priority: P2
- Class: Reproduced defect
- Location: src/app/clinic/[clinicId]/today/board.tsx:90-108 (AppointmentRow, `<Outcome state={state} />` at :95 has no `ok`), :226-233 ("Now calling" notice)
- Evidence (Chrome, assistant persona, Demo Barangay):
  - "Check in and give a ticket" on Maya's row: the row turns "Arrived". **No ticket number or success notice appears near the button.** The ticket (1001-002) appears only in the Arrival queue, about 1,500 px higher and off-screen. `document.activeElement` is `BODY`. Screenshot: `chrome/05-assistant-checkin-arrived-no-ticket.jpg`.
  - Then "Call next patient" → "Start service" → outcome "No service given" → "Finish visit". The summary reads "0 waiting · 0 being seen · 2 finished", yet **"Now calling 1001-002" remains displayed above "The queue is empty"**.
  - The walk-in path does show "Ticket X issued." (board.tsx:174).
- Impact: The button promises a ticket, but the assistant has to scroll to find the number to tell the family. Keyboard users lose position, and a stale "Now calling" banner contradicts the queue state.
- Root cause: No `ok` message is passed for the appointment check-in. Mutation success state persists after unrelated queue changes.
- Solution: Pass `ok={`Ticket ${state.data.ticket} issued for ${name}.`}`, rendered in a region that survives the row's re-render (e.g. lift it to the "Expected today" section), and move focus to it. Clear `next.state` when the called entry changes status or a refresh brings a different active list.
- Acceptance: After check-in, the ticket number is visible and announced next to the "Expected today" list. "Now calling" disappears once that ticket is no longer `called`.
- Verification: Browser replay on the demo; a unit test for AppointmentRow rendering the ticket.

### UI-06 — "Finish visit" outcome defaults to "Vaccinated", for any queue role
- Priority: P2
- Class: Reproduced defect
- Location: src/app/clinic/[clinicId]/today/board.tsx:269 (`useState("vaccinated")`), :322-327; server accepts it at supabase/migrations/0013_visit_commands.sql:285-291
- Evidence: As the **assistant** (non-clinical) persona with Maya "In service", the Visit outcome `<select>` is pre-selected to "Vaccinated" (`option[value=vaccinated]` first and the state default). One click on "Finish visit" would record encounter outcome `vaccinated`. The SQL only checks that the value is in the allowed list; no vaccination event is required. I chose "No service given" to avoid writing a false outcome.
- Impact: A hurried click records a vaccinated outcome for a visit where no dose was recorded, which skews visit outcomes and reports. Non-clinical staff can do this.
- Root cause: A default value was chosen for convenience.
- Solution: Default to an empty "Choose outcome…" option with `required`. Optionally pre-select "Vaccinated" only when a dose was recorded in that encounter. The server-side consistency rule (vaccinated requires a recorded dose, or a clinical role) belongs to the visits/DB owner and is reported here, not fixed.
- Acceptance: "Finish visit" cannot submit without an explicit outcome choice, and the visible default is empty.
- Verification: Component test for the in-service row; browser check.

### UI-07 — Message timestamps are shown in UTC
- Priority: P2
- Class: Reproduced defect
- Location: src/app/messages/page.tsx:15
- Evidence: The family `/messages` list shows "Oct 1, 2026, 12:53 AM UTC" for an action taken at 08:53 Asia/Manila (`crops/family_messages_390_light_top.jpg`). The same family's question on the child page shows "Oct 1, 2026, 8:54 AM" (clinic time). The code formats with `timeZone: "UTC"` and appends " UTC".
- Impact: Families in the Philippines see times 8 hours off, inconsistent with the rest of the app. This invites confusion about when a visit was cancelled or booked.
- Root cause: The messages page was left on UTC pending the clinic-timezone task (`docs/audit/ui-implementation.md` "Gaps").
- Solution: Format with the clinic's timezone (`formatClinicDateTime` from `src/lib/format.ts`, with the clinic tz from the message's child/clinic), and drop the "UTC" suffix.
- Acceptance: Message times match the clinic local time shown elsewhere for the same event.
- Verification: Unit test of the formatter call; visual check on `/messages`.

### UI-08 — Family schedule shows "Not Yet Eligible" inside an open due window, without the date that explains it
- Priority: P2
- Class: Reproduced defect
- Location: src/components/schedule-view.tsx:88-106 (earliest-eligible and reason rows gated by `showInternals`), src/app/children/[childId]/page.tsx:132
- Evidence: Maya Rivera (demo), family view, as of 1 Oct 2026: requirement **A2** shows "Not Yet Eligible · Recommended Target: 14 Oct 2026 · Due Window: 20 Sep 2026 to 10 Oct 2026". So today falls inside the stated window, and the target is *after* the window ends. The family view omits "Earliest eligible" and the reason. Other copy shows "Due Window: 21 Oct 2026 to No end limit". All dates are a 12 px `text-xs` `<dl>`.
- Impact: Parents see contradictory guidance: "inside the due window" yet "not eligible", with a target outside the window. They may call the clinic, or turn up too early.
- Root cause: The family view hides `earliestEligibleOn` and the first reason, which are the facts that resolve the contradiction. Whether a target can fall outside the window is a scheduling-engine question for the scheduling owner; I am not inferring medical rules.
- Solution: Show "Earliest date: <earliestEligibleOn>" and a plain-language reason (the REASON_TEXT subset) in the family view. Reword the window fallback ("open-ended"). Raise the date text to at least 14 px. Ask the scheduling owner to confirm whether target > windowEnd is valid output.
- Acceptance: Any family-visible "Not Yet Eligible" item displays the earliest eligible date. No family-visible item shows a target outside its own window without explanation.
- Verification: Unit test for ScheduleView (family mode) with a `before_earliest_eligible` requirement.

### UI-09 — Theme pre-paint script carries no CSP nonce, so production will show a light flash for dark-theme users
- Priority: P2
- Class: Inspection risk
- Location: src/app/layout.tsx:55 (`<ThemeProvider …>` without `nonce`), src/proxy.ts:20 (production `script-src 'self' 'nonce-…' 'strict-dynamic'`)
- Evidence:
  - The served HTML contains the next-themes script as `<script>((e, i, s, u, m, a, l, h)…` with no `nonce` attribute (`probe.json` `themeScriptTag`).
  - In development the CSP includes `'unsafe-inline'`, so it runs and no flash occurs (verified: `html.dark` was present before hydration).
  - Next applies nonces only to its own scripts (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` §"Nonce is applied automatically"). The doc on preventing a flash before hydration says inline scripts are blocked by strict CSP without a nonce.
  - Not reproduced: requires a production build behind the proxy.
- Impact: In production every page load for dark/system-dark users would paint light first, then switch after hydration, and log a CSP violation. Users who chose a theme lose it until JS runs.
- Root cause: The nonce generated in `proxy.ts` is not passed to `ThemeProvider`.
- Solution: In the root layout, read `(await headers()).get("x-nonce")` and pass `nonce={nonce}` to `ThemeProvider`, which forwards it to next-themes. Optionally offer a "System" choice in the toggle (P3; once a user picks light or dark there is no way back to system).
- Acceptance: With `next build && next start`, no CSP violation in the console. `html` has the stored theme class on first paint (e.g. a screenshot taken before hydration via a JS-disabled load).
- Verification: Production-mode smoke check with the console and a JS-disabled screenshot.

### UI-10 — 200 % text size on phones overflows guardian cards and the Today page
- Priority: P2
- Class: Reproduced defect
- Location: src/app/children/page.tsx (child card header row), src/app/clinic/[clinicId]/today/page.tsx (Expected today / Walk-in grid), src/app/layout.tsx:83 (`text-[10px]` does not scale)
- Evidence: At 390 px with root `font-size: 200%`:
  - On `/children`, the card `h2` "Fictional Audit estimated Child", the record number and the birth-date chip end at `right=428`, past the viewport edge.
  - On the assistant/lead Today page, the "Expected today" and "Walk-in arrival" sections end at `right=416`.
  - The header nav reduces to one icon (see UI-02). Screenshots: `crops/text200_family.png`, `crops/overflow_*_390_x2_*.png`.
  - At 720 px (the equivalent of 200 % page zoom at 1440) there is no overflow.
- Impact: Low-vision users who enlarge text lose content at the right edge of cards and worklists (WCAG 1.4.4 / 1.4.10).
- Root cause: A fixed-size icon tile plus a non-wrapping chip row in a flex row. A two-column grid on Today is not collapsing at large text sizes. A fixed `px` font size in the brand tag.
- Solution: Let the card header wrap (`flex-wrap`, `min-w-0` on the text column, `break-words` on names). Use container- or `rem`-based breakpoints for the Today grid. Replace `text-[10px]` with a rem size.
- Acceptance: At 390 px with 200 % text, `scrollWidth === innerWidth` and no element's right edge exceeds the viewport on `/children`, `/children/:id`, `/messages` and Today.
- Verification: `probe.cjs` zoom section (`zoom_*_390_x2_*` expect `overflow:false`).

### UI-11 — Sticky staff sidebar and child identity banner slide under the sticky header
- Priority: P3
- Class: Reproduced defect
- Location: src/app/clinic/[clinicId]/layout.tsx:28 (`lg:sticky lg:top-6`), src/components/ui.tsx:221 (`sm:sticky sm:top-20`)
- Evidence: Measured after scrolling 900 px (`probe.json`, `probe_banner.cjs`):
  - The header is 61 px tall at 1280/1440 and **109 px at 768–1279** (it wraps).
  - The sidebar top (clinic name and role) is hidden 37 px at 1280/1440 and 85 px at 1024.
  - The staff child banner's top is hidden 29 px at 768 and 1024.
  - Screenshots: `crops/lead_1440_scrolled_sidebar.png`, `crops/child_banner_1024_scrolled.png`.
- Impact: The clinic name, and partly the child identity block, are obscured behind a translucent header while staff work. Identity must stay unambiguous on clinical pages.
- Root cause: Hard-coded sticky offsets do not track the header height, which changes when the header wraps.
- Solution: Expose the header height as a CSS variable (set from a ResizeObserver, or use a fixed header height per breakpoint) and use `top: calc(var(--header-h) + 1rem)` for both.
- Acceptance: At 768, 1024, 1280 and 1440 px, after scrolling, `aside` and `[aria-label="Child identity"]` tops are greater than or equal to the header bottom.
- Verification: `probe_banner.cjs` (all hidden values 0).

### UI-12 — Sign-out confirmation drops keyboard focus and reflows the header
- Priority: P3
- Class: Reproduced defect
- Location: src/components/sign-out-button.tsx:9-45
- Evidence: Chrome, family persona. Activating "Sign out" swaps in "Confirm"/"Cancel", and `document.activeElement` becomes `BODY`. At about 1028 px the wider confirm group pushes the nav onto a second row (header height grows). A keyboard user must Tab from the top of the page again to reach "Confirm".
- Impact: Keyboard and screen-reader friction on a frequent action, plus a visible layout jump.
- Root cause: The trigger button unmounts and focus is not managed.
- Solution: Focus "Confirm" on open, and return focus to "Sign out" on Cancel. Reserve width, or render the confirmation in a popover anchored to the button.
- Acceptance: After Enter on "Sign out", focus is on "Confirm". Header height is unchanged.
- Verification: Manual Tab test; React Testing Library focus assertion.

### UI-13 — Several small touch targets remain
- Priority: P3
- Class: Reproduced defect
- Location: src/app/messages/page.tsx:40 ("Open record"), src/app/layout.tsx footer "Back to top" link
- Evidence: Computed at 390 px:
  - "Open record" is 79 × 20 px (19 per message list).
  - "Back to top ↑" is 72 × 16 px on every page.
  - All other interactive controls are ≥ 44 px, including radios and checkboxes wrapped in `min-h-11` labels.
- Impact: Hard to tap on phones (below the 24 px WCAG 2.5.8 minimum height).
- Solution: `inline-flex min-h-11 items-center` on both links.
- Acceptance: Both links are ≥ 44 px tall.
- Verification: Re-run `sweep.cjs` small-target list.

### UI-14 — Staff "Expected today" lists cancelled bookings with raw status text
- Priority: P3
- Class: Reproduced defect
- Location: src/app/clinic/[clinicId]/today/page.tsx:89
- Evidence: The assistant's Today page lists Maya Rivera 4 times: 3 rows with chip "cancelled" (lowercase raw status) and 1 "Booked", alongside "Booked"/"Seen" chips for others.
- Impact: Clutter and ambiguity in the busiest staff view, plus inconsistent status vocabulary.
- Solution: Exclude `cancelled` appointments from "Expected today" (or group them under a collapsed "Cancelled today"), and map every status to a title-cased label.
- Acceptance: Cancelled bookings are not mixed into the expected list, and there is no raw enum text.
- Verification: Visual check on demo data.

### UI-15 — Motion system: utility-name collision, `transition-all`, entrance animation on work pages
- Priority: P3
- Class: Inspection risk
- Location: src/app/globals.css:298-315 (unlayered `.animate-in` and `.stagger-children`), src/components/ui.tsx:172 and :203, src/components/schedule-view.tsx:51,59, src/app/children/[childId]/page.tsx:93-99, src/components/sign-out-button.tsx:12-36, src/components/theme-provider.tsx:34-40
- Evidence:
  - The project's unlayered `.animate-in { animation: fadeInUp … }` overrides tw-animate-css's `@layer utilities .animate-in { animation: enter … }` (both present in CSSOM; `probe.json.animInClass`). Any shadcn component relying on tw-animate `animate-in` gets fadeInUp instead.
  - Without reduced motion, a guardian child page runs 17 `fadeInUp` entrances, staggered up to 300 ms delay + 300 ms duration. This hides content for up to 600 ms on a page families and staff revisit often.
  - `transition-all` is used on StatusChip, schedule cards, the sign-out buttons and the theme icons (review-animations escalation trigger).
  - The "called" queue card pulses forever (`pulse-border`, 2.5 s infinite). This has a purpose (you are being called), and reduced motion stops it.
  - Reduced motion handling is correct: 0 animations, content visible, colour/opacity transitions kept at 100 ms.
  - The theme-icon `scale-0` rotate swap and the `active:scale-95/0.97` press feedback are fine.
- Impact: Mostly maintainability and perceived speed; no accessibility failure.
- Solution:
  - Rename the custom class (e.g. `.enter-up`).
  - Restrict entrance stagger to first-run/marketing surfaces and remove it from the schedule, child, today and worklist pages.
  - Replace `transition-all` with explicit properties.
  - Stop the pulse after a few cycles, or when the page is hidden.
- Acceptance: No duplicate `.animate-in` definitions. No `transition-all` in `src/`. No entrance animation on clinic worklists or schedule.
- Verification: grep and the CSSOM probe.

### UI-16 — axe structural notices: content outside landmarks (demo banner) and a duplicate landmark label
- Priority: P3
- Class: Reproduced defect
- Location: src/app/layout.tsx demo banner `<div className="border-b border-attention/30 …">` (before `<header>`); src/app/clinic/[clinicId]/review/ (repeated labelled card regions)
- Evidence:
  - axe `region`: 1 node on all 312 records, `.border-attention\/30` (demo-only banner).
  - axe `landmark-unique`: `li:nth-child(4) > .rounded-card.p-5.sm\:p-6` on the assistant `/clinic/:id/review` at both widths and both themes.
- Impact: Minor screen-reader navigation noise. The banner exists only in the demo sandbox.
- Solution: Wrap the demo banner in `<aside aria-label="Demo notice">`, or put it inside `<header>`. Give each review card region a unique accessible name (include the child's name or case number).
- Acceptance: 0 `region` and 0 `landmark-unique` violations.
- Verification: `sweep.cjs` axe summary.

## Coverage

Legend: each cell was run at desktop 1440 (D) and mobile 390 (M), each in light (L) and dark (K) theme. "OK" means HTTP 200, 0 console errors, no overflow at that width, no contrast violation and only the demo `region` notice. Finding IDs mark defects. All pages also have UI-01 at ≤ 383 px when the user has unread messages, and UI-03 header focus clipping.

| Persona (clinic) | Page | D-L | D-K | M-L | M-K | Notes |
|---|---|---|---|---|---|---|
| family | /children (landing) | OK | OK | UI-02 | UI-02 | UI-10 at 200 % text |
| family | /children/:id (verified Maya, schedule/visits/certificates/questions) | OK | OK | UI-02 | UI-02 | Journey: UI-04, UI-08 |
| family | /children/:id (unverified, verified Leo) | OK | OK | UI-02 | UI-02 | |
| family | /messages | OK | OK | UI-02, UI-13 | UI-02, UI-13 | UI-07 |
| family | /help, /account/security | OK | OK | UI-02 | UI-02 | |
| nurse (Riverside) | /today (landing), /clinic/:id, /review, /inventory, /followup, /questions, /transfers, /content, /reports, /outage-forms, /clinical, /clinic, /children, /help, /messages, /account/security (16) | OK | OK | UI-02 | UI-02 | Keyboard Tab tested on Today (UI-03) |
| lead (Riverside) | nurse set + /settings, /access (18) | OK | OK | UI-02 | UI-02 | UI-11 sidebar |
| assistant (Barangay) | /today (landing), /clinic/:id, /review, /transfers, /outage-forms, /clinic/:id/children/:id, /children, /help, /messages, /account/security (11) | OK | OK | UI-02 | UI-02 | Journey: UI-05, UI-06, UI-14; /review UI-16; child banner UI-11 |
| inventory (Riverside) | /inventory (landing), /inventory/transfers, /inventory/cold-chain, /outage-forms, /clinic, /children, /help, /messages, /account/security (9) | OK | OK | UI-02 | UI-02 | Stock receipt journey OK and persisted |
| admin (Barangay) | /clinical (landing), /content, /settings, /access, /children, /help, /messages, /account/security (8) | OK | OK | UI-02 | UI-02 | |
| bhw (Barangay) | /followup (landing) + 4 filters, /children, /help, /messages, /account/security (9) | OK | OK | UI-02 | UI-02 | |
| public | /sign-in | Inspected (Chrome, light and dark) | | | | Persona tabs work. Signed-in users can still open /sign-in (by design in demo). |

Other coverage items:

| Item | Status |
|---|---|
| Overflow 1440 / 390 (all 312 records) | Inspected; no defect |
| Overflow 320 / 360 / 375 | Defect found (UI-01) |
| 200 % text at 390, page width 720 | Defect found (UI-10); 720 OK |
| Contrast, both themes (axe plus computed tokens) | Inspected; no defect (lowest 4.86 primary-on-primary-soft, light) |
| Focus visibility (keyboard Tab) | Defect found (UI-03, UI-12); skip link OK; form inputs show the 3 px info outline |
| Touch targets | Defect found (UI-02, UI-13) |
| Headings / landmarks / labels | Inspected; minor (UI-16); all form controls labelled (axe `label` 0) |
| Console errors | Inspected; 0 |
| Theme toggle and system preference | Inspected; works; no "system" option (UI-09 note) |
| Theme flash | Dev: none. Production: Inspection risk (UI-09) |
| Reduced motion | Inspected; correct |
| Loading/pending/error/success states | Inspected. Pending labels ("Booking…", "Searching…") OK. Inventory success matched the real change. Defects UI-04, UI-05 |
| Print / outage sheets | Not inspected (no print preview in this pass) |
| lead2, family2 personas | Not inspected (outside the requested 7) |
| Real-device touch / screen reader (NVDA, TalkBack) | Not inspected |

## Positive findings

- Semantic tokens and dark mode are now consistent across every audited surface. All status tones exceed 5:1 in both themes.
- Every page has a skip link, a single h1, landmarks and labelled controls. Radios and checkboxes use 44 px label targets.
- Server protection against double-booking works, and errors are surfaced, not swallowed.
- The stock receipt form validates natively, resets on success, and its success copy matches the persisted ledger change.
- Reduced-motion handling keeps content visible and removes movement.
