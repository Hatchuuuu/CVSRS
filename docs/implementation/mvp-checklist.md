# MVP checklist (reconciled 2026-09-30)

The blueprint's MVP: online staff recording, a simple approved routine schedule, appointments, walk-ins, a daily queue, receipts/certificates, basic inventory receiving/use/wastage/adjustment, core reports, guardians entering a provisional child and reporting outside history, printable outage forms and later-entry reconciliation. **No claim of full offline operation.**

Legend: **Built + tested locally** = database tests and (where noted) browser checks pass. **Needs outside input** = cannot be finished by engineering alone.

| MVP capability | State | Evidence / what is missing |
|---|---|---|
| Accounts, roles, MFA policy | Built + tested locally (DB); Supabase Auth/MFA **unverified** | foundation tests; needs Supabase project |
| Guardian registers child, links, staff verify | Built + tested locally | registry tests, browser |
| Staff registration, duplicates, twins, merge | Built + tested locally | registry/evidence/certificate tests |
| Schedule engine, import/approval/activation | Built + tested locally with **fictional** data | **Needs the clinic's approved schedule** |
| Outside-history report and verification | Built + tested locally | evidence tests; file upload needs Supabase Storage |
| Appointments and capacity | Built + tested locally | visits tests (last-slot race) |
| Walk-ins, ticket queue, waiting display | Built + tested locally | visits tests, browser |
| Vaccination recording, exceptions, corrections | Built + tested locally | administration tests, browser |
| Inventory receive/use/wastage/adjust/recall | Built + tested locally | inventory tests, browser; transfers/temperature are Phase 2 |
| Certificates + public check | Built + tested locally | certificates tests, browser; **needs clinic approval of format/signatory** |
| In-app messages | Built + tested locally | certificates tests, browser; no SMS (Phase 2) |
| Core reports, exports | Built + tested locally | reports tests, browser; **privacy owner sets small-cell threshold** |
| Printable outage forms | Built (paper log, stock log, arrival sheet); print layout not tested on a real printer | `src/app/clinic/[clinicId]/outage-forms` |
| Later-entry reconciliation | Built + tested locally (paper tallies, exception intake) | reports tests |
| Accessibility | Automated scan clean; manual audit **not done** | matrix C-M08-06 |
| Backup/restore | Local drill passes; Supabase restore **not done** | `npm run drill:restore` |
| Performance | Measured locally on 20,000 children | verification.md |
| Security testing | RLS/grant/CSRF/idempotency tests; **no external penetration test** | foundation tests |
| User acceptance | **Not run** | needs real staff and the clinic's schedule |

Exit criteria not yet met: real-schedule clinical approval, Supabase verification, manual accessibility audit, a real-printer check of the outage forms, user acceptance testing. Until they are, treat the system as **release state 1 (local development)**, not a pilot.
