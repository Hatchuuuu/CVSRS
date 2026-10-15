# Inventory and adjacent control-contract audit

Date: 2026-10-01. Reviewer: ASTRA. Source-level review of inventory, cold chain, stock transfers, downloads and account controls. Other reviewers cover family and remaining clinic workflows. This is a coverage report, not a claim that every application button has passed browser testing. Findings below describe the inspected baseline; coordinating-agent UI changes may resolve them after this snapshot.

## Confirmed findings

| ID | Priority | Control / source | Reproduction and correction |
| --- | --- | --- | --- |
| I1 | P1 | Wastage and physical count, `inventory/page.tsx` | Shared `lotOptions` excludes recalled lots, even though the database permits their wastage/count adjustment. Recall a lot with remaining stock: it cannot be selected for disposal/counting. Split receive options from all inventory-accounting options. |
| I2 | P1 | Cold-chain review, `cold-chain/page.tsx`, `list_temperature` | An unresolved reading older than 14 days remains in the warning count but disappears from the only review list. Include unresolved excursions regardless of history age. Fixed in migration 0032; new regression observes the old reading until another approver reviews it. |
| I3 | P1 | Transfer receive/cancel/resolve, `list_stock_transfers` | The newest-50 limit applies before pending-state selection. More than 50 newer completed transfers hide older pending work. Fixed in migration 0032: all `in_transit`/`received_short` rows plus the newest 50 completed rows per direction. |
| I4 | P2 | Stock subnavigation, `inventory/subnav.tsx` | A nurse permitted to view lots sees Transfers and Cold chain, but both pages reject that role. Pass permissions and hide unavailable destinations. |
| I5 | P2 | Show ledger, `inventory/forms.tsx` | Ledger data is cached indefinitely across stock mutations/router refresh. After an error, successful retry does not clear the error; failure also retains a “Loading…” label. Use explicit loading/error state and re-fetch on reopen or stock change. |
| I6 | P2 | Excursion and transfer decision controls | Database enforces different-person decisions, but UI offers controls to the original recorder/sender. Migration 0032 adds `recordedBy` and `sentBy` for identity-aware explanation/gating; authorization stays in SQL. |
| D1 | P2 | Family Download PDF, `children/[childId]/download-button.tsx` | A failed/offline/unauthorized download only logs to console and resets the button. Expose an alert, retry and bounded wait; preserve actual PDF handling. |
| A1 | P1 | `/account/reset-password` | Page mounts `ResetPasswordForm` in local mode; its effect invokes `browserSupabase()` synchronously outside a try/catch before the promise catch exists. Missing local Supabase config throws. Gate the page as recovery already does and show a demo explanation. |
| A2 | P2 | Supabase signup confirmation, `sign-up/sign-up-form.tsx` | Route can return successful `{message}` without a session; form ignores it and defaults to protected `/children`. Show the confirmation or redirect to sign-in with `notice=check_email`; only follow an account destination when the route supplies one. |
| A3 | P2 | Native-form auth redirects | Absolute redirects derived from reconstructed `req.url` can switch loopback host and lose the newly set host-only cookie. Use relative same-origin 303 destinations, as sign-out now does. |

## Implementation and regression evidence

ASTRA owns `supabase/migrations/0032_pending_inventory_visibility.sql` and `tests/db/pending-inventory.test.ts` only for functional changes. Existing applied migrations were not modified. Migration replacement retains empty search paths, existing capability checks and function grants. It does not change clinical rules, movements or historical records.

The new tests were run before implementation against the unchanged read models: two failed because the old pending records were missing and one authorization regression passed. After migration 0032, the new tests and existing transfers suite passed: **19 tests across 2 files**. The tests use the separate disposable `cvsrs_audit_pending_controls` database on the existing test cluster, not the live demo database/port. No demo lifecycle commands were issued by this reviewer.

The tests cover an unresolved excursion older than 14 days, its removal from old history once reviewed, two old pending transfer states behind 55 closed transfers, the 50-closed-record limit on both source/destination views, actor identifiers and denied unauthorized reads. Historical rows are fixture inserts; ordinary commands still reject backdated entry outside allowed windows.

The running demo needs the normal launcher restart to apply migration 0032. The coordinator owns that lifecycle action and UI adaptation to the new fields. Completed-history pagination remains outside this correction; pending work is preserved independently of the display history cap.

## Contracts inspected without a new confirmed mismatch

- Location/lot creation, stock receipt, wastage, count proposal and reconciliation payload keys align with their API schemas and RPC argument names.
- Transfer send/receive/cancel/shortfall decision payloads align with API schemas; normal capability checks and custody movements remain database-enforced.
- Cold-chain limit, reading and excursion-review request keys align with the API. Review explicitly records a decision and does not itself move or quarantine stock.
- Certificate issue/retry/revoke and download endpoints have their expected command bindings. Download failure feedback is the separate D1 finding.
- MFA setup/challenge/retry handlers are connected, but real Supabase behavior is not tested in a local synthetic-authentication sandbox and cannot be signed off from code alone.

## Remaining evidence limits

This pass is a source/contract audit plus targeted real-PostgreSQL regressions. It does not independently browser-click every inventory, download or real-authentication control. Empty prerequisites, intentional permission denial and external-service requirements should be explained in the UI; they should not be mistaken for proof that an untested operation succeeded. Final coordinating-agent evidence should identify which controls were exercised after corrections.
