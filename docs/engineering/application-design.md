# Non-landing application design

This is an operational addendum to the existing DESIGN.md. The landing page and its brand system remain protected.

## Direction contract

THESIS: A clinic workspace should make the record, its status and the next permitted action easy to find. Familiar controls and readable lists take priority over dashboard decoration.

OWN-WORLD: Preserve civic royal blue, white and pale-gray semantic surfaces and locally hosted Plus Jakarta Sans. Operational surfaces use 8px record corners and 6px controls, 24–28px primary headings, readable 16px introductions, subtle selection backgrounds, and existing semantic status colors with words/icons.

STORY: Guardians identify a child, understand verification/access and open the record. Staff use their capability-specific navigation to complete care, stock, review and administration tasks. Existing API commands and database checks remain the source of truth.

FIRST VIEWPORT: The existing header and persistent desktop sidebar frame a compact page heading and its primary action. Forms and substantive record sections share stable spacing. Family records appear as divided rows with identity first and an explicit next action. Stock summaries are plain counts above the working list.

FORM: Extend the established operational world; no concept-seed applies to this existing-surface extension. Shared section and card classes provide consistent treatment to the existing modules; page-specific changes target family records, inventory and failure recovery.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation rules

- `src/components/application.css` deliberately requires `body:not(:has(.landing-page))` on every style rule. Stylesheets retained by client navigation must have no effect on `/`.
- Existing root layout, globals.css, landing modules, brand/header/footer/mascot dependencies and public assets remain at their initial bytes. Compare the saved hash manifest, not HEAD, because the checkout already contained user work.
- Shared PageTitle/Section/Card keep existing APIs, semantics and server/client boundaries. No new dependencies, images, chart data or clinical content.
- Existing keyboard-operable menus, dialogs, focus indicators, minimum 44px controls and reduced-motion behavior remain in force.
- Paper tables opt out of the operational table font, padding, header and row-state styling with `data-paper-form` on the table itself. Preserve original handwriting spacing and black-on-white printing; scroll containers remain available for keyboard access to wide previews.
- Read failures explain how to reload. Write failures preserve existing unknown-outcome and idempotency guarantees.
- Audit filters validate before searching: malformed/ambiguous dates or actions and reversed ranges show linked inline errors instead of silently dropping a constraint. Clear filters resets the search; Newest entries keeps the current action/date filters. Empty older audit/message pages distinguish exhausted history from an empty dataset and keep a route to recent entries.
- Staff child records put registration actions and guardians before notes, expose role-aware section links in reading order, and keep corrections behind a native disclosure. The patient header is neutral and stays in normal flow; vaccine signing retains its explicit patient-identity check. See `staff-child-record.md` for functional evidence.

## Built hierarchy and layout

- The non-landing scope sets record surfaces to 8px and controls to 6px. Existing semantic colors and locally hosted operational type remain authoritative; these overrides do not introduce a second palette or landing typography.
- `PageTitle` uses a 28px H1 with 1.25 line height, reducing to 24px below 640px. Its lead is 16px with 1.65 line height. The title block has a bottom divider, including when the existing `dashboard` prop is used.
- `Section` uses a 20px H2. Family record list headings use 18px with 1.5 line height. Preserve these roles instead of promoting every row or panel to a page heading.
- A `Card` or `Section` inside another shared card/section becomes a flat subsection: top divider, no enclosing border, corner rounding, inline padding or shadow. Prefer an unboxed section for page structure and a card for an individual record or form.
- Main content can wrap long unbroken text, but tables explicitly restore `overflow-wrap: normal`. Keep readable words in cells and allow wide data tables to scroll within their labelled, keyboard-focusable regions; do not inherit `anywhere` wrapping into table columns to force them onto a phone screen. The stylesheet styles existing scroll regions; it does not create wrappers or add accessible names.
- Operational data tables use 14px text with 1.6 line height, 14px vertical and 16px horizontal cell padding, muted header text on a sunken surface, and row focus feedback. Pointer hover feedback applies only to a fine pointer capable of hover. Paper tables retain their own sizing and print rules.

## Shared component contracts

Source: `src/components/ui.tsx`. Reuse these APIs; this refresh adds styling hooks without replacing semantics or changing server/client boundaries.

| Component | Existing API and constraint |
| --- | --- |
| `PageTitle` | Required `title`; optional `lead`, `action`, `badge`, `dashboard` (default false). Emits the page H1; coordinate with `ChildBanner` rather than adding a second page title. |
| `Section` | Required `title`, unique `id`, `children`; optional `description`, `action`, `className`, `panel` (default false). Emits an H2 and associates the section through `aria-labelledby`; `panel` requests a bordered surface. |
| `Card` | Native section props plus `interactive`. `interactive` adds visual feedback; the caller still supplies a real link/button and keyboard behavior for any action. |
| `Button` / `LinkButton` | Button variants: `primary`, `secondary`, `danger`, `quiet`; default type is `button`. `pending` disables the button, sets busy state and replaces the optional icon with a spinner. Links require `href` and support only `primary` or `secondary`. Both retain 44px minimum height. |
| `Field` / `TextField` / `SelectField` | Required `id`, `label`; optional `hint`, `error`. Input/select wrappers connect hint/error IDs and invalid state; callers using the lower-level `Field` must wire their own control attributes. Preserve native validation and input props. |
| `StatusChip` / `Notice` | Tones are `success`, `attention`, `danger`, `review`, `info`, `neutral`, with an icon and visible wording. `StatusChip` requires a tone and content. `Notice` defaults to info, accepts optional title/content and optional `status` or `alert` role; choose announcements deliberately. |
| `ResultRegion` / `EmptyState` | Result regions announce politely and atomically; empty states require a title and accept supporting content. Keep recovery actions explicit where needed. |
| `ChildBanner` | Requires `name`, `recordNo`; optional `meta`, `chips`, `sticky`. Emits the child-name H1 and labelled identity region; sticky positioning begins at 640px and uses measured header height. |
| `BackLink` / status helpers | `BackLink` requires `href` and content. `recordStatusChip` and `relationshipChip` retain their existing clinic-verification wording and state mapping. Visual work must not change access or verification meaning. |

## Review evidence

- Impeccable detector: no findings in initial changed UI targets.
- Independent code review caught and resolved paper-form styling; the printed cell padding probe changed from 4px (failure) to the original 12px (pass).
- No new raster assets were generated for this refresh; existing asset provenance is unchanged. Review screenshots are evidence, not shipping assets.
- DESIGN.md remains the incumbent world. Its old sidecar drift was reported by context loading and was not silently regenerated.
- Independent visual review approved the supplied family/auth screens and identified report-header wrapping. Restoring normal table wrapping reduced the isolated Chromium header probe at 320px from 207px to 73px; this probe does not substitute for the actual Reports screen.
- Actual Reports geometry passes at 320/390/768/1440px, with headers below 100px. Independent review approved the final full-page staff captures and actual authorized audit screen at phone/desktop sizes: ship the reviewed surfaces, no material visual findings outstanding. Tablet automation passed; independent review did not inspect every tablet, opened-dialog or physical-print state.
- Landing source/assets remain at their 43 baseline hashes. Final client-navigation screenshots match byte-for-byte at 390/1440px after excluding only Next's development-tool overlay from capture. The application-overhaul audit owns full command results and external limitations.
