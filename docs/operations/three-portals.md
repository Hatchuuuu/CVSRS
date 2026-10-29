# Local portal operation

Use `npm run dev` with Docker Desktop running. It starts the real local services and worker and applies pending forward migrations without resetting data. The default application URL is `http://localhost:3000`. Initial installation/image downloads require a connection; core operation uses the prepared local stack.

## Parents

Open `/children`. The six destinations are My Children, Vaccination records, Appointments, Care Info, Messages and Settings / Account. Register a child or request an existing record through the explicit task links. Accept the clinic privacy notice when requested. Account access is immediate; clinical records remain restricted until staff verify guardian authority in person.

Choose the child on Appointments, book an available session and use the booking row to reschedule or cancel. Paper/walk-in care remains available. Vaccination records opens the existing history, next steps and certificates. Messages is the in-app inbox, not a live-chat service. Contact preferences are in Account. Real SMS delivery is unavailable, so do not rely on it.

## Clinics

Open `/clinic`, select an admitted clinic and complete the existing staff sign-in/MFA requirements. The daily-work group contains the tools each role can use; records/review and management hold less frequent tasks. No navigation choice adds a capability.

For a visit: find/register the child, verify identity/guardian authority as permitted, check in a booked or walk-in arrival, open the current visit, record the care actually delivered, then review the resulting history/next action. Use supported no-dose outcomes when appropriate. Staff must resolve reported doses/card submissions before treating them as verified records. Corrections retain originals and reasons. Inventory expiry/quarantine/cold-chain rules remain enforced.

Clinical leads use the existing staff-access approval page for independent clinical approvals. The creator/requester cannot approve their own grant. BHWs use their authorized registration/follow-up tools and record contact outcomes; their title does not imply nurse/midwife clinical privileges.

## Developers

Open `/developer`, then choose an assigned clinic. Only active technical-administrator membership permits this workspace; MFA and individual command capabilities are checked again. Staff, Clinic settings, Operations and Technical audit are separate destinations.

Create an account using the existing Staff form. Give the temporary password directly to the intended person; it is cleared after success and not displayed in the result. Account creation does not complete role approval. A different authorized approver must approve access; clinical grants require the appropriate clinical approval. The new worker signs in through the existing staff entry and completes MFA. A lost response can be retried with the retained operation key; do not invent a second identity.

The directory includes pending, active, suspended, expired and revoked records. Revocation ends authorization even if an older page remains open. Expiring approval-capable grants show a seven-day warning. No privilege renews automatically; preserve the existing independent-approver path. Owner-only recovery remains a controlled CLI operation described in the main runbook.

Nurse/midwife grants require a different clinical approver. Non-clinical BHW, registration, inventory and technical grants require a different access administrator. The first bootstrap pair contains one technical administrator and one clinical lead; it does not automatically provide two technical approvers. To establish another technical administrator without self-approval, the intended second administrator first creates their own account through the existing account flow, the clinical lead uses Staff access → Request access for a person to request `Technical administrator`, and the original technical administrator approves it. The second administrator then signs in through the staff entry and completes MFA. That independent administrator can approve non-clinical accounts created by the original developer.

Operations displays real queued/failed jobs and recorded backup/restore evidence. Refresh status to reread it. A recorded pass is not a live-health guarantee. Run `npm run drill:restore` / `npm run drill:upgrade` through their guarded disposable databases, then record the result and evidence. The console cannot run shell commands, view secrets, reset databases, impersonate users or browse patient records.

Technical audit includes only allowlisted staff-access, clinic-configuration and operations events. It does not grant the general clinical audit capability or expose raw audit payloads. Technical administrators operate only their assigned clinics.

Legacy `/clinic/[clinicId]/admin` routes remain usable: technical-only users arrive at the console; clinical leads retain the approval workspace. Landing, sign-in and create-account source/behavior were intentionally outside this implementation's change boundary.

## Synthetic walkthrough

1. A synthetic parent uses the unchanged signup, opens My Children and completes Register, including clinic privacy acknowledgement. The record shows pending clinic verification.
2. A technical administrator creates a synthetic nurse, midwife or BHW account in Developer Console. Another authorized person approves the requested scope. The worker completes the existing staff sign-in/MFA flow.
3. A permitted registration/clinical worker verifies the synthetic guardian. The parent can view the child's authorized next steps and book an opened session.
4. The clinic checks in the booked or walk-in visit, records an appropriate synthetic vaccination against usable stock and finishes the visit. The parent sees persisted history and an in-app update from the local worker.
5. A BHW records an authorized follow-up contact. The developer checks operations/audit without opening patient clinical information.

Use only approved clinical configuration for real care. Demonstration schedules and records are synthetic test data, not medical guidance.

## Local verification

Run `npm run check`, `npm run test:db`, `npm run matrix:check` and `npm run build` for the source, database contracts and production compilation. Run `npm run test:e2e` for real browser journeys. The browser runner resets only its isolated synthetic stack on database port 55322 and serves the test application on port 3100; it does not reset the normal development database.

The isolated browser server uses Next's supported Webpack development mode. The default full suite runs in ordered phases of at most six test files, restarting only its own server between phases to release compiler memory. The isolated database, journey state and secrets survive those restarts. Before interactions it compiles the current phase's recorded route-handler modules through anonymous automatic `OPTIONS` and all page modules through anonymous `GET` without following redirects; empty auth probes must fail validation. Unknown test selections use the complete API warmup. Update the recorded lists when an existing test adds an API route; these lists affect compilation preparation only, not which tests execute or which permissions apply. Warmed entries are retained for one hour within the isolated process so a route cannot expire during the measured warmup. This is not a memory limit; server recycling remains necessary. Startup can take several minutes. Reports and aggregate counts are saved under `tmp/three-portals/phases-*`; HTML reports never keep the runner open. The first failure stops dependent work and fails the command. Explicit Playwright arguments run as one selection. Application timeouts and staff approval/MFA requirements remain in force.

Use `npm run drill:restore` and `npm run drill:upgrade` for the guarded disposable recovery checks. Keep current results with the [implementation evidence report](../audit/2026-10-17-three-portals-completion.md); a command that has not finished successfully is not a passing release gate.
