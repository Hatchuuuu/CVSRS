# Setup and final-change review — 2026-10-14

**Coordinator follow-up:** the E2E inherited-credential gap described below is now fixed by shared empty overrides, which also prevent Next dotenv injection. CLI credential logging is filtered, capture explicitly allows 16 MiB, and process errors fail safely. A real 2 MiB child-output regression, credential/log assertions and the full static/unit checks pass. The [independent final review](2026-10-14-final-change-review.md) records closure; uncached image pulls remain untested.

This review used the current working tree. Earlier audit reports were context, not fresh evidence. Existing uncommitted and untracked work was preserved. No development database was reset, service was restarted, real account was changed, or credential was printed by this reviewer.

## Confirmed setup defects repaired

1. **Local certificate links inherited a hosted origin.** `scripts/dev.ts` and `scripts/e2e.ts` copied the shell environment and let Next load root development env files; `src/lib/certificates/service.ts:10` honors `CVSRS_PUBLIC_URL` even in development. A focused call to the real `publicBase` with development mode, an HTTPS hosted origin and a localhost request returned the hosted origin. Both runners now spread the shared `localWebEnvironment` helper, which explicitly sets that variable to the empty string. Next preserves process-environment values ahead of env files; the empty value chooses the existing request-origin fallback. Setting an HTTP localhost value would fail the existing HTTPS-only validator, so that alternative was rejected. Hosted `dev:next` behavior is preserved.
2. **The first-staff CLI rejected UTC.** `scripts/setup-first-staff.ts:30` treated the canonical list returned by `Intl.supportedValuesOf("timeZone")` as exhaustive. It omits UTC even though `Intl.DateTimeFormat` accepts it and PostgreSQL's timezone catalog supports it. The guard now explicitly accepts UTC in addition to the existing list. CLI regression checks run with `--hosted` and a deliberately empty owner connection, proving UTC reaches the required-connection check and an invalid zone is rejected before any connection.

Both changes were preceded by failing regression checks. The first local environment regression briefly appeared in the parent's concurrent baseline; that was the intentional new red test, not evidence of a pre-existing suite failure.

## Fresh focused verification

- `npx vitest run tests/unit/local-stack.test.ts tests/unit/setup-first-staff.test.ts`: 2 files, 8 tests passed.
- ESLint on the six touched setup/test files: exit 0.
- Real `publicBase` assertions after applying `localWebEnvironment`: localhost ports 3000 and 3100 retain their respective request origins despite a hosted inherited value.
- Install SQL generator `--check` passed at the then-current 48-migration state. The parent subsequently regenerated the package for 50 migrations; the parent owns final package and whole-project verification.
- Semantic artifact: `graphify-out/.graphify_semantic.json`, 12 nodes and 10 explicit EXTRACTED edges from the certificate-font README, license and app SVG. Assertions verified unique IDs, referenced node IDs, source-file existence and edge provenance. Token counters are zero, not estimates.

## Final SQL and frontend change review

`0049` was compared programmatically with `0047`: after removing comments, the complete function body differs only by replacing `<> cur.lot_id` with `is distinct from cur.lot_id`. Existing authorization, row locking, proposer separation, stale-revision checks, transactional stock issue/reversal, revision insertion, schedule recalculation, audit and idempotency behavior remain. CREATE OR REPLACE preserves existing grants; neither reviewed migration adds grants.

`0048` retains merge authorization and idempotency, stable child-row locking, enrollment behavior, QR revocation and audit. A currently active, unexpired duplicate relationship can replace a provisional or expired survivor relationship, retaining the verified row and evidence. A suspended survivor is never replaced. Guardian merge regressions cover provisional, suspended, active and expired combinations. The null-lot correction tests cover recording product/lot, one stock issue, and rejecting an unknown replacement lot; existing administration tests additionally cover stock exhaustion rollback, proposer refusal, stale requests and chained reversals. These were inspected; the parent runs the final real-database suite.

The check-in, privacy-notice and content textareas associate rendered validation errors with their inputs; content keeps its explanatory hint. DisplayBoard keeps its calling live region mounted when empty and excludes the polling timestamp from announcements, with a separate stable connection-status region. ServiceExplorer retains arrow/Home/End behavior, roving tab stops and tab/panel labels while selecting without scroll animation. CSS removes repeated explanatory entrance delays. No actionable regression was found in these reviewed changes.

## Coverage and limitations

Read setup/dev/E2E/local-stack/DB/install/worker/restore/upgrade/performance scripts; package/config/CI/env/gitignore; README and deployment/runbook procedures. Checked the installed Next environment-variable and distDir guides. Destructive DB tooling validates the actual project cluster data directory; E2E reset also requires its dedicated database port. Redis request limiting returns through the in-memory path outside production, so inherited Redis settings do not contact the production store in these local runners.

One remaining defense gap is explicit: `scripts/e2e.ts` still forwards privileged inherited shell variables and permits Next env files to add them, whereas `scripts/dev.ts` strips/refuses service-role, owner and webhook credentials. No browser disclosure or remote write was demonstrated, and the inspected browser tests do not call the SMS webhook. Aligning that E2E environment policy with the normal local launcher would enforce the documented least-privilege web boundary.

This reviewer did not repeat the parent's typecheck/build/database/browser/restore runs, deploy to a hosted project, test real SMS delivery, or perform human assistive-technology evaluation. Static review and focused regressions do not establish those outcomes.
