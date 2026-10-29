# Staff child record redesign

17 October 2026. User requested a professional rearrangement of the staff child record, preserving functional workflows and role boundaries.

## Layout and flow

- Neutral patient identity header, readable record number and status; remove the redundant “Child medical profile” eyebrow. Keep this header in normal flow so section anchors cannot disappear beneath it. The existing vaccine-signing confirmation still names the child and record number.
- Registration guidance remains prominent when verification is outstanding. Record actions and guardians appear before clinical sections and staff notes, rather than below the notes form.
- Section links follow the page's order and point only to sections available to the current role. Clinical tools, vaccination history, visits, holds, catch-up plans, evidence, certificates and transfers retain their original capability checks and components.
- Explain guardian-verification permission beside the guardian list for roles that cannot approve it. Do not add a verification button or grant permissions to a barangay health worker.
- Place staff notes after the working clinical sections; make the observation field full-width, with type/related-vaccination controls above it.
- Put identity corrections behind a native, keyboard-operable “Edit identity details” disclosure with a chevron. Preserve version checks, validation, reason, audit and success/error feedback. Existing callers/tests open the disclosure before editing.
- Remove the empty clinical-history placeholder for nonclinical roles. No hidden clinical data or new read is introduced.

## Files

- `src/app/clinic/[clinicId]/children/[childId]/page.tsx`: reorder existing sections, role-aware anchor navigation and correction disclosure.
- `src/app/clinic/[clinicId]/children/[childId]/notes.tsx`: full-width observation field; unchanged note command and validation.
- `src/components/ui.tsx`: quiet ChildBanner styling and removal of its eyebrow; staff child record is its only caller.
- `tests/unit/staff-record-layout.test.tsx`: order, section-link targets, restricted roles and clinical/guardian controls.
- `tests/e2e/28-staff-record-layout.spec.ts`: synthetic identity/guardian/correction/QR/notes lifecycle and responsive role checks.
- `tests/e2e/07-records.spec.ts`: open the identity correction disclosure before the existing edit workflow.

No database/API/authentication, landing, asset or dependency changes. Existing real records and role assignments were not changed.

## Evidence

- New layout tests failed before implementation and passed afterward; a visual-review navigation-order finding also received a failing regression before correction.
- First complete `npm run check`: typecheck/lint and 698 unit tests in 103 files passed (`staff-record-check.log`). Final check follows the finish corrections below.
- `19-vaccination-care.spec.ts` and both new staff-record scenarios: **3/3 passed** (`staff-record-browser.log`). This exercises actual signed vaccine recording, care instructions visible to family, BHW follow-up, identity confirmation, unauthorized guardian-approval refusal, identity/name/address correction with reload, QR confirmation/cancellation/issuance/resolution, note save and visibility, authorized nurse guardian approval and the parent's resulting access.
- BHW, nurse and lead pages passed axe, document-overflow and section-anchor visibility checks at 390/768/1440px. The notes field occupies at least 90% of its section width at tablet/desktop sizes; no runtime page errors were recorded.
- Independent source review found no actionable regression. Independent visual review inspected all nine role/size captures; finish corrections remove the duplicated divider and align shortcut order with the body. Final confirmation and build results follow when complete.

Raw evidence: `tmp/overhaul-2026-10-16/staff-record-*`. Screenshots retained in `.impeccable/review/staff-record/` after final confirmation.

These are local synthetic checks, not literal proof of 100% correctness. Hosted integrations, physical devices and human assistive-technology/clinical acceptance remain unverified. The SQL schema/commands were unchanged; the prior isolated database suite was not repeated for layout-only changes.
