# Transactional hardening implementation evidence

2026-09-30. Scope: E05, E07, E11 from [transactional-batch.md](transactional-batch.md). Changes are uncommitted on the shared audit branch. This records local PostgreSQL integration evidence, not Supabase staging or provider evidence.

## E05 — inventory repair

Root cause: `reconcile_stock(..., true)` read ledger totals, then overwrote balance rows without a lock shared with normal postings. A posting on the same organization could commit between snapshot and repair; first postings also lack an existing balance row to lock.

Forward migration 0026 takes a transaction-scoped organization advisory lock. Inventory commands take a shared lock in `private.inventory_org` before balance locks; `private.post_movement` covers clinical issues and corrections that call the primitive directly; the ledger trigger covers administrative direct inserts. Repair takes the exclusive lock before its ledger snapshot, without first taking a shared lock. Transfer commands resolve the organization through `inventory_org` before transfer or balance row locks. Different organizations remain independent. Administrative direct updates to `stock_balances` can still corrupt the projection and are outside the public command contract; repair exists to recover from that drift.

The new two-connection tests hold an uncommitted posting while repair waits, then verify the repaired balance and ledger are both 13 after commit. Another two-connection test runs two repairs and verifies both finish and balance equals ledger. The affected inventory, transfer, and administration suites pass. The migration preserves the existing public RPC signatures and grants.

## E07 — report exports and paper suppression

Root cause: the CSV route audited separately before invoking a report RPC, so direct RPC export reads had no audit record. Paper export cells could withhold counts while returning their difference, comparison status, and unresolved total. Staff free-text notes could appear in the paper CSV.

All four date-range report RPCs now write `report.exported` in the same transaction as the export read, including the stock report. The route calls the report RPC once and no longer writes a duplicate preliminary audit. Its request limit uses the shared production limiter with a normalized route key. The paper RPC keeps its authorized clinical on-screen view; export requires `report.run`. When a paper or system count is withheld, its difference and status are null, and the export's unresolved aggregate is null if any row is suppressed. Paper export payloads omit the free-text `note`; the on-screen view retains it. The direct RPC tests verify four audit events, export denial for clinical-only staff, and paper suppression of counts, difference, status, unresolved, and notes. The existing independent `record_report_export` RPC remains for compatibility; it is no longer used by this route.

Configured small-cell suppression is policy dependent. A privacy owner still needs to approve the rule and inference risk across date ranges and overlapping report requests before production.

## E11 — SMS attempt and lease completion

Root cause: a worker could complete a message after its lease expired and another worker reclaimed it. The old `mark_sms` returned no applied status, so dispatch counters could report a stale write as sent.

Migration 0026 drops the old five-argument function and creates an attempt-bound completion that returns a boolean. It accepts only the current `sending` attempt with a nonnull, unexpired lease. The dispatcher passes the claim's attempt and increments sent/retry/failed only when completion returns true. Provider idempotency remains keyed by message ID. Tests cover the removed signature, private grant, expiry and reclaim, stale success and retry, null attempt and lease, current completion, and a stale provider response that leaves the dispatch counters at zero. Existing callback and consent tests continue to pass. No real SMS provider was contacted.

## Validation and limits

Before the dispatcher/test fixes, the focused suite failed on the retained old function call and a reclaim fixture using a guardian who had opted out. The final run used `CVSRS_TEST_DB_NAME=cvsrs_audit_ledger` and passed 87/87 tests across `inventory`, `record-transfer`, `administration`, `reports`, `sms`, and `sms-dispatch`. Before this destructive test setup, `show data_directory` on port 54329 returned `C:/Users/Nitro/Desktop/CVSRS/.local/pgdata`, matching the project-local disposable cluster. The reset script's own server-identity guard remains E14 work.

Targeted ESLint on the changed TypeScript files and `npm run typecheck` pass after concurrent auth cleanup edits settled. Full-suite and staging validation remain with the lead after all shared edits settle.
