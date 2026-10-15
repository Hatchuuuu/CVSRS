# Family cards and staff accounts — local verification

Date: 15 October 2026. This follow-up covers the approved card-intake and staff-account extension; it does not replace the earlier system audit or attribute the whole existing working-tree diff to this change.

## Delivered workflows

- Parents register without confirmation email, select/register a child, enter up to 20 vaccination-card rows manually or take/upload a photo, review every extracted field, and submit pending evidence. Requested changes can be edited and resubmitted; pending submissions can be withdrawn.
- OCR runs in the browser with locally bundled English assets. Camera and upload controls are separate. Cancellation, a 90-second deadline, oversized/unsupported-image handling and manual fallback are available. Form edits/submission are disabled during scanning so an old scan cannot overwrite edits.
- Clinical staff search the existing clinic registry by child or parent identity, review cards, request changes/reject/approve with a reason, and use the existing governed administration workflows. Approval uses existing validated outside-dose commands atomically; family evidence never becomes clinical history without review.
- BHWs use clinic-scoped registration/intake and follow-up tools, without clinical history, card approval or administration privileges. Assistants, inventory staff, clinical leads and technical administrators keep their existing capability boundaries.
- Staff notes retain original author, role and time; permitted categories depend on capabilities. Optional vaccination-event links distinguish doses. Family-visible notes require the existing full guardian-access checks.
- Administrators create immediately confirmed local staff identities for the six existing roles. Nurse/midwife are clinical-staff job titles. Supplied temporary passwords appear once in the creator's result; later reads cannot retrieve them. Existing independent access approval and MFA remain required before staff records open.
- Child merges preserve cards and immutable note contents. Transfers move actionable cards to the receiving clinic. Child locks serialize submissions/reviews with merge/transfer, avoiding stale routing and opposing lock order.

## Verification evidence

Verified results:

- `npm run check`: typecheck and lint pass; 632 unit tests across 92 files pass (`tmp/card-feature-check-frozen.log`).
- Focused real-role card workflow tests: 8 pass, including merge, transfer, atomic review and an actual competing child-lock refusal (`tmp/card-continuity-lock-focused.log`).
- Complete database suite after migrations 0056/0057: 444 tests in 34 files pass (`tmp/card-feature-db-final-continuity.log`).
- Final install/scanner lifecycle/page-loading checks: 20 tests pass (`tmp/card-final-targeted-unit-host.log`); final lint also passes. A sandbox-only Vitest temp-file read failed, then the same checks passed with normal host access.
- Complete isolated browser suite: 56 journeys pass in 24.2 minutes (`tmp/card-feature-e2e-reviewed.log`), including real OCR draft/edit/request-changes and admin-created clinical-staff account awaiting independent access approval. The browser stack was prepared through 0055; final 0056/0057 continuity is covered by the complete database suite and applied to the normal app database.
- Sequential production build passes (`tmp/card-feature-build-final.log`) after stopping the competing dev server and regenerating only disposable route-type caches. `git diff --check` passes.
- Final standalone typecheck passes. The normal development app was restarted on localhost:3000 with no unapplied migrations; sign-in returns HTTP 200. No normal database reset or existing-record deletion was performed.
- Normal app OCR smoke check: two printed rows extracted, zero external OCR requests, no patient data submitted (`tmp/card-normal-ocr-final.log`).
- Production dependency audit: zero reported vulnerabilities (`tmp/card-production-audit.json`).
- Install SQL generated and verified through migration 0057 (58 migrations); capability matrix has 287 rows. Migrations applied to the normal local database without reset.

The isolated browser suite uses synthetic accounts and a separate Supabase stack. Database tests use a disposable PostgreSQL database. Earlier browser runs retained failure evidence: one crossed midnight with an expired day fixture; another collected old test selectors while fixes were being made. An earlier build collided with the concurrent E2E-generated route types; its failure is not treated as a pass.

## Limits requiring human evidence

Printed synthetic card extraction is verified; real cameras, handwriting, unusual card layouts, screen-reader behavior and clinic acceptance are not certified. OCR can misread fields, so all extracted fields remain unverified until checked against the paper card. Ambiguous dates stay unresolved rather than being guessed. Clinical schedule/product configuration and the appropriateness of staff advice remain the clinic's responsibility.

The earlier development-only `braces` advisory remains unresolved (five affected dependency entries); production audit is clear. Existing local Docker port exposure and real LAN containment have not been newly certified. No firewall changes or clinical-policy sign-off were performed.

Use [the operational walkthrough](../operations/vaccination-card-and-staff-accounts.md) for the local workflows. Start with `npm run dev` and open `http://localhost:3000`.
