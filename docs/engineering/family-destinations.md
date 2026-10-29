# Family sidebar destinations

## Three-portal implementation update — 17 October 2026

Family routes now select Parents Portal independently of staff membership. Shared Account and Messages links carry validated `portal` and `clinic` presentation context; database authorization is unchanged. Register and Link open `/children/register` and `/children/link`, with the same clinic privacy gate and existing form commands. Legacy My Children anchors remain task entrances. Contact preferences live at `/account#contact-h`; `/messages#txt-h` retains a usable link. Actual SMS delivery is unavailable; phone contact and opt-out remain functional.

The current implementation and fresh verification evidence are tracked in `docs/audit/2026-10-17-three-portals-completion.md`; the older evidence below describes the earlier increment and is not a new test claim.

17 October 2026. User requested Vaccination records, Appointments and Settings / Account, with working workflows rather than placeholder links.

## Design and scope

Keep the existing family workspace, responsive sidebar/mobile menu and top-right profile menu. Retain My Children, Care Info and Messages. Do not restore the removed sidebar sign-out/profile footer. Staff navigation retains its capability-based destinations.

- `/vaccination-records` lists only `my_children`; full-access links open the existing child history, next steps and certificates. Restricted children get verification details, without clinical links. Empty families can register/link a child.
- `/appointments` selects a linked child (default first full-access child), reads existing authorized appointments and current-clinic sessions, and reuses `BookVisit` / `AppointmentItem`. Current bookings sort earliest first. Recent completed/missed/cancelled/moved bookings retain the existing RPC's 60-day history window. Switching child uses a GET form; foreign or repeated child selectors are refused before clinical reads.
- `/account` remains the existing profile/language/password/security/contact settings workflow. No duplicate settings store or new authentication flow.

The account language control now explicitly explains that it saves a preference while application text currently remains English. It does not promise an unavailable translation.

No new dependency, API command, database schema or clinical rule. Signup remains automatically confirmed without confirmation mail. Read failures throw to the existing safe recovery boundary instead of presenting false empty states. Booking capacity, duplicate prevention, guardian scope and mutation idempotency remain server/database rules.

## Changed reach

New page modules: `src/app/vaccination-records/page.tsx`, `src/app/appointments/page.tsx`. Root layout adds the family destinations and Settings / Account; it does not add staff-only links to family navigation. Shared visit controls and account commands are reused intact.

Tests: `tests/unit/family-destinations.test.tsx` validates selected-child scope, restricted/foreign access, empty states, data failures and existing record links. `tests/e2e/27-family-destinations.spec.ts` covers new navigation at 390/768/1440px, actual record sections, saved account preferences, booking/rescheduling/cancellation, duplicate refusal and cross-family denial. Existing account/keyboard/dashboard callers now use profile-menu sign-out and the requested settings label.

## Verification

Raw evidence is retained under `tmp/overhaul-2026-10-16/`:

- New orchestration regressions failed before the pages existed, then all 11 passed (`family-destinations-red.log`, `family-destinations-green.log`).
- Initial focused browser run: four passed, five failed. Four password cases loaded the old sidebar sign-out helper; the new-family setup correctly hit the existing privacy gate before acknowledging it. Test callers were corrected without weakening authentication, privacy, capacity or access rules (`destinations-browser.log`).
- Final focused browser run: **8/8 passed** (`destinations-final-browser.log`): four actual password/session/MFA/recovery flows; landing client-navigation equality at 390/1440px; responsive destination navigation, record section links, child switching, account preference save/reload/restore, contact settings, axe/runtime/overflow checks; actual booking, duplicate refusal, foreign-family refusal, rescheduling, keep/cancel and persisted history; new-family empty states, privacy acknowledgment, restricted access and signed-out redirects.
- Keyboard/focus/sign-out and family/staff dashboard regressions passed in the initial focused run. They are separate passing evidence, not a claim that its whole command passed.
- Independent source review found no actionable defect. Independent visual review approved all nine page captures at 390/768/1440px; screenshots retained in `.impeccable/review/family-destinations/`. Root also inspected the real restricted-appointment state.
- Production `npm run build` passed: optimized compilation, TypeScript and static-page generation, including both new dynamic routes (`destinations-build.log`). Used a separate output directory and restored original tsconfig/next-env bytes.
- Final `npm run check` passed: typecheck, lint and **695 unit tests in 102 files** (`destinations-check.log`). Scoped whitespace checks also pass. No outstanding failure remains in the final focused checks.

The landing route/modules, global CSS and public assets retain their original bytes. The shared root layout is intentionally changed by the user's later sidebar requests (including removal of its footer); it is the only difference among the original 43 protected-file hashes. No landing-page content or styling was edited. The actual client-navigation landing equality check passes.

Local synthetic workflows establish the evidence above, not literal 100% correctness or production readiness. Real SMS transport, hosted deployment, human assistive-technology testing and physical devices remain unverified. Application-wide Filipino translations are not available; the saved language preference is explicitly labelled. The database schema/API commands were unchanged, so the prior isolated 449-test database result was not rerun for this navigation/read-model increment.
