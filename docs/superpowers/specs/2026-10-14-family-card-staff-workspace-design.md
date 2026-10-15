# Family Vaccination Card Intake and Staff Clinical Workspace

## Goal

Give families a clear local workflow to register, enter, or photograph a vaccination card, while giving clinic staff role-appropriate tools to find families and children, review submitted card details, record administered vaccines, and attach traceable plain-language notes.

## Scope and non-goals

This is an extension of the existing CVSRS workflows. It does not replace guardian verification, clinic membership approval, MFA, the approved clinic schedule, stock controls, signed administration records, or the existing audit model. It does not diagnose symptoms, infer a vaccine from an image, silently approve OCR, or send card images to an external OCR service. It does not introduce email confirmation; new accounts remain immediately usable after registration.

## User journeys

### Family

1. A family member creates an account from the public landing page and signs in.
2. From My Children, they select an existing child or register a child, then choose Vaccination card.
3. They choose Manual entry or Take a photo / Upload an image.
4. Manual entry uses the existing child-record form patterns. Photo intake uses the browser camera/file picker and local OCR. The image stays in browser memory; submission sends reviewed text only. OCR assets load from the local application.
5. Every extracted field is explicitly unverified and editable. Missing or ambiguous dates require attention. The family confirms that all rows match the paper card before submission; image-average confidence is not presented as field accuracy.
6. Submission creates a pending card-review item. It never changes approved clinical history directly.
7. The family sees pending, needs changes, approved, or rejected status and the staff response. Approved information appears only under the existing guardian and clinic-access rules.

### Clinic staff

All staff enter through the existing clinic workspace and only see clinics where their active membership and MFA permit access.

| Role | Search families/children | Review family card submissions | Record administered vaccine | Add care/follow-up note | Approve clinical result |
|---|---:|---:|---:|---:|---:|
| Clinical lead | Yes | Yes | Yes | Yes | Yes, subject to existing independent review |
| Clinical staff / nurse | Yes | Yes | Yes | Yes | Existing clinical approval rules |
| Barangay health worker | Yes | Limited intake/follow-up fields | No | Yes | No |
| Assistant | Yes | Intake support only | No | Limited operational note | No |
| Inventory | Inventory workflows only | No | No | No | No |
| Technical administrator | Administration and access only | No clinical records | No | No | No |

The patient search returns parent/guardian identity, child identity, record number, verification status, and clinic relationship. It does not expose another clinic's records. Opening a child shows existing history plus pending card submissions, administered events, evidence, and notes according to capability.

### Administrator account management

The clinic administrator console gets a dedicated Staff accounts section. An authorized access administrator can enter a staff member's name, email, role, and optional barangay/assignment details, then create the local account and clinic membership from the console. The account is immediately confirmed in accordance with the local no-confirmation-email policy, and the administrator receives the one-time credentials to hand to the staff member through the clinic's existing secure process. The staff member must complete MFA before clinic records open and can change the temporary password from Account security.

Creating an account does not let one administrator bypass separation of duties. Non-clinical roles can follow the existing access approval path; clinical roles (clinical staff/nurse/midwife and clinical lead) become pending until the required independent clinical approver accepts them. An administrator cannot approve their own request, create a technical administrator without the existing high-trust capability, or grant arbitrary capabilities. Existing staff applications remain supported, and duplicate email, duplicate live membership, invalid role, suspended profile, and cross-clinic assignment are rejected with an actionable message.

The existing Staff access section shows role and membership status, supports revoking access with a reason, and retains the audit trail. The creation form displays the supplied temporary password once; it cannot resend or retrieve it later. Existing account recovery remains separate. Role labels use the configured vocabulary: clinical staff (nurse or midwife), registration assistant, barangay health worker, inventory clerk, clinical lead, and technical administrator.

Clinical staff record vaccine/product, dose, administration date/time, lot, route/site when required by the current command contract, and an optional plain-language observation. The existing stock, correction, exception, two-person approval, and immutable-record rules remain authoritative. A note such as “This symptom is normal after this vaccine” is stored as a staff-authored observation with author, role, timestamp, child, and visit/event link; it is not presented as a diagnosis or automatic medical advice.

## Architecture

Use existing children, administration, review-case, message, membership, capability, and audit boundaries. Add a dedicated pending card-submission entity rather than writing OCR output into vaccination events. The submission stores normalized fields, review status, submitter, clinic/child relationship and manual/OCR provenance. The raw image stays client-side; server image retention is outside this implementation.

Add server commands/RPCs for creating a pending submission, listing/searching permitted submissions, requesting changes, approving or rejecting a submission, creating scoped staff notes, provisioning a confirmed local staff identity, creating its clinic membership, listing staff account status, and suspending/revoking access. Account provisioning must use the same password policy and Auth trigger/profile bootstrap as normal signup, with no password or MFA secret returned from later reads. All mutations use the existing request validation, idempotency, same-origin, capability, RLS, and audit patterns. Approval converts only reviewed fields through the existing clinical-record command; it cannot bypass product/lot validation or stock requirements.

The browser-only scanner runs the bundled OCR engine and parses printed vaccine labels into editable candidates. It supports cancellation, a 90-second deadline, image type/size limits and manual fallback. It does not claim handwriting recognition, automatic orientation repair or calibrated field confidence. The feature is useful without OCR.

## UX and accessibility

Family and staff surfaces use the existing operational design system and responsive layouts. The photo flow has explicit camera/upload permissions, progress, cancel, retry, and a clear “check against the paper card” step. Every input has a label and error association. Review tables work by keyboard and on a 320px viewport. No clinical status depends on color alone. Reduced motion disables nonessential OCR progress animation.

## Failure and privacy behavior

- Unsupported or oversized images remain local and show a manual-entry recovery.
- OCR timeout or low confidence never blocks manual entry and never auto-submits.
- Duplicate card lines are surfaced for review instead of merged silently.
- A parent can withdraw a pending submission before staff review using the existing mutation confirmation pattern.
- Staff searches are clinic-scoped, rate-limited, audited, and do not reveal hidden records through empty-state differences.
- Rejected or changed submissions preserve the submitted values and decision reason in the audit trail.

## Verification

The implementation is complete only when these local checks pass:

- Family registration, child selection, manual card entry, photo/upload permission handling, local OCR, review correction, and pending status.
- Staff search and capability matrix for clinical lead, nurse/clinical staff, barangay health worker, assistant, inventory, and technical administrator.
- Review/approve/reject/request-changes flows with tenant isolation, MFA, idempotency, audit records, and no direct clinical write from family input.
- Administrator account creation for every configured role, immediate confirmation without email, independent clinical approval, MFA gating, duplicate/cross-clinic rejection, suspension/revocation, and audit history; no password or secret leakage after creation.
- Administered vaccine recording continues to validate schedule/product/lot/stock and preserves existing correction and two-person approval tests.
- Notes are visible only to authorized family/staff surfaces and remain linked to the correct child/visit.
- Keyboard, screen-reader markup, responsive 320/768/1440 layouts, reduced motion, image size/type limits, and no-network OCR behavior.
- Typecheck, lint, unit tests, database role/RLS tests, build, and isolated end-to-end tests on the local stack.

“Ready for local use” means these defined flows pass against the local database and browser. Clinical policy, approved schedules/products, real hardware camera quality, and clinic acceptance still require human sign-off.
