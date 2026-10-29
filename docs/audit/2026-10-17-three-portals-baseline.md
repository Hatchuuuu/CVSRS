# Three-portal implementation baseline

17 October 2026. Execution branch: `codex/three-portals` in the existing checkout, retaining the user's current uncommitted application work. A new checkout would omit that work; no reset, stash or destructive operation was used.

The pre-edit SHA-256 inventory is `tmp/three-portals/baseline-hashes.json`; status is `baseline-status.txt`. It covers existing tracked and untracked source, assets, scripts, tests and schema files. Protected comparison uses these bytes, not HEAD. The landing/authentication implementation already differed from HEAD before this work.

Docker responds with server version 29.5.2. Installed Next layout/page guide was read before shared-layout edits. Current local scripts use real Supabase services and a separate E2E app/database, not UI-only mocks.

The first `npm run check` completed typecheck and lint and reported 103 passing unit files plus the seven intentionally failing new parent-task cases created by the parallel implementer while the command was running (698 passed, seven failed). This is overlapping red-test evidence, not a pristine whole-baseline pass. See `tmp/three-portals/baseline-check.log`. A baseline build and new baseline browser capture were not completed before implementation began; final build/browser checks remain mandatory, and protected source hashes establish the byte baseline.

The portal-context tests separately failed on the missing module, then all six passed after implementing it. Evidence: `portal-context-red.log`, `portal-context-green.log`. Portal context is presentation only; active clinic/role/MFA/database checks remain separate.

Implementation ledger: `tmp/three-portals/progress.md`. The completion report must distinguish fresh passing evidence, unverified requirements and any remaining limitations. No historical test count is a substitute for the final verification.
