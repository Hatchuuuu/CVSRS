# Backend review, 2026-10-14

This review used current source and a freshly rebuilt disposable database (`cvsrs_audit_backend`), not previous audit conclusions. It found and fixed two existing-feature defects. It does not claim exhaustive manual review of every SQL function or route body.

## Confirmed defects and fixes

1. **Verified guardian access was discarded by a record merge.** `supabase/migrations/0003_registry.sql:755` implements `merge_children_prev`, called by the current merge wrapper in `0034_integrity_performance.sql:322`. When the survivor already had a provisional relationship for the same guardian, the duplicate's active verified relationship was revoked. The survivor retained identity-only access. An expired active relationship on the survivor caused the same loss. Regression tests reproduced both failures. Migration `0048_guardian_merge_integrity.sql` retains the current verified relationship row and its verification evidence, revokes the provisional/expired collision, and moves the verified row to the survivor. It preserves intentional suspension on the survivor, keeps an existing current verified relationship, and does not promote an expired duplicate relationship.

2. **Identifying an unknown vaccination lot silently did nothing.** `supabase/migrations/0047_chained_correction_stock.sql:31` used `new_lot <> cur.lot_id`; SQL evaluates this as NULL when the existing lot is unknown. A supported `clinic_exception` record could therefore have a correction approved and revision incremented while the requested lot/product remained NULL and no stock issue occurred. A nonexistent proposed lot was also silently approved. A rollback-only SQL reproduction returned `{approved:true,stock:[],lotStillNull:true,revision:2}`. Dedicated regressions then reproduced the valid-lot and unknown-lot failures. Migration `0049_correction_unknown_lot.sql:33` uses `IS DISTINCT FROM`, preserving the full latest command, atomic stock handling, validation, two-person approval, and existing grants.

## Verification

- Initial guardian regression: 1 failed / 3 passed, reproducing loss of the verified relationship.
- Extended pre-fix regression run: 3 failed / 4 passed, reproducing expired survivor loss and both unknown-lot correction cases.
- Final focused run: **94 tests passed across 5 files** (`guardian-merge-integrity`, `correction-null-lot`, `registry`, `integrity-0034`, `administration`). Tests run as real database API roles with JWT claims, using the existing fixture helpers.
- Confirmations remain disabled in `supabase/config.toml`; signup code still requests an immediately available account session. No authentication/email policy was changed.
- Install SQL regeneration and whole-repository verification are coordinated by the parent task.

## Source coverage

Enumerated the complete current API route and migration file inventory. Closely read the shared API handler, authentication request parser/throttling, signup and auth callback, Supabase RPC adapter/allowlist, origin checks, proxy/CSP/session refresh, session lifetime policy, certificate rendering/attestation service, report export route, SMS webhook validation/route, SMS dispatch, worker outbox loop, environment configuration, and the client-address portion of the rate limiter.

Database source review focused on foundation tenancy/RLS/auth/MFA/capabilities; staff grants and application boundaries; registry relationships and merge implementation; scheduling serialization wrappers; administration/exception intake/corrections; certificate issuance/attestation; runtime worker/webhook privileges; integrity migrations 0034/0040; location closure and posting guards; physical count serialization; and the latest chained stock correction. Existing regression sources were read for fixture behavior and coverage before adding tests.

No additional confirmed defect was identified in the inspected auth, origin, webhook signature, or runtime-role boundaries. This is a bounded finding, not certification of the entire security surface.

## Limits and remaining risk

No production Supabase project, deployment ingress, external SMS provider, or real patient data was inspected or modified. Not every individual API handler or SQL function was read line by line. Broad baseline and browser verification belong to the parent task. No new feature or dependency was added.

The migrations fix future commands; they do not infer and repair access lost in historical merges or historical silently discarded lot corrections. Existing affected records require explicit staff review. Intentional suspension on the surviving relationship still takes precedence over a current duplicate link.
