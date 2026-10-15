# CVSRS interface and workflow audit

30 September 2026. Scope: the current working tree's 29 page routes, their client forms and boards, shared components, global CSS, theme provider, and guardian/clinic navigation. This is a **code inspection**. Browser validation was unavailable in this session (no browser surface); responsive behavior, actual contrast, keyboard order, focus after refresh, print pagination, and WCAG conformance still require a browser pass. No clinical schedule or medical rule was inferred.

## Verdict and priorities

The app has a product-specific workflow, clear clinical decision boundaries, role gated navigation, explicit empty states, and a good shared form/status vocabulary. Its biggest interface risk is **a failed read being presented as an empty or current clinical worklist**. The other release-level issues are the partial dark theme, a guardian-link search that turns errors into “no match,” misleading trust claims, and mobile navigation density. The bundled Impeccable detector reported five patterns: four `gray-on-color` hits on `layout.tsx` are class-string co-occurrence false positives (hover/background and light/dark classes do not necessarily coexist); the gradient text on `page.tsx:66` is a subjective style warning, not an accessibility failure.

| Dimension | Code-inspection score /4 | Basis |
|---|---:|---|
| Accessibility | 2 | Labels, skip link, live notices and table semantics exist; small shell targets and interaction concerns remain. |
| Performance | 3 | Small image footprint and bounded lists; 15-second full route refresh and five-second display polling need runtime measurement. |
| Responsive | 2 | Main grids and data tables adapt; global header is dense and unverified at 320–390 px/200% zoom. |
| Theming | 1 | Dark shell tokens exist, but shared surfaces use light-only colors. |
| Implementation integrity | 2 | Real domain structure; false empty states, inaccurate copy, mixed token systems and unsupported trust claims undermine it. |
| **Total** | **10/20** | **Acceptable by code inspection, with significant release work.** |

Severity: P1 = major release risk; P2 = meaningful usability gap; P3 = polish. This report has **0 P0, 4 P1, 5 P2, and 1 P3** findings. No P0 is claimed without live reproduction.

## Route and workflow inventory

| Audience | Routes | Main path / states |
|---|---|---|
| Public and auth | `/`, `/sign-in`, `/sign-up`, `/verify/[token]`, `/display/[clinicId]` | Clinic discovery; local demo persona or Supabase sign-in/up; certificate check; public ticket-only waiting board. |
| Guardian shell | `/children`, `/children/[childId]`, `/messages`, `/help`, `/account/security` | Privacy notice acknowledgement → add child or request existing link → clinic verification → schedule/history, visits, QR, questions, transfer, edit request, outside dose, certificates; messaging/SMS preferences; clinic-authored care information; MFA. |
| Staff entry and daily care | `/clinic`, `/clinic/[clinicId]`, `/clinic/[clinicId]/today`, `/clinic/[clinicId]/children/[childId]` | Clinic choice → search/QR/register → identity/guardian confirmation → appointment/walk-in queue → service, dose recording or exception → evidence, holds, catch-up, certificates and corrections. |
| Staff review and outreach | `/clinic/[clinicId]/review`, `/questions`, `/followup`, `/transfers` | Guardian links, duplicates, edits, stock/correction/exception cases; family questions and care plans; due/behind follow-up; record transfer release/accept/decline. |
| Stock and reporting | `/clinic/[clinicId]/inventory`, `/inventory/transfers`, `/inventory/cold-chain`, `/reports`, `/outage-forms` | Lots/locations/ledger/counts, inter-clinic stock, temperature limits/readings, named report catalogue/CSV/paper reconciliation, printable outage sheets. |
| Governance | `/clinic/[clinicId]/clinical`, `/clinical/schedules/[versionId]`, `/content`, `/settings`, `/access`, `/audit` | Antigen/product/schedule proposal and approval; privacy notice; authored care content review; clinic profile and operational checks; staff grants; audit search. |

The clinic side navigation is generated from capabilities in `src/app/clinic/[clinicId]/layout.tsx:9-26`; individual pages and database calls also check access. The global shell is in `src/app/layout.tsx`, and reusable status/form primitives are in `src/components/ui.tsx`.

## Findings

### P1 — Failed reads can appear as empty, up-to-date worklists

**Category:** Functional state / feedback. `src/app/clinic/[clinicId]/today/page.tsx:46-48` maps failures in sessions, appointments and queue to `[]`, while `today/board.tsx:36-51` immediately displays “Last updated” after `router.refresh()` without knowing whether those reads succeeded. A staff member can see an empty queue or no appointments when the data request failed; the freshness label then implies success. Similar fallback-to-empty behavior appears in `src/app/help/page.tsx:21-26`, `src/app/children/page.tsx:36`, `src/app/clinic/[clinicId]/questions/page.tsx:45-47`, and child-record secondary panels at `src/app/clinic/[clinicId]/children/[childId]/page.tsx:67-82`. Preserve the distinction among empty, unavailable, and last-known data; report failed sources and only update freshness after a confirmed response. The child privacy-notice fallback is especially consequential: an unavailable notice is hidden while add/link forms remain visible and can only fail later.

### P1 — Guardian-link search errors are presented as “no matching child”

**Category:** Functional state / safety of review. In `src/app/clinic/[clinicId]/review/cases.tsx:105-107`, an unsuccessful search sets `hits` to `[]`; at `:124-126` that state says “No matching child at this clinic. Reject if you cannot verify the request.” This can steer a reviewer toward rejecting a valid link because of a network or server failure. Keep an explicit search-error state and retain prior results only with a stale indicator; never turn failure into a negative identity finding.

### P1 — Dark mode is incomplete across core pages

**Category:** Theming / visual consistency. The shell switches with `next-themes` (`src/app/layout.tsx:50-52`), but the shared `Card`, `PageTitle`, `Section`, fields, empty state, child banner, and status chips use fixed `bg-white`, `text-slate-*` and other light palette classes in `src/components/ui.tsx:10-205`. The second token set in `src/app/globals.css:183-239` changes shadcn variables under `.dark`, whereas the app's `--color-surface`, `--color-ink` and related tokens at `:13-46` stay light. Result: the shell becomes dark while much of the clinical workspace remains light, and mixed semantic/custom and slate classes can produce inconsistent contrast. Consolidate one semantic token map for both themes, migrate shared primitives first, then verify every status tone and representative routes in both modes.

### P1 — Unsupported compliance and authority claims

**Category:** Content integrity / trust. The footer states “Encrypted patient privacy • WCAG 2.1 AA Compliant • Official Community Health Infrastructure” (`src/app/layout.tsx:159`), and the homepage says “Official Community Vaccination Platform” (`src/app/page.tsx:62`). The code review cannot establish those certifications or affiliations; the WCAG assertion is particularly premature given untested browser behavior and gaps below. Replace claims with verified, approved product copy or remove them pending evidence. A technical security implementation alone does not prove an organizational endorsement.

### P2 — Mobile shell has crowded navigation and small controls

**Category:** Responsive / accessibility. The global header renders brand plus up to five signed-in links, theme switch and sign-out in a wrapping `justify-between` row (`src/app/layout.tsx:65-138`), without a narrow-screen navigation mode. Main links are `min-h-10` (40 px) at `:39`, sign-out has no minimum height at `:120`, and the theme toggle is 36 × 36 px (`src/components/theme-provider.tsx:29`). The horizontal clinic nav at `src/app/clinic/[clinicId]/staff-nav.tsx:17` is a good containment strategy, but its scrollability is visually subtle and can hide later tasks. Validate 320/390 px, 200% text zoom, landscape, touch, and keyboard. Give controls at least 44 px targets and an explicit compact navigation affordance. **Code risk, not a measured overflow failure.**

### P2 — Theme toggle mishandles the system preference

**Category:** Theming / interaction. `src/components/theme-provider.tsx:13,28,30-39` compares `theme` to `"dark"`. With `defaultTheme="system"` (`src/app/layout.tsx:51`), the first click while the OS is dark selects dark again; icon/title also describe the wrong resolved state. Use `resolvedTheme` for display and toggle behavior, and give the button a state-aware accessible name. Live verification is needed for hydration and OS-theme changes.

### P2 — Scanner instructions contradict the rendered control

**Category:** Workflow copy. The staff entry page says “Scan is not available yet; type or paste the code” (`src/app/clinic/[clinicId]/page.tsx:29`), but `workspace.tsx:91` renders `QrScanner`, whose camera button and `BarcodeDetector` support/fallback are implemented in `qr-scanner.tsx:22-91`. Replace the static sentence with “Scan with camera if your browser supports it, or enter the pass code,” keeping the existing unsupported/permission fallback.

### P2 — Review search and reply have weak completion feedback

**Category:** Feedback. The guardian-link search has no pending/disabled state (`src/app/clinic/[clinicId]/review/cases.tsx:101-123`), so repeated searches can race and overwrite one another. The question reply form only renders errors (`src/app/clinic/[clinicId]/questions/forms.tsx:9-33`); success relies on the item disappearing after `router.refresh()`. Show a local “reply sent” state before removal or an explicit return focus target, and use pending/search result status in review. This is especially relevant when list refresh is delayed.

### P2 — Printed outage tables need a layout check

**Category:** Responsive / print. The outage sheet contains ten columns on a `w-full` table and two additional dense tables (`src/app/clinic/[clinicId]/outage-forms/page.tsx:13-108`); print CSS only hides shell elements (`src/app/globals.css:167-177`). Paper width, row heights and page breaks are not specified. Render an A4/PDF print preview to confirm every column and writing space fits, then add print-specific page size/orientation and widths if needed. This is a validation risk, not a proven clipping bug.

### P3 — Motion and typography lack one clear system

**Category:** Motion / design integrity. `src/app/globals.css:158-165` reduces *all* animation and transition durations to 0.01 ms; the shared card adds hover elevation (`src/components/ui.tsx:10`) even when noninteractive, and the header unread count pulses indefinitely (`src/app/layout.tsx:92`). Preserve non-motion status feedback, stop decorative pulse for reduced motion and consider whether it is needed at all. The CSS imports Atkinson Hyperlegible and sets it as `--font-sans` (`globals.css:2-5,47`), while `layout.tsx:11,48` loads Geist into the same variable: document and select one body font. Homepage gradient heading (`page.tsx:66`) was the detector's one verified stylistic hit; judge it against the final visual direction rather than treating it as a defect by itself.

## What to preserve

- `src/components/ui.tsx:93-134,172-176` has labeled controls with `aria-invalid`/descriptions and a shared live region; forms generally show pending text and specific result notices.
- `src/app/children/[childId]/page.tsx:114-125` and `src/app/clinic/[clinicId]/children/[childId]/page.tsx:108-129` mark schedules as guidance, and block invented calculated dates when no approved schedule is active.
- `src/app/clinic/[clinicId]/reports/page.tsx:146-169` and `audit/page.tsx:68-78` give wide tables captions/headers and keyboard-focusable scroll regions.
- `src/app/display/[clinicId]/board.tsx:27-58` uses ticket numbers only and explicitly warns when polling fails.
- Queue and mutation flows use status text, semantic badges, idempotency keys and many actionable error messages (`src/lib/client/api.ts:62-97`).

## Validation still needed

Run one bounded browser pass in light and dark at desktop, 390 px and 320 px, 200% zoom, keyboard only, and reduced motion. Trace a guardian add/link → record → appointment/QR flow and staff search → queue → record → review flow using safe demo data; deliberately fail a read and a mutation to confirm error versus empty behavior. Inspect focus after mutations and `router.refresh()`, run axe on representative routes, measure text/status contrast, and preview the three outage sheets on paper. This document makes no claim that those checks passed.

Recommended implementation order: use `$impeccable harden` for failed-read and guardian-link states, `$impeccable colorize` for semantic light/dark tokens, `$impeccable clarify` for authority and scanner copy, `$impeccable adapt` for compact navigation and print layout, then `$impeccable polish` after browser verification. Re-run `$impeccable audit` after fixes. These are recommendations; this audit did not change product code.
