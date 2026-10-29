# Vaccination cards and staff accounts — local use

Start Docker Desktop, then run `npm install` and `npm run dev` from the project directory. Installation prepares the OCR worker, WebAssembly engine and English language model under ignored `public/ocr/`. Runtime scanning uses only the local app; it does not send card photos to an external OCR service. If assets need rebuilding, run `npm run ocr:prepare`.

Local policy update, 15 October 2026: at the owner's request, this machine's existing database setting `require_staff_mfa` is now `false`. Staff use email/password without a six-digit challenge; role, membership and clinic-access checks remain enforced. This persists across normal restarts. Fresh installations and other deployments retain the default MFA policy. The two-step instructions below apply when that policy is enabled.

Signed-in navigation uses one left sidebar on desktop. Staff see their current clinic, role and authorized clinic tools; parents see their family links. Messages, Account and Sign out are in the same sidebar. On tablets and phones, open Menu to access these destinations; Escape closes it and returns focus. The current destination is highlighted. Public pages retain their public navigation when signed out.

Staff accounts sign in only at `/evactrackstafflogin`; family accounts sign in at `/sign-in`. The server checks stored memberships and staff applications before committing session cookies. Pending, suspended and previously admitted staff remain staff accounts; this classification never grants clinic permissions. Account type cannot be changed through an editable profile field or a browser selector.

## Families

Create an account from the landing page. Signup gives immediate access without confirmation email. Register a child under My Children, then open the child's record and its Vaccination card section. You can submit a card while guardian verification is pending; clinic-reviewed history and notes remain protected until guardian verification.

Child registration also accepts optional sex for clinical reference and home-address details: province, city/municipality, barangay, house/street/sitio/purok and postal code. Unknown details may remain blank. The address is saved as one full-address field and appears on the authorized clinic child record; later corrections use the existing address edit/request workflow.

Enter card rows manually, choose Take photo on a supported camera device, or Upload image. Images are limited to 8 MB and a submission to 20 entries. Scanning fills an editable draft. All rows remain visible; checking the paper card is required before submission. The image itself stays in the browser and is not persisted by CVSRS.

OCR is fallible, especially for handwriting, poor lighting and unfamiliar card layouts. It recognizes common printed vaccine labels. It preserves uncertain day/month dates for manual correction rather than guessing. Use manual entry whenever a row is missing or unclear. Scan one part at a time if a card contains more than 20 rows.

Submission status appears under Submitted cards. Pending entries do not count as approved vaccinations. If staff request changes, choose Edit requested changes, correct the rows and confirm the card again. Pending or returned submissions can be withdrawn after confirmation. Clinical decisions preserve the original submission and its audit history.

## Nurses and clinical leads

See [Record a vaccination and share care details](record-vaccination-and-care.md) for the nurse-to-family vaccine, medicine and aftercare workflow.

Use the staff sign-in address `/evactrackstafflogin` and complete two-step sign-in. In Find or register, search a parent name, child name or record number; registration-authorized staff may also search a contact. Open the matching child record. Family vaccination cards shows all submitted entries and review status.

Request corrections or reject with a note for the family. To confirm a card, check documentary evidence, map every row to an approved product and supply its exact administration date. Approval writes historical evidence through the existing clinical command; it does not deduct clinic stock for a vaccine administered elsewhere. New clinic administrations still use the existing visit, lot, stock, consent and correction workflows.

Staff notes allows authorized observations, intake and follow-up notes. Choose whether a note is visible to the family. Clinical observations are restricted to clinical staff. Notes are append-only and include author and time; corrections should be entered as a further note. Family-visible notes appear only to verified guardians.

## Barangay health workers and other roles

| Role | Available work |
|---|---|
| Barangay health worker | Follow-up dashboard, parent/child search, non-clinical registration details, intake and follow-up notes |
| Registration assistant | Search/register, identity and guardian review, visits/queue, intake and operational notes |
| Nurse or midwife | Clinical staff permissions: patient records, card evidence review, vaccine administration and clinical notes |
| Clinical lead | Clinical staff work plus governed clinical approvals, certificates and approved reports |
| Inventory clerk | Stock, locations, counts, transfers and cold chain |
| Technical administrator | Staff accounts/access and clinic configuration; no clinical record access unless separately approved for a clinical duty |

Nurse and midwife are job titles under the existing Clinical staff authorization role. Job titles do not grant extra capabilities. BHWs cannot open vaccination history, approve cards or record administered vaccines.

## Administrator console

Open Admin console → Create staff account. Enter the person's full name, email, clinic role, optional job title and a temporary password of at least 12 characters. You may also enter an assigned barangay and city/municipality; enter both or leave both blank. Creation uses local immediate signup and files/accepts the application into the existing pending membership workflow. No confirmation email is sent.

In Staff access, each staff member's saved work location appears below their name and role, for example `Bunao, Dumaguete City`. Missing locations say `Work location not assigned`. Access administrators can choose Add assignment or Edit assignment, save both fields, or clear both to remove the assignment. The location belongs to that clinic membership; it does not change role permissions or represent a home address. Clinical approvers without access-administrator permission can read the assignment but cannot edit it. Saves are version-checked and audited.

Give the displayed credentials directly to the staff member. The password is displayed from that submission only and disappears on navigation; later account reads cannot reveal it or an MFA secret. Access requests wait for a different authorized approver. Clinical access requires a clinical approver. After approval, the staff member signs in, sets up two-step sign-in and changes their temporary password from Account.

Existing accounts should be assigned through Staff access rather than recreated. Duplicate email and unauthorized creation are refused. A retry with the same operation and details resumes the creation; it does not create another identity or membership. Staff access contains the existing revoke controls and requires a reason. Every creation and membership decision is audited.

## Verification commands

```sh
npm run check
npm run test:db
npm run test:e2e
npm run build
npm run db:install-sql -- --check
```

Run the production build after the browser suite finishes; both Next processes generate route type files. Automated E2E uses the separate disposable Supabase stack and synthetic accounts. Do not reset the normal database to rehearse these flows. Clinical schedule/product configuration and a clinic's acceptance of handwritten card extraction still require real evidence and human review.
