# Role guides

Short task guides for the people who use CVSRS. Clinical decisions always stay with clinic staff: the system shows what the clinic's approved schedule says and never decides for the nurse.

## Parent or guardian
1. Sign up and sign in. **My children** → Add your child (name and birth date), or ask to link a child the clinic already knows.
2. The clinic must verify you in person (bring an ID). Until then you see only the child's name.
3. **Next steps** shows what your clinic's schedule says. **Clinic visits** lets you book, cancel or move a visit. **Your place today** shows your ticket.
4. Vaccinated somewhere else? Use *Tell the clinic about a vaccination given elsewhere*. It only counts after staff check it.
5. **Certificates** lists what the clinic issued. Download the PDF. Anyone can scan its QR code to check it is valid; the check shows no personal details.
6. **Messages** lists updates about visits and certificates.

## Registration assistant
Find or register a child (search first to avoid duplicates) → confirm identity in person → verify the guardian (ID) → manage Today: create sessions, check people in, call the next child, mark priority with a reason. You cannot record vaccinations or see clinical history.

## Nurse / clinical staff
Open the child from Today when the visit has started. Check the name and record number, choose the lot and where it came from, **Review before signing**, then sign. Care already given elsewhere or before the system was available goes through *Record care already given*. To fix a mistake use *Request a correction*; you cannot approve your own.

## Clinical lead
- Approve or reject corrections, exceptions and stock adjustments (Review queue).
- Import, review and activate the clinic's vaccination schedule (`docs/operations/schedule-import.md`); approve staff who handle clinical care (Staff access).
- Issue, replace and revoke certificates; run Reports.

## Inventory clerk
Vaccine stock: add locations, register lots, receive stock, record wastage, count. Quarantine or recall a lot when told to; a recalled lot cannot be used. Lot trace lists which children received a lot (restricted and audited).

## Technical administrator
Add antigens and products (a clinical lead activates them), request staff access (someone else approves), never see clinical records.

## What to do when something looks wrong
Do not work around it. Tell the clinical lead; use corrections and adjustments, which keep the original entry and the reason.
