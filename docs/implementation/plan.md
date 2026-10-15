# Implementation Plan

Milestones follow blueprint delivery order. Each exit needs real evidence recorded in `verification.md` and matrix rows updated via `npm run matrix`.

| ID | Deliverable | Depends on | Exit evidence |
|---|---|---|---|
| M00 | Traceability, plan, baseline | – | ✔ done |
| M01 | Auth/access foundation | M00 | ✔ local DB + unit tests; Supabase items blocked_external |
| M02 | Registry, family access, QR | M01 | ✔ core; leftovers listed in status.md |
| M03 | Clinical master data, rule approval, evidence, revisions, evaluation engine | M02 | Fixture-driven engine tests (leap days, months, dependencies, combination credits); unverified evidence grants no credit; rules cannot activate in non-demo mode without approval |
| M04 | Lot inventory ledger | M03 (products) | Ledger rebuild = projection; unit conversion; quarantine/recall blocks; concurrency on last dose |
| M05 | Sessions, booking, walk-in queue, encounters | M02, M03 | T02 last-slot race; ticket allocation atomic; sanitized public display |
| M06 | Atomic administration, corrections, exception intake | M03–M05 | T03–T08, T13–T16 (applicable); no partial saves; idempotency |
| M07 | Guardian records, in-app messages, private certificates | M06 | End-to-end care journey; PDF snapshot/hash; revocation; T23/T24 |
| M08 | Reports, paper reconciliation, a11y, backup/restore drill, MVP UAT | M06–M07 | Performance runs; restore evidence; keyboard/screen-reader pass |
| M09 | Catch-up review, inventory intelligence/temperature/transfers, SMS adapter, staffed check-ins | M08 | Sandbox provider contract tests; supervised exception tests |
| M10 | Controlled offline (packs, encrypted pending recovery, allocations, sync, conflicts) | M09 | Real browser offline/restart tests; T17–T21, T28 |
| M11 | BHW, transfers, growth, languages, coverage | M10 | Scoped BHW tests; transfer failure tests |
| M12 | Campaigns, nutrition, exchange, hardware | M11 | Contract tests; live evidence only where partners/devices exist |
| M13 | Hardening & handoff | all | Clean-environment run, full matrix review, security/a11y/perf/recovery results |

Cross-cutting: every milestone updates DB tests, the matrix, and `known-limitations.md`; security and accessibility checks are not deferred.
