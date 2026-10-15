# Frontend functionality, architecture and performance discovery

Date: 2026-10-01. Reviewer model: claude-opus-5-5. Scope: static audit of every page, layout, error/not-found file and client component under `src/app` and `src/components`, plus `src/lib/client/api.ts` and `src/lib/format.ts`. Each interactive control was traced from user action → client state → request (method, URL, body, Idempotency-Key) → route handler/Zod schema → RPC → response handling → next visible state. No browser was used (browser QA is another agent's job). Source files were not edited.

Checks run on the current dirty tree: `npm run typecheck` PASS, `npm run lint` PASS, `npm run test:unit` 174/174 PASS. One scratch real-PostgreSQL repro (`.local/audit-scratch/frontend/stock-case.test.ts`, run against the disposable `cvsrs_audit_frontend` database with `CVSRS_TEST_DB_NAME=cvsrs_audit_frontend npx vitest run --config .local/audit-scratch/frontend/vitest.scratch.config.ts --reporter=verbose`) confirmed FE-01.

Contract sweeps (scripts in `.local/audit-scratch/frontend/`):
- All 146 RPC names called from `src/app`/`src/lib` are in `RPC_ALLOWLIST` and defined in `supabase/migrations` (no dead or misspelled commands).
- Every `href`, `router.push` and `redirect` target resolves to an existing route (`/`, `/sign-in`, `/sign-up`, `/account/*`, `/children[/id]`, `/messages`, `/help`, `/clinic[/id/...]`, `/display/[id]`). The `#cu-h` anchor exists on the clinic child page.
- Every mutation body key matches its Zod schema (`src/lib/validation/*.ts` and the inline schemas in `paper-tallies` and `me/contact-preferences`). Field-error keys used for inline errors match the Zod paths (`child.displayName`, `dose.productText`, `patch.dob`, …). No client component imports server-only modules (`@/lib/db`, `env`, `server`, `api`, `security`).
- Every mutation goes through `useMutation` (one key per logical submission, in-flight guard, explicit pending/disabled state), except the read-like `qr/resolve`, which sends a fresh key per lookup. That is intentional.

## Prior findings re-verified against current code

| Prior ID | Status now | Evidence |
|---|---|---|
| ui-audit P1 failed reads shown as empty worklists | Fixed | `today/page.tsx:44-48`, `help/page.tsx:177`, `questions/page.tsx:44-48` and the clinic child page `read()` helper (`children/[childId]/page.tsx:58-62`) no longer catch to `[]`. Errors reach `error.tsx`. `AutoRefresh` takes a label formatted on the server after the reads. |
| ui-audit P1 link search error shown as “no match” | Fixed | `review/cases.tsx:112-188` has an explicit `searchPhase` with an error state. |
| ui-audit P1 compliance claims | Fixed | Footer `layout.tsx:170-173` and hero `page.tsx:63-66` no longer claim WCAG or official status. |
| ui-audit P2 theme toggle / scanner copy / review feedback | Fixed | `theme-provider.tsx:13-21` uses `resolvedTheme`. `clinic/[clinicId]/page.tsx:28` matches the scanner. Reply success notice is at `questions/forms.tsx:26`. |
| Button audit I1, I4, I5, I6, D1, A1, A2 | Fixed | `inventory/page.tsx:48-49`, `subnav.tsx:7`, `inventory/forms.tsx:248-261`, `cold-chain/page.tsx:101-102`, `transfers/page.tsx:126-127`, `download-button.tsx`, `reset-password/page.tsx:9`, `sign-up-form.tsx:59` + `auth/sign-up/route.ts:298`. |
| Button audit A3 (absolute auth redirects) | Not re-checked | Auth/security agent scope. |
| ui-audit dark mode, motion, print, mobile density | Not re-checked | Visual and browser scope. |

## Findings

### FE-01 — Review queue “Approve and post the adjustment” falsely closes transfer-shortfall and exception stock cases
- Priority: P1
- Class: Reproduced defect
- Location: `src/app/clinic/[clinicId]/review/cases.tsx:88`, `:339-367`; producers of other `stock` cases: `supabase/migrations/0019_transfers_temperature.sql:149` (transfer arrived short), `supabase/migrations/0015_administration.sql:210` (care given, no stock posted); command: `supabase/migrations/0011_inventory.sql` `approve_stock_adjustment`
- Evidence: `CaseCard` renders every `kind === "stock"` case with `StockCase`, which assumes count-adjustment evidence (`observed`, `book`, `delta`, `countReference`). The two other producers write different evidence (`{transferId, sent, received}` or `{eventId, lotId, problems}`). The card therefore shows “A physical count found undefined where the books showed undefined (difference undefined)…” and offers “Approve and post the adjustment”. In `approve_stock_adjustment`, `v_loc` is null and `observed` is missing, so `v_delta` is NULL. `IF v_delta <> 0` is not true, so nothing is posted, but the case is still set to `resolved` with `decision: approved`. Scratch repro output (transfer of 5, received 3, approved by the lead):
  `approve result: {"delta":null,"status":"posted","transactionId":null}` → `case after: {"status":"resolved","resolution":{"decision":"approved","postedDelta":null,…}} transfer after: received_short`. The UI then shows “Adjustment posted”.
- Impact: An inventory approver sees success on a stock check that did nothing. For an exception administration, the “stock check opened for the reviewer” (stock never deducted) is closed without any ledger entry, so the books stay wrong with no open case. For a short delivery, the review case disappears while the transfer still waits as `received_short`.
- Root cause: The UI dispatches on `kind` only, and the SQL command does not check that the case is a count proposal.
- Solution: In `CaseCard`, branch on the evidence shape. Count cases (`observed` present) keep the approve button. Transfer cases link to `/clinic/{id}/inventory/transfers`. Exception-stock cases show the lot/event facts and link to the record and stock pages. Separately (DB owner), make `approve_stock_adjustment` raise CV409/CV422 when `evidence ->> 'observed'` or `locationId` is null.
- Acceptance: A short-delivery or exception stock case has no “Approve and post” control and shows no `undefined`. Calling `approve_stock_adjustment` on such a case is refused and the case stays open.
- Verification: A DB test like the scratch repro expects the refusal. A component or browser check that a transfer-short case renders a link to Transfers.

### FE-02 — Review cases of kind `appointment` cannot be acted on, and the oldest-first limit of 50 lets them hide every newer case
- Priority: P1
- Class: Inspection risk (deterministic trace, not executed)
- Location: `src/app/clinic/[clinicId]/review/cases.tsx:61`, `:76-106`; `src/app/clinic/[clinicId]/review/page.tsx:14`; producer `supabase/migrations/0013_visit_commands.sql:52-54` (`cancel_session`); reader `supabase/migrations/0016_review_case_event.sql` `list_review_cases` (`order by k.created_at limit …`)
- Evidence: Cancelling a session inserts one `appointment` review case per confirmed booking (“session cancelled: contact family to rebook”). `CaseCard` has a title for it (“Booking affected by a closed session”) but no branch renders a body, child link or close action. `resolve_review_case` would accept `no_action`, but no control calls it. `ReviewQueue` loads `p_status: "open", p_limit: 50`, ordered by `created_at` ascending, and has no paging or “more” indicator.
- Impact: Staff cannot see which family to call, and cannot clear the item. Each cancelled busy session adds up to its online capacity in dead cards (12 in the default session form). After 50 unresolvable cases, new guardian-link requests, duplicate checks, corrections and exception reviews never appear in the queue, which blocks guardian access and correction approval.
- Root cause: A case kind was added in SQL (0012/0013) without a UI renderer, and the queue reads only the first page, oldest first.
- Solution: Add an `AppointmentCase` renderer showing child, service date and a link to the record, with a “Family contacted” close action (`resolve` with `no_action` and a reason). Add a default branch that renders any unknown kind with its reason and a generic close action. Page the queue (`nextBefore`/offset) or show “showing 50 of N”. Consider newest-first, or grouping by kind.
- Acceptance: Every `kind` value allowed by `record_review_cases_kind_check` renders an actionable card. With more than 50 open cases, the reviewer can reach all of them.
- Verification: A component test over every kind in the check constraint. A DB/UI test that seeds 51 appointment cases plus one link case and asserts the link case is reachable.

### FE-03 — Staff without two-step sign-in get a generic “Something went wrong on our side” page on every clinic route
- Priority: P2
- Class: Missing required behavior
- Location: `src/lib/server/viewer.ts:56-61` (`requireClinicStaff`); `src/app/clinic/[clinicId]/layout.tsx:48`; `src/app/layout.tsx:66-73`, `:113-118`; SQL `private.has_capability` → `private.mfa_ok()` (`0001_foundation.sql`)
- Evidence: `get_my_context` returns active memberships whether or not MFA is satisfied, and exposes `mfa: false`. `requireClinicStaff` checks only the membership, so the layout renders “Clinic workspace” and the staff nav. Each page RPC then goes through `require_capability`/`require_any`, which uses `has_capability`, which requires `mfa_ok()`. It raises CV403 (`list_sessions`, for example), the page throws, and the root `error.tsx` shows “Something went wrong on our side” with a digest. The amber banner is the only hint.
- Impact: In Supabase (production) mode, every staff member who has not finished TOTP sees a server-failure screen instead of being sent to finish security. This looks like an outage and causes support calls. The local demo hides it because MFA is simulated.
- Root cause: The page guard does not use the `mfa` flag it already has.
- Solution: In `requireClinicStaff`, when `!v.ctx.mfa`, `redirect("/account/security?next=…")`. Optionally drop the “Clinic workspace” link from the header until MFA is complete.
- Acceptance: A staff session with `mfa: false` that opens `/clinic/{id}/today` lands on `/account/security`. After MFA it lands back on the clinic page.
- Verification: A unit test of `requireClinicStaff` with a mocked context. Supabase-mode browser check.

### FE-04 — Follow-up list links send barangay health workers to a page their role cannot open
- Priority: P2
- Class: Reproduced defect (code trace)
- Location: `src/app/clinic/[clinicId]/followup/page.tsx:92`; `src/app/clinic/[clinicId]/children/[childId]/page.tsx:63`; role preset `supabase/migrations/0001_foundation.sql:153` (`bhw → ['bhw.followup']`)
- Evidence: The follow-up page is the BHW landing page (`clinicLandingRoute` → `/followup`). Each child name links to `/clinic/{id}/children/{childId}`. That page calls `notFound()` unless `caps.has("child.search")`, and the BHW preset lacks it, so the link shows “This page is unavailable to your account”.
- Impact: The primary follow-up persona hits a dead link on every row. It also looks like an access error.
- Solution: Render the name as plain text when the viewer lacks `child.search`, or point it to a contact-only view. Optionally show a “Record a contact attempt” section instead.
- Acceptance: A `bhw` session on `/followup` has no links that lead to the not-available page.
- Verification: A demo persona `bhw@demo.cvsrs.test` browser check, or a component test over the capability set.

### FE-05 — Timestamps shown as calendar dates by slicing the UTC ISO string (off by one day before 08:00 in Manila)
- Priority: P2
- Class: Reproduced defect (code trace)
- Location: `src/app/clinic/[clinicId]/children/[childId]/holds.tsx:89` (`h.startsAt.slice(0, 10)`); `src/app/clinic/[clinicId]/children/[childId]/certificates.tsx:143` (`c.issuedAt.slice(0, 10)`); `src/app/children/[childId]/page.tsx:212` (guardian certificate “Issued …”); `src/app/clinic/[clinicId]/inventory/transfers/page.tsx:80` (`x.sentAt.slice(0, 10)`); `src/app/clinic/[clinicId]/inventory/forms.tsx:347` (`formatDate(m.at)`, where `formatDate` slices too)
- Evidence: `starts_at`, `issued_at`, `sent_at` and `occurred_at` are `timestamptz`, serialized by `jsonb_build_object` in the database session zone (UTC on Supabase). `formatDate` treats the first 10 characters as a calendar date. A hold placed, a certificate issued, or stock moved at 07:30 Asia/Manila (23:30Z the day before) is shown dated the previous day. Other screens already use `formatClinicDate`/`formatClinicDateTime` with `membership.clinicTimezone`.
- Impact: Wrong dates on clinical holds, certificates (shown to families) and the stock ledger. Staff reconciling paper logs or recalls by date get the wrong day.
- Solution: Replace these with `formatClinicDate(iso, membership.clinicTimezone)`. For the guardian page use `child.clinicTimezone`. Pass the timezone into the client components that need it.
- Acceptance: An event at 2026-10-01T23:30:00Z shows “2 Oct 2026” for an Asia/Manila clinic.
- Verification: A unit test on the new helper usage, and a fixture with an early-morning timestamp.

### FE-06 — The queue board has no path from a called or in-service ticket to the child record where the vaccine is recorded
- Priority: P2
- Class: Missing required behavior
- Location: `src/app/clinic/[clinicId]/today/board.tsx:400-513` (`QueueRow`; there is no `Link` import in the file); `src/app/clinic/[clinicId]/today/page.tsx:79-93` (Expected today); `src/app/clinic/[clinicId]/children/[childId]/page.tsx:128`
- Evidence: The record page says “Start the visit from Today (call the child, then Start service) before recording a vaccine”. After “Start service” the row shows ticket, name and outcome controls only. Neither the queue row nor the appointment row links to `/clinic/{id}/children/{childId}`, although `childId` is in the payload.
- Impact: For every patient, the nurse must leave Today, go to Find, re-type the name, and pick the right child from the search results. That is slower, and it adds a chance of opening the wrong child at the step where identity matters most.
- Solution: Link the child name in `QueueRow` (and in Expected today) to the record. Optionally move focus there on “Start service”.
- Acceptance: From a `called` or `in_service` row, one click opens that child's record with the “Give a vaccine” section visible.
- Verification: A browser QA flow: check-in → call → start service → record dose.

### FE-07 — Repeated authentication and a sequential data waterfall on every clinic page
- Priority: P2
- Class: Inspection risk (performance)
- Location: `src/lib/server/viewer.ts:35-49` (no `React.cache`); `src/app/layout.tsx:44`; `src/app/clinic/[clinicId]/layout.tsx:48`; every clinic `page.tsx` (`requireClinicStaff`); `src/proxy.ts:49`; `src/app/clinic/[clinicId]/children/[childId]/page.tsx:64-90`; `reports/page.tsx:66-71`; `inventory/page.tsx:44-46`; `clinical/page.tsx:26-29`; `clinical/schedules/[versionId]/page.tsx:45-47`
- Evidence: For a clinic route in Supabase mode, `proxy` calls `auth.getUser()`, then the root layout, the clinic layout and the page each call `getViewer()`. Each call is a new `auth.getUser()` (a network round trip to Supabase Auth) plus `get_my_context`. The total is 4 Auth calls and 3 identical context RPCs before any page data. The clinic child page then makes `staff_get_child`, a `Promise.all`, another `Promise.all`, and five more sequential awaits (`list_child_guardian_contacts`, `list_catchup_plans`, `list_clinical_holds`, `list_record_transfers`, `list_child_certificates`). That is 7 sequential round trips where 2 would do. `list_record_transfers` is fetched only for its `clinics` list. The Today page also triggers this full chain every 15 s through `router.refresh()`.
- Impact: Slow navigation on low-bandwidth clinic connections, and avoidable load on Auth and PostgREST (rate limits).
- Solution: Wrap `getViewer` in React `cache()` so one request does one `getUser` and one `get_my_context`. On the child page, fire every independent read in one `Promise.all` after `staff_get_child`. Parallelize the 2–3 sequential reads on the reports, inventory, clinical and schedule pages. Consider a light RPC for transfer target clinics.
- Acceptance: One `auth.getUser` (plus the proxy refresh) and one `get_my_context` per page request. At most 2 sequential RPC stages on the child page.
- Verification: Count RPC calls per request with request-id logging in `supabase.ts`, or add a counter in the local adapter test.

### FE-08 — No `loading.tsx` or segment `error.tsx`: dynamic navigation is not prefetched or acknowledged, and errors drop the staff navigation
- Priority: P2
- Class: Missing required behavior
- Location: the route tree (only `src/app/error.tsx` and `global-error.tsx` exist; there are no `loading.tsx` files); `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md:86,169-173`
- Evidence: Every page is dynamic (`force-dynamic` at the root and per-request RPCs). The Next 16 docs say that for a dynamic route without `loading.tsx`, prefetching is skipped and the old page stays until the server responds. Combined with FE-07, a click in the staff nav gives no feedback for the length of the waterfall. A thrown error in any clinic page renders the root `error.tsx` in place of the whole `clinic/[clinicId]` layout, so the staff nav and clinic name disappear and the only way out is “Go to the start page”.
- Impact: Users click twice, or think the app froze. After an error, staff lose their place in the clinic workspace.
- Solution: Add `src/app/clinic/[clinicId]/loading.tsx` (and `children/loading.tsx`) with a skeleton. Add `src/app/clinic/[clinicId]/error.tsx` that keeps the layout and offers `retry()` and a link back to Today. Optionally use `useLinkStatus` in `StaffNav`.
- Acceptance: A staff-nav click shows a loading state within 100 ms. A failing clinic page still shows the staff nav.
- Verification: Browser QA with throttled network. Throw from a test page.

### FE-09 — “Actual time given” and temperature times are read in the device time zone, not the clinic's
- Priority: P2
- Class: Inspection risk
- Location: `src/app/clinic/[clinicId]/children/[childId]/administration.tsx:40-45`, `:62`, `:128`, `:199`, `:298`; `src/app/clinic/[clinicId]/inventory/cold-chain/forms.tsx:131-137`, `:171`, `:188`
- Evidence: `nowLocal()` and `toIso(local)` use the browser offset (`new Date(local).toISOString()`). The SQL then derives `administered_on` with `(v_at at time zone v_tz)::date` (`0015_administration.sql:105`). If a shared clinic laptop or tablet is set to UTC (a common default) while the clinic is Asia/Manila, a dose given at 07:00 local is entered as 07:00Z (15:00 Manila). It is counted on the wrong calendar day when the entry crosses midnight, and the duplicate-same-day check and interval rules use the wrong day. The review step (`:128`) also displays device-local time without a zone label, so the error is not visible. `src/lib/format.ts:116` states the opposite policy for display.
- Impact: Wrong administration timestamps and dates, and wrong cold-chain reading times, on misconfigured devices. The UI gives no warning.
- Solution: Convert `datetime-local` values using the clinic timezone (a `clinicLocalToInstant(date, time, tz)` helper next to `clinicDateBoundary`). Default “now” from `clinicToday`/clinic time. Show the zone (“Asia/Manila”) next to the field and in the review summary. Optionally warn when the device offset differs from the clinic offset.
- Acceptance: With the browser set to UTC and the clinic set to Asia/Manila, entering 07:00 records 2026-10-01T07:00+08:00.
- Verification: A unit test of the helper. A browser test with `TZ=UTC`.

### FE-10 — Follow-up worklist and child search silently cap results (50/20) with no “more” indication
- Priority: P2
- Class: Missing required behavior
- Location: `src/app/clinic/[clinicId]/followup/page.tsx:54` (`p_limit: 50`; the `Worklist` type has no total); `src/app/api/v1/clinics/[clinicId]/children/route.ts:12` (`p_limit: 20`) with `src/app/clinic/[clinicId]/workspace.tsx:85-89`, `today/board.tsx:290-318`, `review/cases.tsx:174-187`
- Evidence: The worklist SQL (`0022_followup_holds_privacy.sql`, `limit v_lim`) returns at most 50 children ordered by how far behind they are. The page shows them with no total and no next page. Child search returns at most 20 matches, and the UI says nothing when the cap is hit. A common surname at a large clinic can push the right child past the cutoff.
- Impact: BHWs never see children beyond the first 50 in “Behind”/“All” and cannot tell that more exist. Staff can conclude that a child is not registered (and register a duplicate) when the child is match 21.
- Solution: Return `total` (or `hasMore`) from both RPCs. Show “Showing 50 of N” with paging in follow-up. Show “More than 20 matches — add the birth date” in search.
- Acceptance: With 60 behind children, the BHW can reach all 60. A search at the cap shows the refine prompt.
- Verification: A DB fixture plus a component check.

### FE-11 — Guardian edit request always says “No birth date is on file”
- Priority: P3
- Class: Reproduced defect
- Location: `src/app/children/[childId]/page.tsx:243` (`current={{ displayName: child.displayName, dob: null }}`); `src/app/children/[childId]/edit-request.tsx:191`
- Evidence: The page passes a hard-coded `dob: null`, so the hint is always “No birth date is on file.” `my_children` does return `dob`.
- Impact: Families are told the record has no birth date when it does, which invites unnecessary correction requests.
- Solution: Add `dob` to the `MyChild` interface and pass `child.dob`.
- Acceptance: A child with a DOB shows “A birth date is on file.”
- Verification: A component render check.

### FE-12 — Staff access list labels suspended memberships “Waiting for approval”
- Priority: P3
- Class: Reproduced defect
- Location: `src/app/clinic/[clinicId]/access/page.tsx:48`; `supabase/migrations/0005_staff_admin_reads.sql` (`status in ('pending_approval','active','suspended')`)
- Evidence: The chip renders `Active` for active rows and “Waiting for approval” for every other status, including `suspended`.
- Impact: An admin may approve or ignore a suspended account, thinking it is a pending request.
- Solution: Map `suspended` to its own chip (“Paused”) and show approve only for `pending_approval`. The approve button is already gated correctly.
- Acceptance: A suspended row shows “Paused”.
- Verification: A component check.

### FE-13 — Time display without a clinic zone: display-board hydration mismatch, and messages shown to families in UTC
- Priority: P3
- Class: Inspection risk
- Location: `src/app/display/[clinicId]/board.tsx:57`; `src/app/messages/page.tsx:15`
- Evidence: The waiting-room board calls `toLocaleTimeString` without `timeZone` inside a client component. The server render uses the server zone (UTC in typical hosting) and hydration uses the device zone, so text differs, React logs a hydration error and re-renders the client. The first paint also shows server time. Messages are formatted in UTC with a literal “UTC” suffix for Philippine families.
- Impact: Confusing times on the public screen and in the family inbox.
- Solution: Have `public_queue_display` return the clinic timezone, or format `asOf` on the server and pass a string. Format message times in the child's or the viewer's clinic timezone (or Asia/Manila as the product default).
- Acceptance: No hydration warning on `/display/{id}` with server TZ=UTC. Message times shown in local clinic time.
- Verification: Browser console check with server TZ=UTC.

### FE-14 — Consequential one-click or one-field actions without confirmation
- Priority: P3
- Class: Optional improvement
- Location: `src/app/children/forms.tsx:309-336` (guardian “Make a new QR pass” revokes the printed pass); `src/app/clinic/[clinicId]/children/[childId]/actions.tsx:105-130` (staff replacement pass); `src/app/clinic/[clinicId]/settings/forms.tsx:151` (clinic time zone change re-buckets every date); `src/app/clinic/[clinicId]/clinical/schedules/[versionId]/schedule-actions.tsx:252-259` (retire the active schedule); `src/app/clinic/[clinicId]/transfers/page.tsx:118` (release a record to another clinic); `src/app/clinic/[clinicId]/inventory/forms.tsx:400-411` (“Check and repair balances”)
- Evidence: Each of these runs on one click, or with only a free-text reason, and none restates its effect. Merge, replacement certificate and draft discard do have confirm steps (`review/cases.tsx:266-280`, `certificates.tsx:50-61`, `schedule-actions.tsx:207-226`), so the pattern already exists.
- Impact: Accidental revocation of a family's printed pass, schedule retirement for every child, or a timezone change.
- Solution: Reuse the existing inline confirm pattern, with the consequence stated.
- Acceptance: Each action needs a second, explicit confirmation.
- Verification: Browser QA.

### FE-15 — Client logic parses database error text to decide which follow-up control to show
- Priority: P3
- Class: Inspection risk (maintainability)
- Location: `src/app/clinic/[clinicId]/children/[childId]/administration.tsx:72` (`/genuine repeat/`); `src/app/clinic/[clinicId]/today/board.tsx:276` (`/allocation|overflow/i`); messages at `supabase/migrations/0015_administration.sql:114` and `0013_visit_commands.sql:229`
- Evidence: Both checks match today. Any rewording of the SQL message (for example localization, or the planned Filipino text) silently removes the “confirm genuine repeat” checkbox and the walk-in overflow-reason field, and leaves the user stuck on an unexplained CV409.
- Solution: Raise these with a stable `hint` (as `cvsrs:operation_key_reused` already does). Map it in `fromDbError` to a `reason` field in the API error, and branch on that field.
- Acceptance: The UI decision does not depend on message text.
- Verification: A unit test on `fromDbError`, plus the existing DB tests.

### FE-16 — Staff PDF and CSV downloads are bare links; failures navigate to a raw JSON error page
- Priority: P3
- Class: Inspection risk
- Location: `src/app/clinic/[clinicId]/children/[childId]/certificates.tsx:159-163`; `src/app/clinic/[clinicId]/reports/page.tsx:130-134`; routes `api/v1/certificates/[certificateId]/download/route.ts:11-36`, `reports/[name]/export/route.ts:15-43`
- Evidence: On 401, 404, 429 or 500, these routes return `{"error":{…},"requestId":…}` JSON. A plain `<a href>` navigates the tab to that JSON, and the staff member loses the page. The guardian side already uses `DownloadCertificateButton` with an error notice.
- Solution: Reuse the fetch-to-blob button pattern (with an error notice) for staff PDF and CSV downloads.
- Acceptance: A failed download shows an inline alert and the page stays.
- Verification: Browser QA with a revoked or unknown certificate id.

### FE-17 — Irreversible merge is audited with a hard-coded reason
- Priority: P3
- Class: Missing required behavior
- Location: `src/app/clinic/[clinicId]/review/cases.tsx:248`, `:272`
- Evidence: `mergeBody` requires a reviewer reason (min 3). The UI always sends “Confirmed same child by reviewer”, whatever the reviewer checked.
- Impact: The audit record for an irreversible identity merge says nothing about the evidence used.
- Solution: Add a required reason field to the confirm step.
- Acceptance: The merge request carries the reason the reviewer typed.
- Verification: A component check, plus the audit row in a DB test.

### FE-18 — Dates of birth shown as raw ISO strings in staff identity decisions
- Priority: P3
- Class: Reproduced defect (consistency)
- Location: `src/app/clinic/[clinicId]/today/board.tsx:298`; `src/app/clinic/[clinicId]/review/cases.tsx:153`, `:183`, `:225`, `:95`
- Evidence: These print `h.dob` or `ev.dob` directly (“2025-03-04”). Everywhere else uses `formatDate` (month names, BP35 ambiguity rule).
- Impact: These are identity-matching screens (walk-in pick, link approval, duplicate merge), and dates in mixed formats are easy to misread.
- Solution: Use `formatDate(…, { fallback: "DOB not recorded" })`.
- Acceptance: No raw ISO dates in the UI.
- Verification: `grep` for `.dob ??` in TSX.

### FE-19 — Inconsistent password minimum between sign-up and reset
- Priority: P3
- Class: Reproduced defect (consistency)
- Location: `src/app/sign-up/sign-up-form.tsx:57`, `:184`; `src/app/auth/sign-up/route.ts:279` (8); `src/app/account/reset-password/reset-password-form.tsx:123-124` (`minLength={12}`)
- Evidence: An account is created with an 8-character password, but the reset form rejects anything under 12 with no explanation (native validation only).
- Solution: Use one shared constant and hint text, and confirm the policy with the auth owner.
- Acceptance: The same rule and message on both forms.
- Verification: A unit test on the shared constant.

### FE-20 — Swallowed batch-RPC error with an N+1 fallback on My Children
- Priority: P3
- Class: Inspection risk
- Location: `src/app/children/page.tsx:40-56`
- Evidence: `get_pending_privacy_notices` (migration 0031) is wrapped in `.catch(() => null)`. Any failure, including authorization or a transient error, silently triggers one `get_privacy_notice` call per public clinic. The fallback served pre-0031 databases, and every supported database now has 0031.
- Impact: Hidden errors and an unbounded fan-out as the clinic list grows.
- Solution: Remove the fallback and let a failure reach the error boundary, or catch only “function does not exist”.
- Acceptance: One privacy RPC per page load.
- Verification: An RPC count in a local-adapter test.

### FE-21 — Dead or duplicate UI code and paths
- Priority: P3
- Class: Optional improvement
- Location: `src/components/ui/button.tsx` and `src/lib/utils.ts` (no importers; they pull `@base-ui/react`, `class-variance-authority`, `cn`); `src/app/clinic/[clinicId]/clinical/config-forms.tsx:163` (`MasterStatusButton` supports `retired`, but there is no retire control for antigens or products); duplicate success announcement through a sonner toast plus an inline live-region notice in `src/app/children/forms.tsx:56,117,166`, `children/[childId]/report-dose.tsx:28`, `reports/paper-tally.tsx:23`; eight near-identical local `Outcome` components (`today/board.tsx`, `actions.tsx`, `administration.tsx`, `catchup.tsx`, `inventory/forms.tsx`, `cold-chain/forms.tsx`, `transfers/forms.tsx`, `review/cases.tsx`)
- Impact: Extra dependencies and drift. Screen readers announce success twice. There is no UI to retire a product (only SQL).
- Solution: Delete the unused primitives and dependencies. Move `Outcome` to `components/ui`. Keep either the toasts or the inline notices. Add retire controls if retirement is in scope.
- Acceptance: `npm ls` has no unused UI deps. One shared outcome component.
- Verification: Lint/knip, then build.

## Coverage inventory

Status key: **Inspected** = every control traced end-to-end; **Defect found** = inspected and at least one finding above; **Not inspected** = outside this pass.

| Route / component | Controls traced | Status |
|---|---|---|
| `app/layout.tsx` | header nav links, unread badge, MFA banner, ThemeToggle, SignOut | Defect found (FE-03, FE-07) |
| `app/error.tsx`, `global-error.tsx`, `not-found.tsx` | retry, start-page link (`retry` prop matches Next 16 docs) | Defect found (FE-08) |
| `app/page.tsx` | CTA links, clinic list, display links | Inspected |
| `sign-in/page.tsx`, `sign-in-form.tsx` | persona buttons, group toggle, email/password, show password, forgot link | Inspected |
| `sign-up/page.tsx`, `sign-up-form.tsx` | fields, consent, submit, redirect to check-email | Defect found (FE-19) |
| `account/forgot-password/*` | recovery form (uniform response) | Inspected |
| `account/reset-password/*` | link check, update password | Defect found (FE-19) |
| `account/security/*` (`MfaPanel`) | enroll, verify, retry | Inspected (real Supabase not exercisable) |
| `verify/[token]/page.tsx` | public status view, rate limit | Inspected |
| `display/[clinicId]/page.tsx`, `board.tsx` | 5 s polling, stale flag, ordering guard | Defect found (FE-13) |
| `help/page.tsx` | read-only list | Inspected |
| `messages/page.tsx`, `mark-read.tsx`, `text-settings.tsx` | mark all read, phone/language save, SMS toggle | Defect found (FE-13) |
| `children/layout.tsx`, `children/page.tsx` | child cards, links | Defect found (FE-20) |
| `children/forms.tsx` | AddChildForm, LinkRequestForm, QrPanel | Defect found (FE-14, FE-21) |
| `children/privacy-notice.tsx` | accept notice | Inspected |
| `children/[childId]/page.tsx` | queue card, schedule, plan, history, certificates | Defect found (FE-05, FE-11) |
| `children/[childId]/visits.tsx` | book, change time, cancel (confirm) | Inspected |
| `children/[childId]/checkin.tsx` | ask the clinic | Inspected |
| `children/[childId]/download-button.tsx` | PDF fetch, error, retry | Inspected |
| `children/[childId]/edit-request.tsx` | request correction | Defect found (FE-11) |
| `children/[childId]/move-record.tsx` | request move, cancel | Inspected |
| `children/[childId]/report-dose.tsx` | report outside dose | Defect found (FE-21) |
| `clinic/page.tsx` | clinic chooser, single-clinic redirect | Inspected |
| `clinic/[clinicId]/layout.tsx`, `staff-nav.tsx` | capability-gated nav | Defect found (FE-03, FE-07, FE-08) |
| `clinic/[clinicId]/page.tsx`, `workspace.tsx` | ChildSearch, QrLookup, RegisterChildForm (+ register anyway) | Defect found (FE-10) |
| `clinic/[clinicId]/qr-scanner.tsx` | camera start/stop, BarcodeDetector fallback | Inspected |
| `clinic/[clinicId]/today/page.tsx`, `board.tsx` | AutoRefresh, CreateSession, check-in, walk-in + overflow, call next, call/start/finish/hold/left/cancel/prioritise | Defect found (FE-06, FE-15, FE-18) |
| `clinic/[clinicId]/children/[childId]/page.tsx` | section gating, reads | Defect found (FE-07) |
| `…/children/[childId]/actions.tsx` | ConfirmIdentity, GuardianActions (verify, pause/remove), StaffQr, EditIdentity | Defect found (FE-14) |
| `…/children/[childId]/administration.tsx` | Administer (review → sign, repeat confirm), ExceptionForm, CorrectionForm (3 kinds + child search) | Defect found (FE-09, FE-15) |
| `…/children/[childId]/catchup.tsx` | draft save/edit, submit, cancel, approve/reject, withdraw, item done/dropped | Inspected |
| `…/children/[childId]/certificates.tsx` | prepare, replace (confirm), retry, revoke/discard, download | Defect found (FE-05, FE-16) |
| `…/children/[childId]/contacts.tsx` | verify phone | Inspected |
| `…/children/[childId]/evidence.tsx` | OutsideDoseForm, VerifyEvidence | Inspected |
| `…/children/[childId]/holds.tsx` | place, release | Defect found (FE-05) |
| `clinic/[clinicId]/review/page.tsx`, `cases.tsx` | link approve/reject + search, merge (confirm), not-duplicate, edit close, stock approve, correction approve/decline, exception accept/reject | Defect found (FE-01, FE-02, FE-17, FE-18) |
| `clinic/[clinicId]/inventory/page.tsx`, `forms.tsx`, `subnav.tsx` | location, lot, receive, wastage, count, ledger, disposition, trace, reconcile | Defect found (FE-05, FE-14) |
| `clinic/[clinicId]/inventory/cold-chain/*` | limits, reading, excursion review | Defect found (FE-09) |
| `clinic/[clinicId]/inventory/transfers/*` | send, receive, cancel, shortfall decision | Defect found (FE-05) |
| `clinic/[clinicId]/followup/*` | filters, refresh, contact attempt | Defect found (FE-04, FE-10) |
| `clinic/[clinicId]/questions/*` | reply, policy on/off | Inspected |
| `clinic/[clinicId]/transfers/*` | accept, release, decline, StartTransfer | Defect found (FE-14) |
| `clinic/[clinicId]/content/*` | draft save, submit, approve/reject, withdraw, new content | Inspected |
| `clinic/[clinicId]/settings/*` | profile save (timezone), ops check | Defect found (FE-14) |
| `clinic/[clinicId]/access/*` | request access, approve, remove | Defect found (FE-12) |
| `clinic/[clinicId]/audit/page.tsx` | GET filters, paging | Inspected |
| `clinic/[clinicId]/clinical/*` | antigen/product add + activate, schedule import, privacy notice | Defect found (FE-21) |
| `clinic/[clinicId]/clinical/schedules/[versionId]/*` | submit, discard (confirm), approve, activate, retire | Defect found (FE-14) |
| `clinic/[clinicId]/reports/page.tsx`, `paper-tally.tsx` | report nav, date filter, CSV, tally save | Defect found (FE-07, FE-16) |
| `clinic/[clinicId]/outage-forms/*` | print | Inspected |
| `components/ui.tsx`, `schedule-view.tsx`, `sign-out-button.tsx`, `theme-provider.tsx`, `toaster.tsx`, `scroll-shadow.tsx` | shared primitives, sign-out confirm, theme | Inspected |
| `components/ui/button.tsx`, `lib/utils.ts` | unused | Defect found (FE-21) |
| `lib/client/api.ts` (`callApi`, `useMutation`) | key lifecycle, in-flight guard, timeout, unknown outcome | Inspected |
| `lib/format.ts` | date/time helpers | Inspected (misuse in FE-05, FE-09) |
| `lib/client/supabase-browser.ts` | publishable key only | Inspected |
| `app/api/**`, `app/auth/**`, `app/dev/login` | contracts only, for the client calls above | Not inspected (API/auth agents) |
| Visual: dark mode, print layout, mobile density, contrast | — | Not inspected (browser QA) |
