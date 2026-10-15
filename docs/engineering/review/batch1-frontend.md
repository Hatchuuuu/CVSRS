# Batch 1 frontend review (B1 + B2)

Date: 2026-10-02. Reviewer model: claude-opus-5-5. Independent reviewer; I did not write any of this code. No source files were edited.

Scope: the current content of the files listed for implementers B1 and B2, checked against the acceptance criteria in `docs/engineering/discovery/frontend.md` (FE-*) and `docs/engineering/discovery/ui.md` (UI-*), plus correctness, security, accessibility and regressions. The working tree is shared with other implementers who were still editing during the review: `src/app/children/page.tsx` changed at 12:02, while the review was running. Everything below describes the files as they stood at about 12:00–12:15.

## Gates (run fresh during this review)

| Check | Result |
|---|---|
| `npm run lint` | PASS (exit 0) |
| `npx tsc --noEmit` | PASS (exit 0, no output). This includes `src/lib/api/handler.ts` and the shell/auth tests owned by other implementers, so there is nothing to report against them. |
| Listed unit tests (`clinic-time-conversion`, `clinic-time-display`, `viewer-cache`, `viewer-page-loading`, `viewer-access`, `staff-ui-*`) | 10 files, 102/102 PASS |
| Full unit suite `npx vitest run tests/unit` | 52 files, 375/375 PASS |
| Scratch brute-force time-zone check (`.local/audit-scratch/review1/tz-brute.test.ts`, config `vitest.review.config.ts`) | 26/26 PASS (see section 1) |
| `next build`, browser | Not run. A build would share `.next` with the other implementers' dev servers. Browser QA belongs to the QA verifier. |

## Checklist results

1. **Time-zone helpers.**
   - **`clinicLocalToInstant` and `instantToClinicLocal`.** Brute-forced, hour by hour through 2026, in 12 zones, with the process zone set to UTC: Asia/Manila, America/New_York, Europe/London, Australia/Lord_Howe (30-minute DST), America/Santiago, Pacific/Chatham (+12:45), Asia/Kolkata, Pacific/Kiritimati (+14), America/St_Johns, Africa/Casablanca, Pacific/Apia, UTC.
     - Instant → wall → instant round-trips. In an overlap the earlier instant is returned, which is the "compatible" rule.
     - Every wall time either round-trips, or (inside a DST gap) maps forward past the gap.
     - Invalid input returns null: 24:00, month 13, Feb 30, an empty string, a time without a date. Leap days work.
   - **`formatClinicDate` format change.** Every caller is display-only: `move-record.tsx:67`, guardian `children/[childId]/page.tsx:215`, `certificates.tsx:144`, `holds.tsx:89`, `inventory/forms.tsx:348`, `inventory/transfers/page.tsx:80`, `transfers/page.tsx:44`. No CSV export, API route, script or parser uses it (grepped `src`, `scripts`, `src/app/api`). The tests that assert dates expect the new "2 Oct 2026" form, and no test was weakened.
2. **MFA redirect in `requireClinicStaff`.**
   - **No loop.** `/account/security` uses `requireViewer` only, not `requireClinicStaff`.
   - **Order.** Non-members are sent to `/clinic` before the MFA check (`viewer-access.test.ts` covers this).
   - **Local demo.** `src/lib/db/local.ts:42` marks every dev session `aal2`, and `private.mfa_ok()` accepts it, so `mfa` is true.
   - **Return path.** It is built with `securityPageFor`, which validates it against the strict clinic-path allowlist. The security page honours it.
   - The doc comment at `viewer.ts:61` ("does not take a return address yet") is now stale. It is cosmetic.
3. **`getViewer` with `cache()`.**
   - React `cache` memoizes per server request, so nothing leaks across requests or users.
   - `viewer.ts` is imported only by pages and layouts, never by `src/app/api/**`. Outside a render, `cache` simply calls the function.
   - The new `ctx.status === "active"` filter is redundant but harmless: `get_my_context` already returns null for a profile that is not active (`0029_clinic_timezones.sql`).
4. **Child page `Promise.all`.**
   - **Capability gates are unchanged from HEAD:** `canClinical`, `canEvidence`, `canRecord`, `guardian.verify`, `certificate.issue`.
   - **Previously swallowed failures now reject the page:** `.catch(() => null)` on `list_active_products`, `list_stock`, contacts, catch-up plans, holds, transfers and the privacy notice. That is the intended FE-07 behaviour.
   - **No legitimate null is turned into an error.** I checked every RPC behind the new null-throwing `read()` helper: each one either `coalesce(…, '[]')`s or returns null only when the child is not in the clinic, and `staff_get_child` has already established that.
5. **`loading.tsx` / `error.tsx`.**
   - **Props.** Both match the Next 16 contract: `{ error, retry }` (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md`).
   - **Placement.** `error.tsx` does not wrap the layout of its own segment, so the staff navigation stays (FE-08 acceptance).
   - **Content.** No raw error text is shown, only `error.digest`. Errors are announced with `role="alert"` and loading with `role="status"`. The pulse animation is `motion-safe` only.
   - **Status codes (P3, informational).** Pages now sit under a Suspense boundary, so a `notFound()` raised after `await requireClinicStaff` is streamed with HTTP 200 and `noindex` instead of 404 (loading.md, "Status Codes"). The visible behaviour is unchanged. Layout-level redirects still happen before streaming.
6. **FE-01/FE-02 renderers.**
   - **Kinds.** The last definition of `record_review_cases_kind_check` is in `0012_visits.sql:168`: duplicate, link, identity_edit, correction, clinical, stock, sync, appointment. `case-kinds.ts` covers each one, and unknown kinds fall back to a generic renderer.
   - **Stock producers.** All three are told apart by evidence shape: count (`0011:326`), transfer short (`0019:149`), exception (`0015:210`). Approve appears only for a count.
   - **No raw values.** `quantity()` and `textOf()` cannot render undefined, NaN or `[object Object]`. The test sweeps every kind with full and sparse evidence.
   - **Request bodies match the route schemas exactly:**
     - `resolve`: `{outcome:"no_action"|"not_duplicate"|…, reason}` against `resolveCaseBody` (strict).
     - Merge: `{survivorId, duplicateId, reason}` against `mergeBody`.
     - Link: `{decision, childId, method}` and `{decision, reason}` against `resolveLinkBody`.
     - Corrections: `{}` and `{reason}`.
     - Exception decision: `{decision, note}`.
     - Stock approve: no body.
   - **Transfer shortfall.** Deciding it does close the review case (`0019:207-208`). The case belongs to the sending clinic, whose Transfers page shows the decision.
7. **Confirmation flows (FE-14).**
   - **First click never mutates.** Every flow's first click only opens the confirm step (unit-tested with the hooks stubbed).
   - **Cancel buttons are safe.** `Button` defaults to `type="button"` (`components/ui.tsx:82`), so cancel buttons inside forms (merge, time zone, retire) cannot submit.
   - **Idempotency keys survive the round trip.** `useMutation` keys live at component level, so confirm → cancel → confirm reuses the key until a definitive outcome. A lost response therefore replays and cannot duplicate.
   - **Focus is not managed** (RV1-01).
8. **Download button.**
   - Blob plus a temporary `<a download>`. The object URL is revoked after 60 s, because revoking at once can cancel the download.
   - The file name comes from `Content-Disposition`, with `/` and `\` replaced, and falls back otherwise.
   - On a non-2xx response it shows the API's own safe message plus the request id in a `role="alert"` notice, and does not navigate.
   - `callApi` is not involved. `fetch` failures are caught.
   - A `filename*=` value that is only percent-encoded is not decoded. That is cosmetic, and today's routes send a plain `filename="…"`.
9. **Today board.**
   - **UI-05.** The check-in ticket is lifted into `CheckInRegion` above "Expected today", announced, and focus moves to it.
   - **UI-06.** The outcome select is `required`, with an empty disabled default, and the submit handler also refuses an empty value. It cannot be bypassed from the UI; the server rule is deferred to batch 2.
   - **FE-04/FE-06.** Record links are gated on `child.search`, which is the capability the record page itself requires (`children/[childId]/page.tsx` `notFound()`). They are absent for the BHW preset.
   - One stale-banner edge case remains (RV1-05).
10. **Tests.**
    - They exercise behaviour rather than restating the code. For example: rendering through the real pages with gated RPC stubs that prove which reads start together; brute-force rendering over every case kind; confirm steps that assert `run` was not called.
    - I found no tautologies and no weakened assertions.
    - One robustness gap: RV1-07.

## Verdicts

| ID | Owner | Verdict | Reason |
|---|---|---|---|
| FE-03 | B2 | APPROVE | A staff session with `mfa:false` is redirected to `/account/security?next=/clinic/{id}`. Non-members still go to `/clinic`. No loop. The demo is unaffected. It returns to the clinic home rather than the exact page first requested, which meets the acceptance ("lands back on the clinic page"). |
| FE-05 | B1+B2 | APPROVE | Every listed location now uses `formatClinicDate` with the clinic zone (guardian side: the child's clinic zone, falling back to Asia/Manila). 23:30Z shows "2 Oct 2026" (tested). |
| FE-07 | B1+B2 | APPROVE | `getViewer` is `cache()`d (one client, one `getUser`, one `get_my_context` per request; tested). The child page has 2 stages. The clinical, schedule, inventory and reports pages run their reads in parallel. Capability gates are unchanged. |
| FE-08 | B2 | APPROVE | `loading.tsx` and `error.tsx` exist for `clinic/[clinicId]` and `children`, with the correct Next 16 props, no raw error text, and the staff nav kept. Streaming 404s become 200, which is informational (item 5). |
| FE-09 | B2 | APPROVE (follow-up RV1-03) | `datetime-local` values are read and defaulted as clinic wall time, the zone is named in the hint and in the review step, and DST is handled. The review step should not allow signing an unreadable time. |
| FE-11 | B2 | APPROVE | `dob` is passed through, and the hint shows the date on file. |
| FE-13 | B2 | APPROVE | Message times are in the child's clinic zone with no "UTC". The display board renders no clock on the server (`useSyncExternalStore` mount gate), so hydration cannot mismatch. Overlapping polls and older replies are ignored. |
| FE-20 | B2 | APPROVE | One `get_pending_privacy_notices` read, no N+1 fallback, and a failure reaches the error boundary. |
| UI-07 | B2 | APPROVE | Same change as FE-13 (messages). |
| UI-10 (cards) | B2 | APPROVE (browser re-check pending) | `min-w-0`, `break-words` and `flex-wrap` are on the card header. The 200 % text probe must still be re-run by QA. |
| UI-13 (messages) | B2 | APPROVE | "Open record" is now `inline-flex min-h-11`. |
| FE-01 (UI) | B1 | APPROVE (follow-up RV1-02) | Stock cases are told apart by evidence. "Approve and post" appears only for counts. The transfer and exception cards show real facts and route to where the decision is made. The DB refusal is another owner's work. |
| FE-02 (UI) | B1 | APPROVE | Appointment cases have a renderer and a "Family contacted" close action. Unknown kinds get a generic close. A cap notice appears at 50. Paging (the second acceptance criterion) is queued for batch 2, per the plan. |
| FE-04 | B1 | APPROVE | Follow-up names are links only with `child.search`; the BHW case is tested. |
| FE-06 | B1 | APPROVE | Queue rows and "Expected today" rows link to the record when the viewer can open it. |
| FE-12 | B1 | APPROVE | A suspended membership shows "Paused". Approve stays gated on `pending_approval`. |
| FE-14 | B1 | **REWORK** | Behaviour and safety are correct, but each confirm step unmounts the button that opened it. Keyboard and screen-reader focus falls to `<body>` on open and on cancel (RV1-01). |
| FE-16 | B1 | APPROVE | Staff certificate and CSV downloads use the shared fetch-to-blob button. A failure shows an inline alert and the page stays. |
| FE-17 | B1 | APPROVE | The merge confirm step requires a typed reason (3–500 characters), which is sent as the merge `reason` (tested). |
| FE-18 | B1 | APPROVE | No raw ISO dates of birth remain in the review, walk-in or link-search screens. |
| UI-05 | B1 | APPROVE (follow-up RV1-05) | The ticket is shown, announced and focused above "Expected today". "Now calling" clears once the ticket is started, finished or removed. |
| UI-06 (UI) | B1 | APPROVE | No pre-selected outcome, and the select is `required`. The server rule is batch 2. |
| UI-10 (Today) | B1 | APPROVE (browser re-check pending) | `[&>*]:min-w-0`, a single column below `xl`, and wrapping rows. |
| UI-14 | B1 | APPROVE | Cancelled and rescheduled bookings sit in a collapsed "Cancelled today" group. Every status has a worded label. |
| UI-16 (review) | B1 | APPROVE | Each card region has a unique name (title, child, "item n of N"). |

## New defects

### RV1-01 — Confirmation steps drop keyboard focus on open and on cancel
- Priority: P3
- Class: Reproduced defect (code trace; the same DOM behaviour UI-12 reproduced in Chrome for the sign-out confirm)
- Location:
  - `src/app/children/forms.tsx:199`, `:193` (QR pass)
  - `src/app/clinic/[clinicId]/children/[childId]/actions.tsx:140`, `:134` (staff QR)
  - `src/app/clinic/[clinicId]/settings/forms.tsx:45`, `:74` (time zone)
  - `src/app/clinic/[clinicId]/clinical/schedules/[versionId]/schedule-actions.tsx:39` (retire)
  - `src/app/clinic/[clinicId]/transfers/forms.tsx:46`, `:40` (release)
  - `src/app/clinic/[clinicId]/inventory/forms.tsx:404` (repair)
  - `src/app/clinic/[clinicId]/children/[childId]/certificates.tsx:64`, `:58` (replacement)
- Evidence:
  - In each flow, the trigger is rendered only while `confirming` is false. Activating it sets `confirming=true`, React removes the focused `<button>`, and `document.activeElement` becomes `BODY`. The confirm group is not focused, and it is not a live region.
  - "Keep…/Cancel" removes the confirm group and re-mounts a new trigger without focusing it.
  - `grep autoFocus|.focus()` finds no focus handling in any of these files. The project already has the pattern in `src/components/disclosure.ts` (focus into the panel, return focus to the trigger).
- Impact: A keyboard or screen-reader user who opens a consequential confirmation has to Tab from the top of the page to reach "Yes…/Keep…", and loses their place after cancelling. Staff run these on busy clinic days (QR replacement, record release). This is the same defect class as UI-12.
- Root cause: The trigger and the confirm group are swapped without any focus management.
- Solution: When the confirm group opens, focus its consequence text (`tabIndex={-1}`) or the safe "Keep…" button. On cancel, return focus to the trigger, either by keeping the trigger mounted with `aria-expanded` (as the discard-draft flow does) or through a ref and an effect. A small shared `useConfirmStep()` built on the `useDisclosure` focus rules would cover all seven flows.
- Acceptance: After Enter on each trigger, `document.activeElement` is inside the confirm group. After cancel, it is the trigger.
- Verification: A component test with a DOM (or a Playwright Tab check) asserting `activeElement` for one flow, plus a grep that every confirm flow uses the shared hook.

### RV1-02 — Stock review cards link non-inventory reviewers to pages that 404 for them
- Priority: P3
- Class: Reproduced defect (code trace)
- Location: `src/app/clinic/[clinicId]/review/cases.tsx:491` (Transfers link), `:517` (stock page link); `src/app/clinic/[clinicId]/inventory/transfers/page.tsx:55`; `src/app/clinic/[clinicId]/inventory/page.tsx:43`; `supabase/migrations/0016_review_case_event.sql` (`list_review_cases` has no per-kind filter)
- Evidence:
  - The assistant preset (`0001_foundation.sql:145`: `guardian.verify` and no inventory capability) can open the review queue, and `list_review_cases` returns every kind.
  - The transfer-short card always renders "Decide the shortfall on the Transfers page" → `/inventory/transfers`, which calls `notFound()` unless the viewer has `inventory.manage` or `inventory.approve`.
  - The exception-stock card always renders "Open the stock page" → `/inventory`, which calls `notFound()` without `inventory.*` or `vaccination.record`.
- Impact: This is the FE-04 pattern: a dead "unavailable to your account" link for reception and assistant staff.
- Solution:
  - Pass `canOpenTransfers` (`inventory.manage || inventory.approve`) and `canOpenStock` into `CaseCard`, and render the link or plain text ("An inventory approver decides this on the Transfers page"), like the other cards' `allowed` text.
  - Optionally gate `RecordLink` on `child.search` through `childRecordHref`.
- Acceptance: A viewer holding only `guardian.verify` sees no link to `/inventory*` on any review card.
- Verification: Extend `staff-ui-review-cases.test.ts` with an assistant capability set.

### RV1-03 — The administration review step allows signing a time it has just called invalid; the server then records "now"
- Priority: P3
- Class: Inspection risk
- Location: `src/app/clinic/[clinicId]/children/[childId]/administration.tsx:46`, `:81`, `:121-131`, `:146`; `src/lib/validation/administration.ts:10` (`administeredAt` optional); `supabase/migrations/0015_administration.sql:92` (`coalesce(…, now())`)
- Evidence:
  - When `clinicLocalToInstant(when)` returns null, the review row reads "Not a valid time: go back and edit", but "Sign and record" stays enabled.
  - `toIso` then sends `administeredAt: undefined`. The schema allows that, and `record_administration` substitutes `now()`.
  - The code comment claims "the server's validation message is shown instead", which is true for the exception form (where the field is required) but not here.
  - Reaching this needs a value that is not a valid `datetime-local`. That is unlikely in current browsers, but possible with a text-input fallback or a year outside 4 digits.
- Impact: A signed clinical record could carry a time the nurse did not enter, while the screen said it was invalid.
- Solution: Disable "Sign and record" (and return to edit) when `givenAt` is null. Alternatively, send the raw value so the schema rejects it.
- Acceptance: With an unparseable `when`, no request is sent from the review step.
- Verification: A component test that renders the review step with `when="bad"` and asserts the sign button is disabled.

### RV1-04 — Guardian "clear" requests are shown to staff as "(left empty)"
- Priority: P3
- Class: Reproduced defect (cross-implementer interaction)
- Location: `src/app/children/[childId]/edit-request.tsx` (sends `dob: null`, `dobPrecision: "unknown"`, `addressText: null` for the new clear checkboxes); `src/app/clinic/[clinicId]/review/cases.tsx:401` (`textOf(v) ?? "(left empty)"`)
- Evidence: JSON drops `undefined` keys, so a key with a `null` value reaches the case only when the guardian explicitly asked to remove the value. `EditCase` renders it as "dob: **(left empty)**" and "addressText: **(left empty)**". That reads as "nothing provided", not "please remove". The keys are also shown as raw field names (`dobPrecision`).
- Impact: A reviewer can misread a removal request as a no-op and close it as handled.
- Solution: Render `null` as "remove / mark as unknown", map the field names to labels, and hide `dobPrecision` when it only accompanies a `dob` change.
- Acceptance: A case with `patch: {dob: null, dobPrecision: "unknown"}` reads "Birth date: mark as unknown".
- Verification: Add the case to the review-card sweep.

### RV1-05 — "Now calling" reappears after a called ticket is held and returned to the line
- Priority: P3
- Class: Inspection risk (logic trace)
- Location: `src/app/clinic/[clinicId]/today/queue-logic.ts:16`; `src/app/clinic/[clinicId]/today/board.tsx` (`called` → "Put on hold" → `held` → "Return to line" → `waiting`)
- Evidence: `callNextNotice` keeps the banner while the ticket is `called` or `waiting`. `waiting` is there to bridge the moment before the refresh arrives. The `next` mutation state persists across refreshes. So after call → hold → return to line, the same ticket is `waiting` again and "Now calling A1" shows above a list where A1 is only waiting.
- Impact: A smaller version of the stale banner that UI-05 set out to remove.
- Solution: Clear the notice once the ticket has been seen in any status other than `called` (a ref or state set in an effect), or compare the entry's `version` with the version returned by call-next.
- Acceptance: After call → hold → return to line, no "Now calling" banner is shown.
- Verification: Extend `staff-ui-today.test.ts` with the sequence.

### RV1-06 — Closing a review case with `no_action` stores status `rejected` ("Family contacted" is recorded as rejected)
- Priority: P3
- Class: Inspection risk (DB owner; reported, not a B1 defect)
- Location: `supabase/migrations/0003_registry.sql:796`
- Evidence: `resolve_review_case` sets `status = case when p_outcome = 'not_duplicate' then 'resolved' else 'rejected' end`. The new UI uses `no_action` for "Family contacted", "Close this stock check" and the generic close (FE-02 suggested exactly that), so each of these is stored as `rejected`. The resolution JSON does keep `outcome: no_action`.
- Impact: Status-based reporting and audit reading will count handled follow-ups as rejections.
- Solution (DB owner, new forward migration): Map `no_action` to `resolved`. Optionally add a distinct outcome such as `contacted`.
- Acceptance: A case closed with `no_action` has `status = 'resolved'`.
- Verification: A DB test on `resolve_review_case`.

### RV1-07 — The kind-coverage test reads a fixed migration instead of the latest constraint
- Priority: P3
- Class: Optional improvement (test robustness)
- Location: `tests/unit/staff-ui-review-cases.test.ts:70`
- Evidence: The test parses `supabase/migrations/0012_visits.sql` only. A later forward migration that redefines `record_review_cases_kind_check` would not fail it, which defeats the "kinds mirror the constraint" guard.
- Solution: Scan `supabase/migrations/*.sql` in order and take the last `record_review_cases_kind_check check (...)`.
- Acceptance: Adding a kind in a new migration fails the test until `REVIEW_CASE_KINDS` is updated.
- Verification: Temporarily add a fixture migration in a scratch copy and run the test.

## Notes (not findings)

- **`viewer.ts:61` stale comment.** It says `/account/security` takes no return address; it does now (`clinicReturnPath`).
- **`AdministerPanel` default time and `max`.** These are computed on both server and client, so hydration can differ in the minute digit at a minute boundary. This is far better than before (the server zone against the device zone always differed), and not worth a finding.
- **`/children` list markup (pre-existing, not B2's change).** The list is a `<div aria-label="Children">` with no role, so the label is ignored and the list semantics of the old `<ul>` are lost. The UI audit sweep (`.local/audit-scratch/ui/sweep-family.json`, "Record #CV-…") shows this redesign predates batch 1. It should go to the UI owner.
- **Reports CSV range.** It uses the server-rendered `from`/`to`, not dates edited in the form but not yet submitted. Unchanged from the old `<a href>`.

## Rework list

1. **B1:** RV1-01 (FE-14 focus management). This is the only REWORK.
2. **Recommended follow-ups, not blocking:**
   - B1: RV1-02, RV1-04 (display), RV1-05, RV1-07.
   - B2: RV1-03.
   - DB owner: RV1-06.
