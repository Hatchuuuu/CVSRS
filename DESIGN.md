# eVacTrack Civic Design

## Direction

The user's eGovPH screenshot is the visual reference: clear royal-blue branding, white and pale-gray surfaces, concise navigation, and clean sans-serif typography. Preserve the current eVacTrack name and shield identity (the underlying project is CVSRS). This is an inspired design, not an eGovPH product or government-affiliation claim.

The public landing page is a service introduction with its own bounded system (see "Public Landing Page" below). Family, clinic, inventory and administration pages are operational tools: prioritize record identity, readable status, stable forms, and capability-aware navigation. Do not turn working pages into marketing layouts, and do not carry landing-page tokens, fonts or radii into them.

Light theme only (user decision 2026-10-02). The dark column below is retained as-is; do not expand it or add dark variants for new work.

### Brand mark

Source of truth: `src/components/brand.tsx`. The mark is a white shield carrying a blue check on a royal-blue (`#0648ef`) rounded tile (40-unit tile, `rx` 10). The geometry was refined to a larger shield (`MARK_SHIELD`, spanning roughly 5.75–34.25 across and 3.25–36.75 down) and a bolder check (`MARK_CHECK`, stroke width 5, round caps and joins). The same geometry is shared by the header, the footer, the favicon (`src/app/icon.svg`, scaled to a 32-unit tile, `rx` 7.5, stroke 4.2), the home-screen icon (`src/app/apple-icon.tsx`) and the social card (`src/app/opengraph-image.tsx`). Inverse version, used on navy and blue: a white tile, a blue shield and a white check. The wordmark is Atkinson Hyperlegible Next ExtraBold converted to outlines: "eVac" is navy ink (`#0b1a3a`) and "Track" is royal blue. On the inverse version "eVac" is white and "Track" is `#a9c1ff`. Do not redraw the mark separately for any surface; import the shared paths.

## Shared Tokens

Source of truth: `src/app/globals.css`. Applies to every page except the landing page, which overrides them within its own scope.

| Token | Light | Dark |
| --- | --- | --- |
| Primary | `#0648ef` | `#9dbaff` |
| Primary hover | `#003bc9` | `#c5d6ff` |
| Primary surface | `#edf2ff` | `#293855` |
| Canvas | `#f7f9fc` | `#141822` |
| Surface | `#ffffff` | `#1c2230` |
| Ink | `#242a3b` | `#f4f6fc` |
| Muted ink | `#596477` | `#bec8d9` |
| Field boundary | `#727b8d` | `#8b98ae` |

Typography: Plus Jakarta Sans, hosted locally at 400/600/700. Use fixed rem sizes, zero letter spacing, 16px body text, compact 24-32px operational page titles, and 20px section titles. The landing page uses a different face and scale (below); operational pages never adopt it.

Controls: 6px corners, minimum 44px action targets, visible focus and pending states. Individual record surfaces: 8px corners and subtle borders. Shared components live in `src/components/ui.tsx`. Page sections remain unboxed; avoid nested decorative cards. Forms do not move when hovered.

Account pages (family and staff sign-in and sign-up) share one frame, `src/components/auth-page.tsx`: a primary icon tile (UserCheck or ShieldCheck for families, Stethoscope for staff), the title and lead, the form card, and an optional note card below. The family-facing site never shows or links the staff sign-in: staff type its unlisted address (`src/lib/auth/staff-entry.ts`), and the server page passes each form its bottom link so the staff address never ships in public browser code. Staff roles are always shown by their names from `src/lib/staff-roles.ts`, never as raw role keys.

The **Admin console** (`/clinic/<clinic>/admin`) follows the operational page pattern: a page title, a row of three plain counts (applications waiting, access requests to approve, active staff), each a link to its section and compact label-and-number rows on phones, then unboxed sections: Staff applications (one bordered list; each item shows name, email, applied role and title, date and note, then Accept and Decline, which open inline forms in a pale blue or danger tint), Recently decided (a native `details` list with status chips), Access waiting for approval (the same list pattern, with the reason a viewer cannot approve), and Administration tools (a divided list of links with a pale-blue icon tile, title, one-line description and chevron). Declined is the word families and staff see; the database status is `rejected`.

Use Lucide icons for recognizable actions and navigation. Active clinic destinations use a pale-blue background and `aria-current`. The shell adapts to a main menu and clinic-menu disclosure on phones. Sticky patient identity and sidebar offsets use the measured header height.

**Legal documents** (`/terms`, `/privacy`, `/accessibility`) share one frame, `src/components/legal-page.tsx`, and are Read-mode pages on the operational tokens: a row of three document links (the current one pale blue with `aria-current`), the title, a lead, "Effective and last updated", then a 15.5rem sticky "On this page" rail beside the text from 1024px (a collapsed `details` above the text below it). The text is `.legal-prose` in `globals.css`: a 68ch measure, 17px with 1.7 line height, numbered 22px H2s whose number is Primary hover blue, primary list markers, an optional pale-blue "In brief" summary, and `.legal-table` for tables in a labelled scroll region. Sections are numbered because the documents refer to them. Every statement restates what the system does; never add certifications, encryption claims, retention periods, contact addresses or response times the system or its operators have not set. When the Terms or Privacy Policy change in substance, bump `LEGAL_VERSION` in `src/lib/legal.ts`. The operational footer carries the brand line on the left and the three document links on the right.

## Clinical and Accessibility Rules

- Keep success, warning, danger and review colors distinct from brand blue. Status always includes words and an icon; never use color alone.
- Preserve authorization, guardian verification, identity review, consent, two-person approval and immutable-record workflows.
- Keep fictional sandbox notices visible. Never invent institutional, security, clinical or legal assurances.
- Wrap long labels and dates. Wide tables scroll within labelled, keyboard-accessible regions, not the whole page.
- Printable paper forms use white paper and black ink in either theme and preserve their print dimensions.
- Routine operational pages render immediately. Respect reduced motion; reserve entrance motion for the public landing page.
- Automated contrast and browser tests are evidence, not a declaration of complete accessibility or production certification.

---

## Public Landing Page

**Boundary.** This section applies only to `/` (`src/app/page.tsx`). Every token and rule lives in `src/app/_landing/landing.css` and is scoped to `.lp` or to `body:has(.landing-page)`; the header (`src/components/public-nav.tsx`) and footer (`src/components/site-footer.tsx`) take the landing font and container width only while the landing page is mounted. Nothing below applies to signed-in pages.

### Overview

**Creative North Star: "The Public Service Counter."** The landing page works like a health center's front counter: a light pale-blue arrival (user's pick from ten options, 2026-10-08) that names the service and both account actions, then one counter with five service windows, each showing a sample of its real screen. Its material comes from the paper Immunization Card, which contributes the hairline ruling and the dose marks. The page opens on a pale-blue hero, alternates white and pale-blue reading sections, and ends on the FAQ and a white footer; the blue closing band was removed as redundant (user decision 2026-10-08).

**Key Characteristics:**
- A light pale-blue hero: navy and royal-blue headline on the left, the family in a pale-blue arch window on the right with three sample record notes; the card's ruling appears only as a faint ground texture in pale sections and service stages.
- White and pale-blue sections that alternate, each with a single-colour H2.
- One dose-mark vocabulary reused by every depicted record.
- A tabbed service counter instead of a grid of icon cards.
- Motion built from the card's three gestures (a line is ruled, a mark is stamped, an entry is written in): one arrival, one gesture per section, and a short demonstration in each service window.
- Each fact is said once (see Content below).
- Sample data is always labelled, and no claim appears without a source.

### Colors

Source: the `--lp-*` custom properties on `body:has(.landing-page)`.

**Primary**
- **Royal Blue** (`--lp-blue` `#0648ef`): the second half of the hero H1, primary buttons, a selected tab's icon, given-dose marks, the drawn lines, and links.
- **Pressed Blue** (`--lp-blue-strong` `#0436bd`): hover state for primary buttons and links.
- **Blue Ink** (`--lp-blue-ink` `#0a2f9e`): blue text on white and pale surfaces, such as the label on a white-on-blue button, a selected tab's name, and links inside content.

**On blue**
- **Mist** (`--lp-on-blue` `#e3eaff`): body text, the lede and the facts row on the blue field.
- **Soft Blue** (`--lp-on-blue-soft` `#b8ccff`): the icons in the badge and facts row. No heading uses it.

**Neutral**
- **Navy Ink** (`--lp-ink` `#0b1a3a`): headings and strong text.
- **Text** (`--lp-text` `#35415e`): running copy.
- **Muted** (`--lp-muted` `#56627f`): secondary copy, table heads and hints.
- **Footer Navy** (`--lp-navy` `#0a1733`): the depicted waiting-room screen only. The footer itself is white (see Footer).
- **Pale Blue** (`--lp-pale` `#f3f6fe`): tinted reading sections, table heads and secondary hover.
- **Pale Blue 2** (`--lp-pale-2` `#e5ecfd`): icon tiles, avatar discs, role pills and light-button hover.
- **Line** (`--lp-line` `#e1e7f3`) and **Line Strong** (`--lp-line-strong` `#c6d1e6`): hairlines, card borders, undrawn tracks and FAQ rules.
- **White** (`#ffffff`): the page canvas (`--color-canvas` is overridden to white) and every card.

**Status (dose marks only)**
- **Amber**: `--lp-amber-line` `#f2a33a` ring, `--lp-amber-bg` `#fff4e2` fill, `--lp-amber-ink` `#8a4300` text. It marks a dose that is due, and the "Fictional demo data" tag.
- **Green**: `--lp-green-ink` `#0f6b3c` on `--lp-green-bg` `#e6f6ed`. It appears only on the certificate sample's "genuine" check.

**The One Blue Heading Rule.** Every H2 is a single colour: Navy Ink. The only two-tone heading is the hero H1: "Children's Vaccination" in Navy Ink, then "Scheduling and Record System" in Royal Blue on its own lines.

**The Ruling Is Ground Rule.** The card ruling is a 1px line repeating every 40px (pale sections, `--lp-rule` `rgb(6 72 239 / 0.06)`), or every 28px (inside service stages). It appears only as a ground texture. The hero carries none (it crossed the headline and read as scan lines; user brief 2026-10-08), so no line ever crosses a photographed person.

### Typography

**Font:** Atkinson Hyperlegible Next, self-hosted as `"eVac Atkinson"` (`/fonts/atkinson-next-{400,600,700,800}.woff2`, `font-display: swap`), falling back to the system UI stack. It is used throughout the landing page, header and footer.

**Character:** a legibility-first face with open counters and distinct letterforms. Heavy (800) display weights with tight tracking give the blue band its civic weight, while body text stays open and generous.

- **Display / H1** (800, `clamp(2.125rem, 1.2rem + 2.9vw, 3.5rem)`, which is 34→56px, line-height 1.06, letter-spacing -0.03em, max 10.5em): the hero only, Navy Ink with its second half in Royal Blue. It carries the system's full name, "Children's Vaccination Scheduling and Record System", and sets as three balanced lines from 390px up.
- **Headline / H2** (800, `clamp(2rem, 1.5rem + 1.6vw, 3rem)`, which is 32→48px, line-height 1.08, letter-spacing -0.025em): one per section.
- **Title / H3** (700, 20px, line-height 1.3, letter-spacing -0.01em). In a service panel it grows to `clamp(1.375rem, …, 1.625rem)` (22→26px) with -0.015em tracking.
- **Lede** (400, 17→20px, line-height 1.6, max 32em).
- **Body** (400, 17px / 1.0625rem, line-height 1.65, max 36em). Secondary copy is 16px.
- **Label** (600–800, 13–15px): table heads, tab hints, facts and captions. The badge is 14px/700. FAQ questions are 18px/700 (17px below 640px).

All headings use `text-wrap: balance`. Uppercase tracking appears only inside the depicted waiting-room screen, as content.

### Layout

- **Container:** max 1200px (`--lp-max`) plus a fluid gutter (`--lp-gutter`, `clamp(16px, 4vw, 32px)`). The header and footer use the same container.
- **Rhythm (8px base):** section padding `--lp-section` `clamp(72px, 9vw, 128px)`. A heading block sits 40–56px above its content. Card gutters are 16–24px and inner padding is 24–40px.
- **Section order and grounds:** blue hero, then white services, then ruled pale-blue record trail, then white three steps, then pale clinics, then white access table, then pale FAQ, then the white footer behind a Line hairline.
- **Heading patterns:** a split heading (H2 left, body right-aligned at the bottom from 1024px) or a split section (intro column sticky beside its content from 1024px, 0.85fr / 1.15fr).
- **Hero:** a Pale Blue band. Below 1200px it stacks: copy (max 640px), then the arch figure centred (max 520px) standing on the band's foot. From 1200px the copy column is 580px beside the figure (40px gap) and the copy is centred vertically. The figure is up to 640px wide, growing up to 32px into the gap past its column (enlarged on request 2026-10-08); it floats 40px above the band's foot with 28px lower corners, is capped so all of it fits on the first screen (`(100svh − header − 72px) × 0.79` wide), its given note overhangs by 40px rather than 70px so it clears the headline, and is nudged up to 48px right into the page margin where there is room (user request 2026-10-08); the band's min-height is `clamp(660px, 100svh − header, 820px)`. The figure: a dashed `#b7c8f3` arch outline one padding (18–30px) out; inside it a 500:678 arch with a semicircular top, a `#dce6ff → #c9d8ff` gradient, and `family-portal.webp` at 180% of the arch's width, 30% left, bottom-aligned, `mix-blend-mode: multiply` (the white seamless backdrop becomes the arch) and its top 12% masked away so no seam shows. Three white sample notes (16px radius, 38px icon tile) float over its edges: "Pentavalent, dose 3 / Recorded by your clinic" (blue check), "Next due: MMR, dose 1 / at 9 months" (amber tile), "Guardian verified / Record shared with you" (user check). They hang past the arch on wide screens (the due note only from 1340px, where the margin has room) and tuck inside the outline, smaller, below 640px. They are `aria-hidden` illustrations describing no real child. The header is Pale Blue at 92% while the landing page is shown.
- **Breakpoints in use:** 480 (stacking, full-width buttons below), 640 (header height, the access table turns into blocks, FAQ size), 768 (panel goes to two columns, steps form a row), 1024 (tab column, split headings, sticky intro, stepped trail), 1200 (hero copy and arch side by side), 1280 (two-column panel beside the tab column, record nudge, sample zoom 1.25).
- Header min-height is 72px (64px below 640px). It is white at 95% with a 10px backdrop blur.

### Elevation & Depth

The landing page uses soft navy-tinted shadows on white cards set against pale or ruled grounds. They are ambient and never hard-offset.

- **sm** (`--lp-shadow-sm`): notes, trail cards, booking slots and message bubbles.
- **md** (`--lp-shadow-md`): the service panel and the selected tab at 1024px and above.
- **lg** (`--lp-shadow-lg`): the certificate sample and the queue screen.
- The hero's sample notes use a soft lift (`0 18px 40px -18px rgb(11 26 58 / 0.35)`).
- Primary and light buttons carry blue- or navy-tinted glows that deepen on hover.

### Shapes

- **Buttons:** 12px radius, 52px minimum height. Small buttons are 10px and 44px.
- **Tabs:** 14px in the scrolling row and 16px in the column. Icon tiles are 10px, or 12px at 1024px and above.
- **Cards:** 18px for trail cards, 20px (`--lp-radius`) for the clinic directory and access table, and 28px (`--lp-radius-lg`) for the service panel.
- **Inner samples:** 8–14px (record grid 12px, slots 12px, certificate 10px, message bubbles 14px with one 4px corner).
- **Pills:** 999px for the badge (14px below 480px), "Sample" tags, role marks and the due ring.
- Borders are 1px hairlines (`--lp-line`). Sample tags use a dashed hairline.

### Components

**Buttons.** Bold 17px label, 24px horizontal padding. The trailing arrow nudges 3px on hover, and the button scales to 0.98 when pressed. Focus shows a 3px outline (Royal Blue, or white on blue) at a 3px offset.
- **Primary:** Royal Blue fill with white text.
- **Secondary:** white with a Line Strong border. On hover the border turns blue and the fill turns pale.
- **Light** (on blue): white fill with Blue Ink text.
- **Outline-light:** a 60% white border with white text.

**The service counter (signature).** WAI-ARIA tabs with automatic activation; arrow keys, Home and End move between them.
- Below 1024px the tabs form a horizontally scrolling, snap-aligned row. Each tab shows an icon tile and a name, and the selected tab is solid blue.
- From 1024px the tabs become a 330px vertical column beside the panel, and each tab adds a hint line. The selected tab is a white raised card with a blue icon tile and Blue Ink name.
- The panel pairs a ruled pale "stage" holding the sample screen with a body holding an H3, copy, checked points and a link. The stage and body sit side by side at 768px and above, stack again beside the tab column until 1280px, and sit side by side from 1280px.

**Dose marks (signature).** One vocabulary shared by the hero's sample notes, the schedule track, the record trail and the access table:
- **Given:** a Royal Blue disc with a white check (stroke 2.2, round).
- **Due:** an amber ring (1.5–2px `#f2a33a`) on `#fff4e2` with `#8a4300` text.
- **None:** a short Line Strong dash.

The record trail's nodes use the same blue check disc, and its last node carries the brand mark.

**Hero record card (retired 2026-10-08).** `src/app/_landing/hero-record.tsx` is no longer rendered; the schedule sample keeps its "Next due" strip styles.

**Badge.** One pill above the hero H1 reading "A NORSU BSInfoTech student project": Blue Ink 14px/700 text on white with a `#d3defc` hairline and a Royal Blue graduation-cap icon. See Exceptions.

**Hero facts.** Three plain facts with Royal Blue icons, under a `#dbe3f5` hairline. They form a grid below 480px.

**Record trail.** Three white cards joined by a blue thread. From 1024px they step right in 24px increments and the thread bends into rounded blue elbow connectors.

**Steps.** Three 56px discs numbered with plain digits 1–3 (no zero padding; the face's slashed zero reads as code), the first filled blue and the others outlined, joined by a track that is vertical on phones and horizontal from 768px.

**Access table.** A ruled table with a pale head and dose marks in the cells, followed by one note (two-step sign-in). Below 640px it becomes labelled blocks per person.

**FAQ.** Native `details` between Line Strong rules. A 36px circular plus rotates 45deg and fills blue when open. The height animates through `::details-content` where the browser supports it.

**Footer.** White ground under a Line (`#e1e7f3`) hairline, with the standard brand logo. Column headings are Navy Ink, links are Text (`#35415e`, hover Royal Blue and underlined), the small print is Muted, and "Back to top" is Royal Blue. Three link columns, Families, On this page and Legal (Terms of Use, Privacy Policy, Cookies, Accessibility), two to a row on phones, three from 640px and beside the brand from 1024px. The small print starts with "© <year> eVacTrack." There is no staff column: the staff sign-in is unlisted.

### Motion

**Thesis: the card gets filled in** (user decision 2026-10-08: the page should move, not sit plain). Every movement is one of the paper card's three gestures: **rule** (a line draws: `lp-draw-x`/`-y`, or a left-to-right clip, `lp-rule`), **stamp** (a mark presses in with a slight turn: `lp-stamp`) and **write** (an entry rises or slides in: `lp-rise`, `lp-slide`). `--lp-ease` is `cubic-bezier(0.22, 1, 0.36, 1)`. State transitions take 180–260ms, entrances 360–720ms, and a section's whole sequence stays under about 1.6s.
- **The arrival (the authored moment):** the copy rises in sequence (640ms, 60ms stagger), the arch rises (800ms from 120ms) while the photograph settles from a 1.05 scale with blur and the dashed outline fades in, then the three sample notes rise one after another (560ms, 140ms apart from 600ms); the given dose's check stamps at 860ms and the due note's tile calls twice from 1100ms.
- **One gesture per section, never the same entrance everywhere.** Record trail: the dose travels; each stop stamps, its card slides in from the thread, and the thread draws on to the next stop (560ms per stop). Steps: each number stamps, its words rise, and the track is ruled on to the next number (520ms per step). Directory: health centers slide in one after another (70ms stagger, capped at six). Access table: the marks stamp cell by cell, row by row (70ms apart), dashes draw and role pills pop. FAQ: each rule is drawn across with its question (80ms apart). Section headings are written in (blur, rise) as they scroll into view, linked to the scroll where the browser supports `animation-timeline`.
- **Service windows demonstrate their screen** every time one opens (a hidden panel drops its animations, so each replays): schedule, the track is ruled at an even pen speed and each given dose stamps as the line reaches it, then the due dose arrives and calls; booking, the sessions list in and Thursday morning is pressed and picked; certificate, the paper is laid down, a scan line crosses the QR and "Genuine" stamps on; queue, the called number rolls over from 013 to 014 and the waiting line moves up; messages, two notes arrive one after the other. The chosen tab's icon tile acknowledges the press (360ms).
- **When it plays:** sections that start below the fold carry `data-reveal`; `src/app/_landing/landing-motion.tsx` rewinds their animations to the first frame and plays them once when the group's top crosses the lowest eighth of the screen. Anything already on screen plays on first paint. Without the script, everything plays on load and ends visible.
- **Reduced motion:** all of the above sits inside `prefers-reduced-motion: no-preference`, and the global reduced-motion rule removes every animation. Each element's resting state is its final, visible state (the scan line rests invisible, the previous queue ticket rests rolled out).
- **Livelier touches (user request 2026-10-08: "cool and entertaining, still appropriate").** A yellow (`#ffc94d`) hand-drawn swoosh is drawn under "Record System" (760ms from 700ms); the hero's three notes float on a slow 6s breath once landed (the only infinite loop, 7px); on fine pointers the arch, the photo inside it (opposite way) and each note lean toward the cursor by different depths (8–26px, 700ms ease); the hero call to action catches one light sheen at 1.7s and every primary button sheens on hover; the record trail's last stop rings out and bursts eight dose-mark dots (blue, amber, green, 36px) when the dose reaches the family account; an opened FAQ answer is written in. Pointer depth lives in `landing-motion.tsx` (`--px`/`--py` on `.lp-hero`).

### Content

**Say each thing once.** The page was trimmed of repetition on 2026-10-08; keep it that way.
- A section does not restate another section. The FAQ holds only questions no section answers (registering is the three steps, access is the table, booking is its service window, the paper card is the note beside the record trail).
- A service window's points add only what its paragraph leaves out.
- No in-page call-to-action block after the hero, including a closing band (removed as redundant 2026-10-08); the sticky header carries both account actions throughout.
- One component per piece of information: the schedule sample keeps the "Next due" strip.

### Honesty rules

- Every depicted screen carries a "Sample" tag (a dashed pill): the hero record in its header, and each service window as a "Sample screen" pill fixed to the stage's top-right corner (the stage's top padding always clears it). Demo clinics carry an amber "Fictional demo data" tag. The hero record's accessible name states that it is an illustration.
- No unsourced claims: no "free", no invented statistics and no stock trust badges. The hero facts state only what the system does: clinic-reviewed records, verified guardians and walk-in registration.

### Exceptions (recorded, not general rules)

1. **Depicted sample screens may sit inside a panel.** The hero record card and the service-panel samples (schedule, booking, certificate, queue, messages) are content: illustrations of real screens set on a stage. They are not nested decorative cards. This does not license card-in-card layouts elsewhere on the landing page or on operational pages.
2. **The hero badge is a user-requested exception.** The hero carries one badge line above the H1 because the user's brief explicitly asked for an eyebrow or badge. This conflicts with the craft floor's ban on kickers. No other section uses a kicker, eyebrow or overline, and new surfaces must not copy the badge pattern.

### Do's and Don'ts

**Do:**
- **Do** use Atkinson Hyperlegible Next (400/600/700/800) and the `--lp-*` tokens for anything on `/`, and nothing else.
- **Do** keep H2s a single colour. Reserve Soft Blue (`#b8ccff`) for icons on blue; the hero H1 is Navy Ink then Royal Blue.
- **Do** reuse the dose-mark vocabulary (blue check = given, amber ring = due, dash = none) for any depicted record.
- **Do** label every depicted screen "Sample" and every demo clinic "Fictional demo data".
- **Do** use the ruling as a ground texture only, masked away from photographs of people.
- **Do** keep 44px minimum targets and the 3px focus outline.

**Don't:**
- **Don't** use landing tokens, Atkinson, or the 12–28px radii on operational pages.
- **Don't** add kickers or eyebrows to sections. The hero badge is the only one and is a user-requested exception.
- **Don't** add claims such as "free", statistics, or trust badges without a source.
- **Don't** add motion outside the rule, stamp and write gestures, give every section the same entrance, add infinite loops beyond the hero notes' float, or let any motion survive `prefers-reduced-motion`.
- **Don't** repeat a fact, a call-to-action block or a component that the page already has (see Content).
- **Don't** replace the service counter with a grid of identical icon cards.
- **Don't** add dark-theme variants.
