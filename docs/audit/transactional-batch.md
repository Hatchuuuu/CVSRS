# Transactional hardening task briefs

Parent plan: [master-plan.md](master-plan.md). Status: PLANNED. Execute only after an implementation slot is available. Use forward migration `0026_transactional_integrity.sql`; coordinate test database names with the lead. Preserve prior migration files and user changes.

## E05 — inventory repair versus ledger posting

Objective: no successful repair may write a ledger total older than a concurrent committed movement. Inspect every inventory/transfer/administration path and its lock order before choosing the serialization point. A possible design is a shared organization-scoped transaction advisory lock for posting commands before any balance lock, and an exclusive lock for reconciliation before its ledger snapshot. Do not upgrade shared locks in concurrent repair commands: obtain the exclusive lock first. Ensure count/adjustment paths, transfers crossing clinics, clinical issues and first postings are covered. A balance-only row lock cannot protect missing projection rows.

Acceptance: deterministic two-connection contention regression; balances match ledger after both transactions commit; concurrent repairs do not deadlock; grants and nonnegative stock remain enforced. Tests: inventory/transfer/administration suite and command sweep. Report any administrative direct-write assumptions.

## E06 — render-generation binding

Objective: stale concurrent renderers cannot issue a PDF containing a superseded verification token. Lock pending certificate during begin; return a generation/token hash; require storage to prove the current generation. Old unbound storage signatures must not remain callable by authenticated users. Update service and tests, including wrong-generation rejection, retry after unknown response, direct RPC grants and public token verification. Do not store plaintext tokens in receipts/audit. Replaying the same store must still succeed without accepting a stale new store.

E13 separate trust issue: generation binding alone cannot prove PDF bytes match snapshot. Do not claim it does. Record the remaining boundary and choose a trusted renderer design separately.

## E07 — report access and suppression

Objective: every direct public report read with `p_export=true` writes an export audit transactionally; the HTTP route cannot be the only audit boundary. Inspect every report, including stock and paper reports and the lower-capability paper read. Avoid requiring `report.run` for an allowed vaccination staff on-screen paper view. For paper exports enforce the export capability and configured small-cell policy. If either count is withheld, also withhold difference and comparison status, and avoid disclosing exact unresolved totals derived from suppressed rows. Free-text paper notes are a privacy issue: exclude them from exports if they can contain patient details. Audit all rows without leaking their contents. Test direct RPC, low-capability export denial, count/difference/status/null metadata suppression and normal authorized on-screen values.

## E11 — stale SMS worker completion

Objective: a worker holding an expired claim cannot finalize a newer attempt. `claim_sms` already returns `attempt`; add a mandatory expected-attempt/generation to completion, revoke/drop the old unbound private completion entry point, and update dispatcher/tests. Require `sending` and current claim match; return whether applied so worker counters cannot report stale writes as delivered. Provider idempotency stays keyed by message ID. Test lease expiry, reclaim, stale success and stale retry, current success, consent withdrawal and callback order. This does not verify a real SMS provider.

## Review and evidence

Implementer documents red → green reproduction, full affected suite results, lock-order decisions, upgrade behavior and discoveries in `transactional-implementation.md`. Independent reviewer rejects unsupported concurrency claims, retained bypass signatures, stale replay defects, introduced lock inversions or suppression inference leaks. Root runs full-system checks after edits settle.
