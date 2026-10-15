# Final stabilization change review — 2026-10-14

Independent review of the current stabilization batch, preserving the pre-existing dirty tree. No outstanding actionable findings after the two corrections below.

## Reviewed scope

- Local web environment overrides, Supabase CLI output filtering/capture, and UTC first-staff setup.
- Guardian merge replacement (0048), null-safe correction lot comparison (0049), and their callers, schema constraints, and existing function grants.
- Service tab scrolling, landing/reduced-motion changes, textarea error descriptions, and the display board's stable announcement regions.

## Findings resolved

1. **CLI capture default buffer:** capturing inherited output introduced Node's default 1 MiB limit. A synthetic 2 MiB child reproduced `ENOBUFS`. The corrected helper explicitly allows 16 MiB and raises a credential-free `SetupError` on process errors. Its regression test exercises an actual 2 MiB Node child.
2. **Tab scroll still animated:** `behavior: "auto"` followed the root's smooth-scroll CSS, and focus could scroll implicitly. The corrected component uses `focus({ preventScroll: true })` and `scrollIntoView({ behavior: "instant", ... })`; the focused test asserts both calls.

## Verification

Reviewer reran `node node_modules/vitest/vitest.mjs run tests/unit/local-cli.test.ts tests/unit/service-explorer-motion.test.ts`: **2 files, 5 tests passed**.

SQL `CREATE OR REPLACE` updates existing signatures and preserves their earlier grants. Active guardian relationships are constrained to verified full access, and the merge checks match the existing expiry-based access contract. No additional actionable findings were identified in these changes.

## Limits

### Subsequent hydration review

The final full browser run exposed a separate pre-hydration auth failure. The coordinator reproduced enabled SSR controls and a native GET, then gated family/staff sign-in and account-creation inputs/submits with disabled fieldsets until the existing `useSyncExternalStore` hydration signal is ready. Independent source review found no actionable issue: native disabled inheritance, labels, nested staff application grouping, links and narrow layout are preserved. Five focused files / **78 tests passed** using workspace-local temporary files after sandbox SSR cache errors. The coordinator separately reran the failed responsive journey and the no-JavaScript regression successfully. No credential handler, privilege or email policy changed.

CLI capture remains bounded at 16 MiB; streaming redaction is the documented upgrade if actual output exceeds that limit. A cold image pull was not reproduced. The reviewer could not launch Chromium from the sandbox's browser cache; browser verification and full unit/database/build/E2E/drill evidence remain the coordinator's separate checks.
