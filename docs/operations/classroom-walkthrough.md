# Classroom walkthrough: normal local application

For the new family card, OCR, staff notes and account-management workflow, follow [Vaccination cards and staff accounts](vaccination-card-and-staff-accounts.md).

Use **http://localhost:3000** with the normal local Supabase database and saved accounts. This replaces the separate presentation launcher. At the user's request, seven accounts have clearly labelled example profiles and the Family account has Luis Reyes (Example), born 2024-06-15, record CV-000001. The patient/guardian review remains pending; no vaccination history or clinical rules were invented. Earlier isolated rehearsal passes are historical evidence, not a completed vaccination workflow on this normal clinic.

## Start and account details

Start Docker Desktop and wait for `docker info` to succeed. From the project folder run `npm run dev` and keep its terminal open. Confirm http://localhost:3000/api/v1/health/ready returns HTTP 200. Startup applies only missing migrations, preserves records and runs the message worker. Ctrl+C stops the app; restart with `npm run dev`. `npm run dev:stop` stops the main Supabase stack while keeping its data. Do not reset the database to prepare a presentation.

Family entry: http://localhost:3000/sign-in. Staff entry: http://localhost:3000/evactrackstafflogin. Signup grants immediate access without confirmation email; clinic approval and staff MFA remain required. Password-recovery mail goes to http://127.0.0.1:54324.

Actual private account details are in ignored `.local/local-login-credentials.json`. All seven accounts are provisioned on the normal local stack; six staff accounts have verified MFA. Keep this file, passwords and authenticator codes off the projector. Import each staff account's saved `totpSecret` into its owner's authenticator using manual setup, then enter that authenticator's six-digit code when signing in. These are the actual normal accounts, independent of automated-test identities. Separate browser profiles keep role sessions independent; ordinary tabs in one profile share sign-in.

## All existing roles

| Role | Walkthrough responsibility |
|---|---|
| Parent or guardian | Register/link their child, book visits, read verified history/certificates/messages |
| Registration assistant | Search/register, confirm identity, verify guardians, create sessions and manage arrivals/queue |
| Nurse / clinical staff | Review and sign vaccination recording, submit evidence and corrections |
| Clinical lead | Approve clinical rules/data and clinical access, review exceptions/corrections, issue certificates and run reports |
| Inventory clerk | Configure locations/lots, receive/count stock, record wastage and manage custody |
| Barangay health worker | Review follow-up and record contact attempts within assigned access |
| Technical administrator (developer) | Configure clinic/master data, manage applications/access; no clinical-record access |

“Developer” means the existing Technical administrator role, not a new permission. Keep the separate people required for two-person approvals.

## Configure the clinic

1. Preserve existing organization/staff records. On a genuinely empty setup only, the first Technical administrator and Clinical lead sign up, then follow [README first-staff setup](../../README.md#getting-to-first-use-in-this-order). Do not bootstrap again when staff already exist.
2. Additional staff sign up at `/evactrackstafflogin/create-account` and apply to the clinic for their role. For Nurse/Clinical Staff, the Technical administrator accepts and the Clinical lead approves. For Assistant, Inventory and Health worker, the Clinical lead accepts and the Technical administrator approves. The two people remain separate, and the applicant cannot approve their own access. Confirm active membership and MFA for every staff account.
3. As Technical administrator, configure **Settings** (contact/hours/time zone), publish the clinic's approved privacy notice under **Clinical setup**, and draft antigens/products. The Clinical lead activates master data.
4. Import the clinic's actual approved schedule using [schedule import](schedule-import.md), including its draft tests, submission and separate approval/activation. Without approved rules, calculated dates and schedule-driven follow-up remain unavailable. Keep automated-test fixtures out of this database.
5. As Inventory clerk, add a location, register the actual product lot and receive stock in its configured stock unit. The Clinical lead supplies applicable cold-chain limits. Confirm usable stock before recording.
6. As Registration assistant, create an open session for the clinic's current local date with capacity. Publish approved care information through its review process. Questions remain disabled until the Clinical lead supplies the approved safety notice and enables them.

Accounts alone do not complete these prerequisites. Use the [role guides](training.md), [runbook](runbook.md) and [external requirements](../implementation/external-validation.md) when configuration is missing.

## Existing workflow

1. **Family:** show the public clinic listing and sign in. Register their child or request a link to an existing record; accept the selected clinic's notice. Reload to confirm persistence. Clinical history waits for guardian verification.
2. **Assistant:** search first to avoid duplicates, confirm identity and verify the guardian with appropriate evidence. Refresh family access. Confirm today's session and booking capacity.
3. **Family and assistant:** book an available time, check in, call and start service. Show the ticket-only display and refresh the family's queue status; the public display must not expose the child's identity.
4. **Inventory clerk and nurse:** show usable stock. During the active visit the nurse selects the actual product/lot/location, reviews the child and dose, signs recording and finishes with the correct outcome. Reload history/stock to confirm the signed event and corresponding stock-unit change. Record only care that actually occurred; do not invent a clinical event for the walkthrough.
5. **Clinical lead and family:** prepare/download the certificate, open its printed validity address while signed out and confirm it reveals no personal details. Refresh family history/certificates/messages after worker delivery. Review evidence/corrections when applicable.
6. **Lead and Technical administrator:** show reports/CSV/audit; then clinic settings, master-data lifecycle, staff applications/approvals and active access. Confirm the administrator cannot read clinical records.
7. **Barangay health worker:** refresh follow-up, record an appropriate contact attempt and reload. If no record is eligible, show that empty state honestly rather than creating false clinical/contact history.
8. **Other existing controls:** show outside-dose evidence, correction review, catch-up plans, stock counts/cold-chain review and same-organization transfers when prerequisites exist. Actions persist; safe confirmations/cancellation can demonstrate controls without inventing events. Open the nurse's printable outage forms and explain paper reconciliation.

## Acceptance before presenting

- [ ] Normal readiness is HTTP 200; all intended accounts have correct active memberships, staff MFA and independent browser sessions.
- [ ] Clinic notice, approved master data/schedule, usable stock and today's session exist for the chosen workflow.
- [ ] Intended actions persist after reload; authorized roles complete them and unauthorized roles are refused.
- [ ] Applicable booking/queue/recording/certificate/messages/report/follow-up steps have been checked on this database without fabricated events.
- [ ] Laptop/narrow layouts, keyboard focus/confirmations, 200% zoom and the intended screen reader have been checked.
- [ ] Ordinary restart preserves records and returns readiness 200; credentials stay private.

Run `npm run check`, `npm run test:db` and `npm run test:e2e` for regression checks. They use disposable data and do not provision or certify this normal clinic. Port 3100 and `.local/e2e` belong to automated testing. Stop only identified task-owned processes when a test port is occupied. Stop the main development app before `npm run build`, then restart with `npm run dev`.
