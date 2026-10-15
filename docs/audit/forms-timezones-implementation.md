# E12 — optional fields and clinic timezones

2026-09-30. Local implementation review and verification.

## Behavior

- Staff identity correction and guardian edit requests distinguish an omitted optional field from an explicit clear. The shared patch schema accepts `null` for optional identity fields while registration remains non-nullable. The staff form sends `null` when an existing address is emptied or the birth date is deliberately marked unknown; the guardian form offers explicit clear controls. The database merges the patch by key, so omission preserves the stored value and `null` clears it. The existing registry DB regression confirms address and birth-date clearing after a real RPC call.
- Migration `0029_clinic_timezones.sql` supplies the clinic IANA timezone in staff context, guardian child metadata, guardian appointments, and record-transfer history. Appointments take the timezone from their booked session's clinic, so an appointment at another clinic does not inherit the child's current clinic zone. The existing appointment read window remains 60 days; this change does not expand appointment history.
- Staff context includes only an active profile, and exposes active memberships only while `valid_from <= now()` and `valid_until` is absent or in the future, at an active clinic. Pending approval memberships remain visible for their pending state at active clinics. The server clinic guard additionally requires an active membership and checks expiry; database capability checks remain authoritative.
- Shared formatting treats calendar dates as dates and timestamp values as instants in a specified clinic timezone. The clinic's current date supplies report defaults, and clinic-local date boundaries supply audit search filters. Appointment/session clocks and timestamp labels on the affected clinic and guardian views use the relevant clinic timezone.

## Verification

- `CVSRS_TEST_DB_NAME=cvsrs_audit_timezone3 npx vitest run --config vitest.db.config.ts tests/db/config.test.ts tests/db/registry.test.ts tests/db/visits.test.ts tests/db/record-transfer.test.ts`: 4 files, 94 tests passed. The test setup rebuilt only this named disposable database after checking the connected server's data directory against `.local/pgdata`.
- `npx vitest run tests/unit/clinic-timezone.test.ts tests/unit/child-patch.test.ts`: 2 files, 5 tests passed. These cover omitted versus explicit `null`, required-field refusal, UTC-midnight clinic dates, a daylight-saving boundary, and different clinic renderings of the same instant.
- `npm run typecheck`: passed for application and tools TypeScript projects.

## Remaining validation boundary

This is local PostgreSQL and code-level evidence. Live Supabase/Auth behavior and browser checks for form affordances, mobile layout, and visible time labels remain within release gates G01 and G04. The database read model uses a clinic's current timezone for earlier appointments; a future clinic timezone change can therefore change how an older instant is rendered. A historical timezone snapshot would need a separate data-model decision if that history must be immutable.
