# Scheduling integrity implementation (E02–E04)

2026-09-30. Scope: `0025_scheduling_integrity.sql`, scheduling/registry/transfer/schedule/administration DB regressions, and a disposable test database override. No source UI or clinical policy changed; no user data was reset.

## Root causes and resulting behavior

- `book_appointment` accepted a verified guardian for any clinic session without checking that child's destination enrollment. The wrapper now requires an enrollment at that clinic and shares a child row lock with transfer acceptance and rescheduling.
- `check_in` accepted a confirmed booking after its session was cancelled. Appointment arrivals now lock and inspect the session status before the original command. The same-key replay returns its prior receipt even if the session was cancelled later.
- Two walk-ins read the same remaining allocation before either took the ticket-counter lock. A clinic/date transaction advisory lock now covers the capacity read and queue insertion. A forced two-connection test holds the counter row until both arrivals have reached a lock; only one gets the last unapproved slot.
- Merge previously left confirmed appointments and active tickets on the duplicate child. Merge now moves usable bookings and live tickets to the survivor, cancels same-session confirmed collisions with an audit event, and refuses ambiguous active ticket collisions or open encounters. Queue transitions share the child lock so a service start cannot interleave with the merge's open-encounter check.
- Transfer acceptance could close the old enrollment and finish cancelling appointments before a guardian's already-authorized booking inserted a new old-clinic appointment. Booking, reschedule, check-in, merge and transfer acceptance take child locks before their scheduling mutations. The forced transfer test holds a session row while both operations interleave, then verifies there is no confirmed old-clinic booking after acceptance.
- Evaluation included verified doses dated after `as_of` and active holds regardless of their effective interval. The schedule engine and child inputs now filter on evaluation date, and planned-dose checks use the proposed administration date. Engine version `plpgsql-2` separates new persisted evaluations from prior snapshots. A separate regression found that future evaluation could switch the child's current program; program assignment now changes only on the child's clinic-local current date.

No same-day cross-session booking rule or medical schedule values were added.

## Red and green evidence

Before implementation, focused runs showed the destination guardian booking and cancelled-session arrival tests both fail because the commands succeeded. Two merge tests showed that a usable booking stayed on the duplicate and an active ticket collision merged without a conflict. A future-dose test showed a future dose credited to A1. The current-program test showed a future evaluation replaced the present active program. The historical hold test's first red run was blocked by a fixture activation conflict; it passed after fixture isolation and the SQL fix, so it is not claimed as an observed behavioral red. The deterministic walk-in, transfer, backdated-dose, collision-audit and replay tests were added during implementation and passed against the final migration; they were not separately run red against the original SQL.

Validation used `CVSRS_TEST_DB_NAME=cvsrs_audit_schedule`. The modified test harness retains `cvsrs_test` as default and the existing `reset` guard accepts only disposable `cvsrs_*` names. The final five-file run passed 125/125 tests, and `npm run typecheck` passed. The lead owns the full DB suite and integration gates.

## Review focus and limits

The forward migration preserves original command bodies as restricted `*_prev` functions and keeps public signatures, idempotency receipts, command audits, grants and RLS boundaries. Review the child-then-session lock order against all writers, including queue transitions, cancellation and transfer. Collision cancellation currently withdraws a queued confirmation and records an audit event; a delivered confirmation cannot be retracted. Historical appointments and completed queue entries remain on the alias child to preserve history. A hold without a placing clinic uses UTC for interpreting its effective date; new command-created holds carry the placing clinic's timezone. Local PostgreSQL tests do not establish production Supabase/Auth behavior or clinical schedule approval.

Independent GPT-6 SOL review remains required before this task is marked verified.
