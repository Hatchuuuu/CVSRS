# CVSRS local verification — 2026-10-14

Snapshot note: the user subsequently requested normal-app accounts instead of the separate presentation launcher. That launcher is now removed. See [the current normal-account and flow audit](2026-10-14-normal-accounts-and-flow.md) for populated profiles/patient, account counts, current commands and regression results. The runtime counts, demo instructions and scores below describe this earlier snapshot.

Status: **ready for a controlled local classroom presentation; one manual acceptance check remains**. This supersedes the stopped-engine state in [the 2026-10-13 report](2026-10-13-local-verification.md), which retains the original discovery, issue register and scoring criteria. The application is running at `http://localhost:3000`; today's isolated prepared demo is running at `http://localhost:3100`.

Docker was recovered by preserving its IPC-only socket directories, then performing the explicitly approved Docker-only WSL restart after MySQL stopped cleanly. No volumes or databases were deleted. Both main local startup and the isolated test server reached readiness HTTP 200. Main Supabase has all 48 migrations through 0047, 18 PASS / 2 INFO schema/security checks, immediate signup enabled, the same two active staff, zero children/doses/stock transactions, and no duplicate stock reversals.

## Additional fixes

- Migration 0047 corrects repeated vaccination lot corrections and voids: reverse the currently outstanding stock issue, rather than reversing the original issue twice. All three new chain tests failed before correction; the focused 90-test suite passed afterward. Historical bad ledger entries are not automatically rewritten; the main database has no stock transactions to repair.
- Merge confirmation uses the existing focus helper: opening focuses the safe cancellation button and cancellation returns to the exact selected keep-record trigger. Both unit regressions failed before the change; actual browser checks for both choices also pass.
- Requirements matrix check now compares the generated artifact and rejects stale/missing Markdown without writing it; CRLF remains accepted. Four tests passed, including two reproduced failures before the fix.
- An existing reattribution test swallowed an incorrect assertion. It now checks actual validation, unchanged facts after refusal, and a legitimate remap without stock changes; no assertion failures are swallowed.
- The inactive search change unintentionally altered existing active/provisional label capitalization. The previous browser run caught this; established wording was restored without changing its assertions. Two added label regressions and nine focused tests pass.
- Final module review found that transfer quantities were labelled as vials for every product. The send form now says stock units, and each lot option shows its actual unit. A rendered-page regression using doses failed before the correction and passes afterward. The original single-clinic browser attempt could not expose the send form; a later guarded cross-clinic fixture now verifies the actual form and complete transfer workflow with doses.

## Current evidence

Finite backend module/caller review is complete: all 145 route files (141 API / four auth), 167 exported HTTP handlers, 158 shared API-wrapped handlers, nine custom handlers, and 168 allowlisted RPCs were inventoried. Three shared handlers explicitly permit public access; the other 155 require a session. Every allowlisted RPC has a latest SQL definition and a source caller/reference; 220 literal calls cover 163 names, and the report catalog/contact helper resolve the other five. Static argument-key comparisons found no unknown named arguments. All RPC names occur in the 30 database test files. This establishes module/caller/reference coverage, not every branch or a guarantee against undiscovered defects.

The complementary [frontend/source coverage](2026-10-14-frontend-module-coverage.md) and [backend/shared-library coverage](2026-10-14-backend-module-coverage.md) account for every one of the 331 current TypeScript/TSX source modules. They record named imports/callers, 136 frontend modules with reviewed contract families, all 48 backend/shared library responsibilities and callers, and 122 frontend request sites with endpoint/method/payload checks. Root also source-reviewed the framework proxy and Node worker instrumentation; the dynamic worker import is included. An independent reviewer reconciled all current source paths against both artifacts with none missing. This closes the original finite module/caller coverage criterion without inferring exhaustive branch coverage.

| Check | Result |
|---|---|
| `npm run check` | Final check after transfer-unit correction: types/lint; 593 unit tests / 81 files pass |
| `npm run test:db` | 427 tests / 30 files pass |
| `npm run build` | Initial concurrent dev/build encountered malformed generated route types; server stopped and only generated dev types cleared/regenerated; final production build after the transfer-unit correction passes; main app restarted |
| `npm run drill:upgrade` | Populated 0030→0047 upgrade passes; disposable database removed |
| `npm run drill:restore` | 69 tables / 11,989 rows, 22 certificates and 2,439 audit rows verified; no problems |
| Installation SQL / matrix | 48 migrations current; 287 requirement rows match generated artifact |
| Main Supabase | Read-only verification: 18 PASS / 2 INFO; migrations current; account confirmation mail disabled; stored counts unchanged |
| Actual browser zoom | Six public/auth pages at real Chromium tab zoom 200%: API factor 2, viewport 1280→640, DPR 1→2; no overflow or automated A/AA violations |
| Complete browser suite | 42 journeys pass (14.8 minutes); eight separately gated demo-rehearsal tests skipped by design and will run using `demo:rehearse` |
| Today's demo preparation | 24 real-Auth setup journeys pass (5.4 minutes); fictional clinic/schedule/roles/stock/session/certificate prepared on the isolated stack |
| Today's professor rehearsal | All eight steps pass (1.3 minutes): fresh registration→verification→booking/arrival→signed dose/stock→PDF/public validity/messages→reports/admin→follow-up/outage forms |
| Opened-state keyboard/axe test | Pass: nested family menu/sign-out Escape recovery, skip link, opened registration/correction forms, clinic menu, inactive/stock repair safe confirmations, both merge choices and required evidence; inactive search→reactivation persists after reload |
| Authenticated actual 200% zoom | Four family and six clinical-lead pages pass: real zoom factor 2, CSS viewport 640/DPR 2, no overflow or automated A/AA violations; viewport screenshots reviewed |
| Browser accessibility tree | Eight real Chromium AX states pass: sign-in labels, simulated network failure with assertive alert/retry, family children/history/messages, expanded family/staff navigation and safe stock confirmation; no unnamed exposed controls, consequence description and keyboard/focus recovery verified |
| Demo restart persistence | Pass: identical five-child/two-event/three-movement counts and certificate/balance hashes before/after ordinary restart; no reset |
| Cross-clinic stock browser audit | Pass on a labelled synthetic dose-unit lot: receive 10, send/receive 4, send/cancel 2; final source 6 / destination 4 / transit 0. Prior child/certificate/balance data unchanged; fixture clinic closed and added membership revoked afterward, with history retained |
| Post-transfer restart persistence | Pass after ordinary demo restart: five children / two events / 12 stock movements and identical certificate/balance hashes; original main counts and immediate signup separately reverified |
| Final runtime | Main and demo readiness both HTTP 200; sockets bind only ::1; main record counts unchanged |

Actual zoom uses Chromium's tab zoom API in an isolated audit browser profile, not CSS zoom or viewport-only emulation. The API is documented by [Chrome for Developers](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom).

For a clean build, stop the main development app before compiling; keep source and database data intact. An interrupted or concurrent generator can leave invalid files under `.next/dev/types`; these are rebuildable framework artifacts, not application source. The initial failed build remains in the evidence log.

The app deliberately forces light mode. No dark-mode pass, manual screen-reader pass, real camera acceptance, public deployment or medical-policy approval is claimed.

## Final readiness assessment

**CVSRS Local-Use and Presentation Readiness: 97%.** The original equal-credit criterion ledger remains in force; unavailable evidence has not been treated as passing. The finite full source module/caller coverage review is complete and independently reconciled. End-to-end, local-service and presentation criteria have evidence.

| Category | Weight | Verified / eligible | Score | Contribution |
|---|---:|---:|---:|---:|
| Feature functionality and workflows | 25% | 10 / 10 | 100% | 25 |
| Backend, APIs, database and integrity | 20% | 5 / 5 | 100% | 20 |
| Architecture and code quality | 15% | 5 / 5 | 100% | 15 |
| UI/UX, responsiveness and interactions | 15% | 4 / 5 | 80% | 12 |
| Security, validation and reliability | 10% | 5 / 5 | 100% | 10 |
| Testing, builds and regression | 10% | 5 / 5 | 100% | 10 |
| Local setup and presentation | 5% | 5 / 5 | 100% | 5 |
| **Total** | **100%** | | | **97** |

The single OPEN criterion is the complete keyboard/zoom/assistive-technology walkthrough: keyboard, opened-state semantics, zoom and automated accessibility are verified, but actual screen-reader speech has not been observed. A human result was requested; no screen-reader pass is inferred from axe or DOM tests. This prevents a justified 100% under the original checklist. These are evidence-completion scores, not a promise of zero bugs or exhaustive branch coverage.

## Remaining manual check and limitations

Use Windows Narrator or the intended screen reader on the prepared demo. Verify sign-in field names/errors, family child/history/messages, staff navigation, safe confirmations, result announcements and restored focus using Tab/Enter/Escape. Report the reader used and any issue found. Keep private credentials and MFA codes off the projector. Until an observed result is supplied, this remains unverified.

The user's follow-up authorized further testing but supplied no observed screen-reader result. The additional Chromium accessibility-tree audit passed eight states without modifying records or exposing input values. It checked the actual browser AX tree, including assertive live-region semantics and cancellation descriptions, rather than inferring names solely from HTML. Evidence is in ignored `.local/audit-2026-10-14-accessibility-tree.log` and `.json`; the assert-based audit script is retained alongside them. Native computer control and screen-reader audio observation are unavailable in this session, so these checks cannot establish Narrator speech or close the human acceptance criterion.

Real camera acceptance, hosted services, clinical policy approval and physical printer testing are not claimed. The supported typed QR fallback is available; local class presentation uses fictional records and rules. The app's light-only decision is preserved. No public deployment, new major feature, confirmation email or main-database reset was added.

Full-page screenshots at real tab zoom cropped their captures despite correct layout metrics; final review used viewport captures, checked that the viewport remained unchanged, and inspected actual readable output. This was an audit capture artifact, not an application layout defect.

## Changes, cleanup and preservation

The additional owned changes are migration 0047, chained-correction/reattribution regressions, shared merge confirmation focus and its regressions, matrix drift checking and four tests, restored search labels and two regressions, the new opened-state browser test, and corrected stock-transfer unit wording with a rendered-page regression. Migrations 0045/0046 and their original fixes remain verified. Generated install SQL reflects all 48 migrations. No old migration, dependency, user artifact, asset, credential file or unrelated modification was removed; no commit/push was performed.

Docker's socket-directory backups are retained in the same Local AppData parent folders under names containing `cvsrs-audit`. Only IPC directories whose contents were checked as zero-byte sockets were moved. MySQL/phpMyAdmin were confirmed running after the approved engine restart. Main stored data was rechecked separately from synthetic E2E/demo data.

The additional cross-clinic test uses only guarded local ports 55322/3100. Its destination clinic/product/lot are labelled `Audit Synthetic` / `AUDIT-DOSES`; fixture setup supplies a second-clinic inventory membership without claiming to test staff onboarding. Actual stock operations use the signed-in browser and authenticated API. Initial audit-helper assumptions failed at the legitimate multi-clinic chooser, then the same fixture was reused with explicit clinic selection. Cleanup first used an unsupported clinic status and rolled back completely; the verified schema-supported `closed` status then succeeded. No records were deleted. The transfer evidence is in `.local/audit-2026-10-14-cross-clinic-stock-retry.log`; the post-transfer snapshot is `.local/demo-transfer-restart-snapshot.json`. The earlier three-movement snapshot remains historical evidence, not the current state.

Initial failures remain disclosed: sandbox temporary/socket access failures, the omitted stock-case guard caught by full DB tests and restored, the search-label case regression caught by browser tests and restored, and the malformed generated dev types fixed before the final build. No test was weakened or suppressed to obtain a pass.

## Laptop setup and presentation procedure

Follow the [README first-use instructions](../../README.md) for the normal local database and [professor-demo guide](../operations/professor-demo.md) for synthetic presentation. Current prerequisites are Node >=22/npm, running Docker Desktop Linux engine and installed dependencies/Chromium. `npm run dev` configures and migrates the main stack without resetting records; it does not need the retired `CVSRS_LOCAL_DB_URL` environment setting.

Today's demo is already prepared and running. Open `http://localhost:3100`; family entry is `/sign-in`, staff entry is `/evactrackstafflogin`. Private synthetic credentials are in ignored `.local/e2e/demo-accounts.json`; run `npm run demo:code` in a separate off-projector terminal for MFA. The rehearsal added its own Mika child/dose/certificate/contact attempt, and the keyboard check added two clearly synthetic records. The later stock audit added a dose-unit product/lot and two completed transfer histories, with the temporary destination clinic closed and its added access revoked. These are intentional test evidence, not patient data.

For another presentation day: Ctrl+C in the demo terminal, `npm run demo:prepare`, `npm run demo`, then `npm run demo:rehearse`. Normal restart is `npm run demo` and preserves the data; preparation explicitly resets only the isolated stack. Full E2E testing changes this same synthetic state, so prepare again afterward. Stop only identified task-owned servers if a port is occupied.

Before showing the laptop: confirm readiness 200, keep passwords/MFA off the projector, use separate role browser profiles, show the verified eight-step workflow, and explain that schedules are clinic-approved and the demonstration is fictional. Do not describe local verification as clinical or public-production certification.

Optional future work is separate: search pagination if filters become insufficient, validated external transport/hosting, broader real-device/accessibility acceptance. No such major feature was implemented.

## Conclusion

The stopped-engine blocker is resolved. Automated local regression and the full classroom rehearsal are passing, and restart preserves the prepared records. **Ready for a controlled classroom presentation with the documented manual screen-reader limitation; 97% verified criterion completion.** The final manual check must pass before claiming the requested 100%.
