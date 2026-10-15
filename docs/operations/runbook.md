# Operations runbook

For the person who runs CVSRS for a clinic. Nothing here has been exercised against a production or Supabase deployment; commands marked *local* work on the project-local PostgreSQL only.

## Daily
| When | What | Where |
|---|---|---|
| Start of clinic day | Create today's session (capacity for bookings and walk-ins) | Today → Create session |
| During the day | Check in, call, start service; nurses record vaccinations | Today, child page |
| End of day | Review queue → clear open cases; Reports → Needs attention should be near zero | Review queue, Reports |
| End of day | Count doses in the paper log for the day (if a paper log is kept) and enter the tally | Reports → Paper log check |
| Weekly | Stock count against the shelf; investigate any "Agrees: No" line | Vaccine stock, Reports → Stock summary |

## The background worker
Messages to families (booking, cancellation, vaccination recorded, certificate ready/revoked) are queued in the database and delivered by a worker.
- In development, `npm run dev` runs the worker in-process every 10 s with a least-privilege local login. Production web processes (`npm start`) never poll; run `npm run worker` separately with `CVSRS_WORKER_DB_URL`.
- Serverless hosting: run `npm run worker -- --once` from a scheduler every minute, or run `npm run worker` as its own process.
- The worker connection must be a database role allowed to execute `private.process_outbox`. Never give it to the browser-facing key.
- Health: Reports → Needs attention → "Messages that failed" should stay at 0. A failed job has an error code in `private.outbox_jobs.last_error_code`.

## Backup and restore
Take a backup at least daily and before every upgrade. Certificates and audit records live in the database, so a database backup covers them.
- *Local* drill: `npm run drill:restore` dumps a database, restores it into a fresh one and verifies row counts, stock ledger = projection, certificate hashes and document checksums, guard triggers, RLS and API-role privileges. Run it after every migration change. Expected result: `RESTORE DRILL PASSED`.
- On Supabase use the project's backups/point-in-time recovery and repeat the same verification queries (see `scripts/backup-drill.ts`) against the restored copy **before** sending users to it. This has not been done yet.
- After restoring, revocations and corrections made after the backup point must be re-applied by hand: compare with the audit log of the original if it survives.
- Recovery time measured locally on a 1 MB test database: about 1 s. That says nothing about a real database.

## Release
1. `npm run test:all` and `npx next build` pass.
2. Apply new files in `supabase/migrations` in order. Never edit an applied migration.
3. Run the restore drill against a copy of production data.
4. Deploy; check sign-in, a child search, a booking and a report.

## Incidents
| Situation | Action |
|---|---|
| Wrong child's vaccination recorded | Nurse requests a correction (child page → history → Request a correction); a different clinical lead approves. Never edit stock by hand. |
| Certificate issued in error | Clinical lead revokes it (child page → Certificates); issue a replacement if needed. The family is notified. |
| Stock does not match the shelf | Vaccine stock → count → propose adjustment; inventory approver decides. Reports → Stock summary shows whether ledger and shelf count disagree. |
| A staff member leaves | Staff access → revoke the membership. Their past records and audit stay. If the revoke is refused with "Revoking this access would leave this health center without two different people who can request and approve …", the person is one of the last two who can grant that kind of access: request and approve their replacement first, then revoke. |
| A second health center opens in the same organization | Database operator: `select private.add_clinic('<organization uuid>', '<clinic name>', 'Asia/Manila', '<reason, 10+ characters>');` (owner only; names are unique per organization; audited with the database login). The new center has no staff: its first technical administrator and clinical lead each create an automatically confirmed account without a confirmation email, then the operator runs `private.restore_clinic_approver('<new clinic uuid>', '<email>', 'tech_admin', '<reason>')` and the same with `'clinical_lead'`. After that, everyone else joins through applications and two-person approval as usual. Record transfers and stock transfers between the two centers become available. |
| A sole approver must lose access **now** (left without notice, account compromised) and the revoke is refused | Database operator, on a trusted workstation with the owner connection: `select private.set_profile_status('<profile uuid>', 'suspended', '<reason>');` — the account keeps signing in but holds no capability at any clinic from its next request. If the clinic can then no longer approve access, restore one approver with `select private.restore_clinic_approver('<clinic uuid>', '<confirmed email>', 'clinical_lead' or 'tech_admin', '<reason, 10+ characters>');`. It works only while the clinic cannot approve through the app (it never bypasses a working two-person path), needs a confirmed email, and writes an audit row naming the database login. Afterwards the clinic revokes the suspended person's memberships through the app as usual. |
| Suspected data exposure | Stop the service, keep the database and logs, tell the privacy officer. Audit trail records identifiable reads and exports. |
| System unavailable | Use the paper log (printed forms), then enter later and reconcile with Reports → Paper log check. Do not issue certificates on paper from memory. |

## Configuration switches (database `private.settings`)
| Key | Meaning | Default |
|---|---|---|
| `require_staff_mfa` | Staff capabilities need a two-step session | true |
| `report_small_cell_threshold` | Exports withhold counts between 1 and threshold−1 (0 = off). **The privacy owner must choose the value.** | 0 |
| `expiry_last_day_usable` | A lot is usable through its expiry date | true (needs cold-chain lead approval) |
| `adjustment_auto_approve_units` | Count differences up to this size skip approval | 0 |
