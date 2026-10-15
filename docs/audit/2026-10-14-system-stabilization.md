# CVSRS full-system stabilization — 14 October 2026

## A. Executive summary

**READY WITH DOCUMENTED LIMITATIONS** for the verified local scope. The current application was inspected, confirmed defects were reproduced and repaired, and fresh static, database, build, upgrade, restore and browser checks were executed. The normal application is running at `http://localhost:3000` with migration ledger 50 through 0049. No new product feature, dependency, clinical rule, patient history, confirmation email, deployment or repository reset was introduced.

This report describes this audit batch, not every pre-existing uncommitted change. Git was on `master` with substantial modified, deleted and untracked work before the audit. That work was preserved. Reviews were divided across backend/security, frontend/motion and setup/testing; an independent final reviewer checked the actual changes and found two further problems, both repaired.

The audit implemented **15 corrective issue entries**, including accessibility/motion corrections, an authentication hydration defect exposed by the final browser run, a CLI buffer regression introduced and caught during this batch, and two production dependency patches. A remaining development dependency advisory and Supabase's non-loopback port bindings are documented below. This is not a guarantee of zero defects, complete clinical configuration, WCAG conformance or public-production readiness.

## B. Architecture assessment

Detected stack: Next.js 16.3.8 App Router/React 19, TypeScript, Tailwind 4, Zod, Supabase Auth/PostgREST/PostgreSQL, Vitest and Playwright. Installed Next guides were read for route handlers, accessibility, environment-variable loading and output directories, including updated documentation after the patch.

The existing boundaries are worth preserving:

- Server pages share a per-request authenticated viewer. Clinic access combines active memberships and requires MFA; the database rechecks every command.
- API handlers share same-origin mutation checks, bounded UTF-8 parsing, UUID/path validation, strict schemas, operation keys, request IDs, safe errors and rate limits.
- The Supabase adapter uses the publishable key, validates sessions with Auth, and restricts commands to an allowlist. PostgreSQL enforces tenancy, capabilities, RLS, separate approval, immutable records and transactional stock movements.
- Certificates freeze signed snapshots, use server/database attestation, and expose minimal public authenticity information. Workers and SMS receipts use distinct limited database roles.
- Shared UI fields, notices, mutation retry keys, disclosures and confirmation focus behavior cover recurring frontend needs.

No architectural rewrite was warranted. Fixes reuse these boundaries. New migrations replace the two affected function implementations while retaining historical migration meaning, wrappers and grants.

A fresh installed-TypeScript AST boundary inventory parsed **all 331 source modules** with no syntax diagnostics, enumerated **145 route files / 167 exported HTTP methods**, and checked **220 literal RPC call sites** against the **168-command allowlist**. Every allowlisted command has a migration definition. The full inventory is retained privately in `.local/audit-current-boundaries.json`. These assertions establish structural coverage; they do not replace request/authorization/SQL behavior tests or imply every dynamic call/branch was manually reviewed.

The requested Graphify source map is in `graphify-out/graph.html`, `graph.json` and `GRAPH_REPORT.md`: 1,390 nodes / 3,487 directed edges / 95 communities, covering 331 code modules plus the small certificate-font/icon corpus. Its health gate reports **405 dangling extraction edges and 14 collapsed same-endpoint edges**. Treat it as a navigation aid; verify relationships in source. It neither models all SQL behavior nor certifies architecture. The extractor initially failed because the temporary Windows multiprocessing driver lacked a main guard; that audit-only driver was corrected and extraction rerun.

## C. Feature and workflow audit

The table traces workflow groups through actual entry points, frontend/backend paths, entities and security gates. “Browser pass” refers to executed isolated Auth/PostgREST/database journeys, not normal-clinic clinical acceptance or every possible branch.

| Existing workflow / entry point | Path, entities and authorization | Observed result / fix | Verification |
|---|---|---|---|
| Family registration `/sign-up` | Sign-up form → `/auth/sign-up` → Supabase Auth → profile bootstrap; server name/password/terms validation; no client role grant | Immediate confirmed access retained; invalid direct short passwords refused | Account E2E journeys; auth/unit and foundation tests |
| Sign-in, logout, recovery `/sign-in`, `/account` | Auth handlers/SDK, bounded cookie policy, callbacks and password forms; Auth users and MFA factors | Correct/incorrect credentials, recovery, password change and subsequent MFA exercised; no confirmation mail added | Account/password E2E and auth/session unit tests |
| Staff applications `/evactrackstafflogin/create-account`, `/clinic` | Ordinary account + staff application → admin console → membership request → independent approval; staff applications/memberships | Acceptance cannot self-approve; staff need MFA; UTC bootstrap validation corrected | Staff application/MFA E2E; staff DB tests; first-staff CLI regression |
| Administrator `/clinic/<id>/admin`, `/access`, `/settings` | Capability-aware pages → scoped RPCs; applications, memberships, clinic configuration and audit | Role denials/revocation and independent approval exercised; administrator lacks clinical access without that duty | Role E2E; foundation/runtime-security/0034/iteration4 DB tests |
| Parent child registration/linking `/children` | Child forms/privacy acceptance → child/guardian relationship RPCs; profiles, guardians, children, enrollments | Provisional access remains restricted; second-family access denied; reviewed links persist | Family/first-visit/record E2E; registry/privacy/transfer DB tests |
| Record review and merge `/clinic/<id>/review`, child record | Review forms → `merge_children` wrapper → `merge_children_prev`; children, relationships, enrollments, QR passes, cases | Verified guardian access now survives provisional/expired collisions; intentional suspension preserved | Five new real-role merge regressions and existing registry/integrity tests |
| Booking, arrival and queue child visits / Today | Forms → appointment/session/check-in/queue commands; sessions, bookings, service days, visits and tickets | Book/move/cancel, arrival/call/service completion exercised; public display has persistent announcements without timestamp chatter | Visit/connected-flow E2E; schedule/visit/concurrency DB tests; announcement render regression |
| Vaccination, evidence and corrections staff child record | Signed administration/evidence forms → reviewed commands; events/revisions, review cases and immutable stock ledger | Unknown old lot no longer suppresses replacement validation, product/lot storage or stock issue; failures roll back | Administration/record/connected-flow E2E; new NULL-lot tests and existing correction/stock tests |
| Stock, counts, cold chain and transfers inventory pages | Role-scoped forms → posting/count/transfer/location commands; lots, movements, balances, excursions and custody | Stock clerk restrictions, separate decisions, quarantine/release, units and balance consistency exercised | Stock E2E and inventory/count/location/transfer DB tests |
| Certificates child record / `/verify/<token>` | Issue/render/store/download → snapshot/PDF/attestation; Auth/capability/guardian gates and public limited view | PDF/download/validity/revocation exercised; local runner cannot send QR checks to inherited hosted origin | Certificate/connected-flow E2E; PDF/certificate DB/unit tests; local origin regression |
| Questions, care content, privacy and messages | Family/staff forms → scoped commands; check-ins, reviewed content/notices, outbox/messages | Existing error text is associated with textarea fields; questions/content, notices and inbox behavior exercised | Corresponding unit/DB suites, connected-flow E2E and opened-state accessibility |
| Follow-up, reports, audit and outage forms | Staff capability-aware pages → bounded report/export/audit/follow-up reads and updates | Report, audit, contact attempt and printing paths exercised; no new denominator or medical policy invented | Connected-flow/report/admin E2E and follow-up/report/audit tests |

Source reviews are documented separately in [backend review](2026-10-14-backend-review-current.md), [frontend review](2026-10-14-frontend-review-current.md) and [setup/final SQL review](2026-10-14-setup-review-current.md). Existing detailed module inventories remain useful historical snapshots; they are not presented as fresh branch coverage.

## D. Bugs and logical gaps

| ID / severity | Root cause and affected source | Concrete fix | Disposition / evidence |
|---|---|---|---|
| AUD-01 P2 | Registry merge always discarded a colliding duplicate relationship, even when the survivor was unverified or expired | `0048_guardian_merge_integrity.sql` moves the current verified row, retaining its evidence; suspended/current survivor wins appropriately | **Fixed — Verified**: failing-before/passing-after real-role regressions; whole 434-test DB suite |
| AUD-02 P2 | `approve_correction` compared new lot with NULL using `<>`, so approval silently ignored the change and validation | `0049_correction_unknown_lot.sql` uses `IS DISTINCT FROM`; rest of latest function preserved | **Fixed — Verified**: valid-lot issue/product/revision and unknown-lot rollback regressions; full DB suite |
| AUD-03 P2 | Local dev/E2E inherited a hosted `CVSRS_PUBLIC_URL`, so certificate QR links pointed outside the local app or failed canonical HTTPS validation | Shared `localWebEnvironment` pins the setting empty, selecting the existing request-origin fallback | **Fixed — Verified**: focused environment/publicBase checks and local certificate/browser journeys |
| AUD-04 P3 | `Intl.supportedValuesOf('timeZone')` omits UTC, which the existing database accepts | First-staff CLI explicitly accepts UTC while retaining validation | **Fixed — Verified**: UTC reaches required-owner-setting check; invalid zone rejected before connection |
| AUD-05 P2 | Reduced-motion reset covered button presses, leaving link presses/SVG hover transforms active | Existing global preference block resets affected link/SVG transforms | **Fixed — Verified**: failed-before motion test and actual Chromium hover/press computed styles |
| AUD-06 P2 | Service tabs used smooth/implicit focus scrolling and replayed delayed actual explanatory text | Prevent implicit focus scrolling; explicit instant nearest scrolling; remove repeated icon/copy animation | **Fixed — Verified**: handler regression, rendered ArrowRight selection and text animation/opacity assertions |
| AUD-07 P3 | FAQ answers used layout transitions and delayed text entrance on repeated keyboard/pointer opening | Delete those transitions/entrance delays, keep native disclosure and styling | **Fixed — Verified**: focused policy check and actual Enter-open readable-answer checks |
| AUD-08 P2 | Three raw textarea inline errors had no field description association; content hint also unassociated | Stable hint/error IDs and conditional `aria-describedby` in check-in, privacy and content forms | **Fixed — Verified**: all three failed before; rendered markup assertions pass |
| AUD-09 P2 | Queue poll timestamp lived in a status region; first calling live region mounted only with a ticket | Persistent atomic calling region; timestamp remains visible outside status; separate connection status | **Fixed — Verified**: empty-region render regression and actual rendered DOM; human speech not verified |
| AUD-10 P2 | E2E web runtime inherited owner/service/webhook credentials and could load them from dotenv | Shared local env builder sets empty privileged overrides; normal launcher retains existing dotenv refusal | **Fixed — Verified**: inherited values removed without changing caller env; full local runtime tests |
| AUD-11 P2 | Supabase start/reset may print credential rows into inherited operator logs | Shared CLI output capture filters credential-bearing rows before printing; status parser still gets raw private capture | **Fixed — Verified**: credential/log preservation tests; no secret values included in reports |
| AUD-12 P2, introduced/caught | Capturing CLI output added Node's default 1 MiB limit and ignored spawn errors | Explicit 16 MiB bound and safe process-failure handling | **Fixed — Verified**: real 2 MiB child-output test and generic-error regression; cold downloads not repeated |
| AUD-13 P1 | Sign-in/sign-up SSR controls were usable before JavaScript attached their submit handlers. Under load the responsive journey submitted a native GET `/sign-in?` and never authenticated | Family and staff forms use the existing `useSyncExternalStore` hydration pattern and disabled native fieldsets until handlers attach; a no-script notice explains the requirement. Server authentication is unchanged | **Fixed — Verified**: SSR regressions fail before/pass after; Chromium no-JavaScript reproduction and the previously failing responsive journey both pass; independent 78-test review |

| AUD-14 P1 dependency advisory | The installed Next.js 16.3.7 matched six published advisories, including high-severity image SSRF | Targeted patch to 16.3.8 and matching platform packages | **Fixed — Verified**: production npm audit clean; types/lint, 609 unit tests and build pass. No application exploit reproduced; image remotePatterns are unused |
| AUD-15 P1 dependency advisory | source-map-js 1.2.1 matched malicious indexed-source-map denial of service | Compatible patch to 1.2.2 in the lockfile | **Fixed — Verified**: production npm audit clean; patched static/unit/build checks pass |

Independent review also caught that `behavior: 'auto'` obeys global CSS smooth scrolling. The final AUD-06 implementation uses `'instant'`, with `focus({preventScroll:true})`, rather than merely changing a test expectation.

Production dependency scan: **zero vulnerabilities** after targeted patches. The Next [maintainer advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4) names 16.3.8 as patched; source-map-js [release 1.2.2](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2) repairs the indexed-map denial of service. These are advisory matches, not evidence of successful exploitation of this application.

## E. Database, APIs, security and DSA

The fresh disposable database suite executes all migrations and actual role/JWT switches. Final result: **434 tests / 32 files pass**. The populated upgrade drill from 0030 to 0049 passes, including data continuity, post-upgrade commands, RLS, no table-wide public writes, empty SECURITY DEFINER search paths and the exact **168-command authenticated RPC grant set**. Restore verifies 69 tables / 12,177 rows, 22 certificates, 2,470 audit rows and 172 function grants, with no reported integrity problem.

`0049` was independently compared against `0047`: excluding comments, only the NULL-safe lot comparison changes. `0048` keeps capability checks, stable child locks, operation receipt, merge wrapper, audit and downstream enrollment/QR behavior. Neither migration grants new privileges or rewrites historical rows. Current functions retain prior grants through `CREATE OR REPLACE`.

No new algorithm/index/refactor was justified by a reproduced performance issue in this batch. Bounded queries/body/downloads, stable lock order, idempotency and serialized inventory/scheduling paths remain. Previously recorded performance/load measurements were not rerun or promoted into new claims.

Important limit: the fixes affect future commands. They cannot infer historical guardian access that was lost or silently ignored historical lot corrections. A clinic must review any known affected records explicitly; no automatic medical/access repair was attempted.

## F. UI/UX and code quality

The existing civic identity, forced light theme, role-specific operational layout, labelled samples, shared controls, notices and approved illustrative landing choreography remain. No redesign, extra animation or dark-mode expansion was added.

| Before | After | Why |
|---|---|---|
| Link/icon transforms survived reduced motion | Shared reduced-motion reset | Honors movement preference while retaining color/state feedback |
| Keyboard tabs glided and delayed actual text | Instant scrolling and immediately visible text | Repeated navigation should keep up with input |
| FAQ opened with layout/text delays | Native immediate answer | Removes delayed reading and avoidable layout animation |
| Field errors existed only beside textareas | Errors/hint describe the focused textarea | Revisited fields convey the validation problem |
| Freshness timestamp announced every poll | Visible timestamp outside status | Calls and connection errors carry the announcements |

The final motion verdict is approved for the corrected source/rendered scope; this does not certify all illustrative animation feel on every device. No actual dropped-frame defect was claimed without profiling. Dormant dark-only contrast concerns were rejected as unreachable under the explicit light-only product decision.

Rendered public service/FAQ and queue pages were inspected using the in-app browser. Computed explanatory animation was `none`, opacity `1`; ArrowRight and Enter worked. Two separate Chromium tests verify reduced-motion hover/press transforms and immediate keyboard text. Full browser journeys additionally cover axe WCAG A/AA tags, overflow at 375/1280px, responsive screens at 320/768/1440px and opened-form/menu/merge-cancellation keyboard recovery.

## G. Local setup and testing

Supported commands remain:

```sh
npm install
npm run dev
npm run setup:first-staff -- --org "<organization>" --clinic "<clinic>" --timezone Asia/Manila --admin <email> --lead <email>
npm run check
npm run test:db
npm run test:e2e
npm run build
npm run matrix:check
npm run db:install-sql -- --check
npm run drill:upgrade
npm run drill:restore
```

Prerequisites: Node >=22, npm and Docker Desktop/WSL2 for normal local Supabase and browser tests. The SQL suite uses the existing project-local disposable PostgreSQL cluster; test reset checks actual data directory and test database names. E2E has its own project/ports/database, never the normal local records. Hosted development remains the explicit `npm run dev:next` path. No secret values belong in this document.

`npm run dev` starts services, applies pending ledger migrations without reset, uses saved local certificate/limited-worker secrets and opens the loopback application. Local web runners now force local certificate origin and exclude privileged credentials; Supabase diagnostics are buffered and filtered before printing. Capture is bounded at 16 MiB and fails safely if the child cannot complete. First-time uncached image downloads were not repeated.

| Executed check | Current evidence |
|---|---|
| First sandbox `npm run check` | Types/lint passed; Vitest temporary SSR files were inaccessible (62 files failed). Host run removed this environment limitation; not a fabricated app fix |
| First sandbox database tests | PostgreSQL service inaccessible; host run passed original 427 tests |
| First browser attempt | Docker stopped/inaccessible from sandbox; Desktop started and approved host execution connected |
| Host initial unit run | 593 passed / 1 failed because a newly added intentional regression was collected during implementation; not a clean pre-edit baseline |
| Initial default build attempts | Turbopack CSS compiler worker exited before connection; a fresh output folder built successfully. Stale generated output archived reversibly under ignored `.local`; final default build passes |
| Final check | Types/lint and **609 unit tests / 85 files pass** after hydration correction and again on Next.js 16.3.8/source-map-js 1.2.2 |
| Final database suite | **434 passed / 32 files** |
| Browser baseline | **51 passed together in 15.0 minutes** before final migrations |
| Intermediate final browser suite | **50 passed / 1 failed** in 16.7 minutes. Responsive sign-in reached `/sign-in?` before hydration. This failure is retained, investigated and fixed as AUD-13 |
| Hydration/responsive rerun | **2 passed** on existing isolated fixtures, without resetting them: corrected responsive journey plus JavaScript-disabled auth controls |
| Complete pre-dependency-patch browser suite | **54 passed together in 16.1 minutes**, exit 0, on a freshly reset isolated stack with all final migrations, motion and hydration regressions |
| Final patched browser suite | **54 passed together in 14.5 minutes**, exit 0, on a freshly reset isolated stack with Next.js 16.3.8/source-map-js 1.2.2 and all corrected source/migrations |
| Focused new motion browser tests | **2 passed** after the final instant-scroll correction; separate output path avoids touching full-suite artifacts |
| Final production build | Default `npm run build` passes after hydration correction and again on patched production dependencies |
| Dependency audit | Production-only npm audit: **0 vulnerabilities**. Full audit: **5 high development package entries / one unresolved braces advisory**; see AUD-16 |
| Matrix / install | 287 rows current; generated SQL matches **50 migrations** |
| Upgrade | 0030 → 0049 passes on a populated disposable database |
| Restore | 69 tables / 12,177 rows; certificate/audit/grant/integrity checks pass |
| Normal local runtime | Readiness HTTP **200**, ledger **50 / 0049**. Initial post-startup hashes matched across read-only checks. Later comparison still matched MFA, profiles, memberships, child and guardian rows; eight Auth users remained, but the full `auth.users` digest changed. Aggregate Auth audit showed one token refresh and one revocation; see the limitation below |

The normal hash snapshot was taken **after startup/migration**, because its stack was initially stopped. It proves the later read-only verification preserved those rows, not a claimed fresh pre-migration comparison. The migrations contain function replacement only; no normal database reset, clinical fixture import or patient/account edit was performed by this batch.

The subsequent full `auth.users` digest change is consistent with observed operational token activity, but the hash-only baseline cannot identify exactly which Auth fields changed. All six other compared identity/MFA/membership/patient tables remained identical, and the Auth user count stayed eight. Therefore this report does **not** claim complete Auth-row invariance over the whole session. A future preservation trial should hash stable identity/credential fields separately from token/activity timestamps; no speculative repair or session rollback was attempted.

## H. Modified and removed files

This batch's significant application/tool changes:

- `supabase/migrations/0048_guardian_merge_integrity.sql`, `0049_correction_unknown_lot.sql`: compatible corrective functions; `supabase/install/fresh-install.sql`, `verify.sql`: regenerate the existing install package.
- `scripts/local-stack.ts`, `dev.ts`, `e2e.ts`, `setup-first-staff.ts`: local origin/credential/log isolation and UTC validation.
- `src/app/globals.css`, `_landing/landing.css`, `_landing/service-explorer.tsx`: reduced/keyboard motion corrections.
- `src/app/children/[childId]/checkin.tsx`, `src/app/clinic/[clinicId]/clinical/privacy-form.tsx`, `content/forms.tsx`: field descriptions.
- `src/app/display/[clinicId]/board.tsx`: stable queue announcements.
- `src/app/sign-in/sign-in-form.tsx`, `src/app/sign-up/sign-up-form.tsx`: gate native controls until hydrated without changing credential/session handlers.
- `tests/db/guardian-merge-integrity.test.ts`, `correction-null-lot.test.ts`; `tests/unit/local-stack.test.ts`, `setup-first-staff.test.ts`, `local-cli.test.ts`, `shell-motion.test.ts`, `accessibility-feedback.test.ts`, `service-explorer-motion.test.ts`; `tests/e2e/14-motion-preferences.spec.ts`: focused regression coverage.
- `tests/unit/auth-hydration.test.ts`, `tests/e2e/15-auth-hydration.spec.ts`: preserve safe pre-hydration behavior for family/staff sign-in and account creation.
- This report and peer review documents; `graphify-out` map/health artifacts and source-extractor cache. Temporary scripts/logs and archived generated builds remain under local audit paths.
- `README.md`: link to current stabilization evidence and explain local origin/credential isolation.

No pre-existing product/source file was deleted. One incomplete test written by an interrupted audit agent was removed after its duplicate coverage was implemented correctly; it had an invalid component import and was not a user file. Automatic temporary custom-build entries were removed from `tsconfig.json`, returning it to the pre-audit output-path configuration. `package.json` and `package-lock.json` received the targeted Next.js/source-map-js patches above; no dependency was added. No Git branch, commit, push or deployment was changed by this batch.

Final whitespace review found a pre-existing extra EOF blank line in `children/[childId]/page.tsx`; that unrelated user file was preserved. New/changed batch files were reviewed separately.

## I. Remaining issues and blockers

| Item | Disposition / next action |
|---|---|
| AUD-16: braces development dependency advisory | **Confirmed — Unfixed**: full npm audit reports five high package entries from one underlying [braces stack-exhaustion advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through eslint-config-next / @next/eslint-plugin-next / fast-glob / micromatch. Latest braces 3.0.3 has no published patch. Runtime production audit is clean; no untrusted application glob path demonstrated. npm's suggested eslint-config-next downgrade to 14.2.35 was rejected as incompatible scope; no forced audit fix applied |
| AUD-17: local service network boundary | **Confirmed binding — External reachability unverified**: Docker publishes normal Supabase API/DB/Studio/inbox ports 54321–54324 on 0.0.0.0 and IPv6, and isolated API/DB/inbox ports 55321/55322/55324 similarly. Next itself binds localhost. These services are not proved loopback-only; firewall/LAN containment must be verified before use on shared networks. CLI supports --network-id and Docker supports a loopback default bridge binding, but existing stack recreation/data preservation and Docker Desktop behavior were not validated. No host firewall or existing service network was changed |
| Normal clinic complete care presentation | **Unverified — Requires Evidence**: the normal clinic still needs approved clinical schedule/products, usable stock/session and intended guardian/record review. Follow the existing classroom walkthrough; synthetic isolated journeys do not supply clinical policy |
| Historical merge/correction effects | **Unverified — Requires Evidence**: review any known affected historical records using existing authorized staff procedures; these migrations do not guess repairs |
| Human screen-reader/physical devices | **Unverified — Requires Evidence**: observe spoken announcements and field errors with a human; test real camera, printer and touch hardware |
| Hosted Supabase/TLS/ingress/Redis/SMTP/SMS | **Unverified — Requires Evidence**: current local evidence is not public deployment verification. Retain existing deployment gates and optional SMS-off policy |
| Graph extraction integrity | **Unverified — Requires Evidence** for omitted/collapsed edges; use source and SQL instead of treating the graph as complete |
| Fresh uncached install/image pulls | **Unverified — Requires Evidence**: installed dependencies and cached local images were used; CLI capture supports a tested 2 MiB output but no fresh large download trial was run |
| Full-session normal Auth-row invariance | **Unverified — Requires Evidence**: only Auth's full-row digest changed, alongside token activity; use a stable-field baseline for a future comparison. Normal MFA/application data hashes and eight-user count remained unchanged |
| Impeccable design sidecar | **Out of Scope — Added to Plan**: `.impeccable/design.json` predates DESIGN.md; optional `impeccable document` refresh, preserving the incumbent design |

Remaining dependency and service-binding findings are explicitly open. Docker's [bridge documentation](https://docs.docker.com/engine/network/drivers/bridge/#default-host-binding-address) explains published-port defaults and the host_binding_ipv4 option; a printed localhost API URL alone does not prove containment. The finite review did not read every individual API/SQL body line by line; runtime suites exercise broad roles/workflows but cannot prove every branch or arbitrary concurrent load.

## J. Future improvement plan — no implementation

1. Verify Supabase service containment before shared-network use, and validate a data-preserving loopback network transition separately. Clinic-owned configuration and observed human accessibility acceptance are the next presentation gates.
2. Add reviewed historical-record follow-up only if the clinic identifies affected data; never infer access or medical facts automatically.
3. Use streaming sanitized CLI output if real setup output exceeds the explicit 16 MiB cap.
4. Resolve Graphify extraction diagnostics before relying on it for exhaustive caller navigation; optionally refresh the stale design sidecar.
5. Hosted/hardware/load verification remains a separate exercise using the existing runbooks, with real approved infrastructure and policies. Revisit the development-only braces advisory when a compatible maintainer patch is published.

These recommendations introduce no product feature in this batch.

## K. Final readiness verdict

**READY WITH DOCUMENTED LIMITATIONS** for local account, registry, clinic-setup and the isolated verified operational workflows. The restored application returns HTTP 200 on Next.js 16.3.8. Types/lint, **609 unit tests**, **434 database tests**, **all 54 browser cases together on patched dependencies**, production build, matrix/install checks, populated upgrade and backup/restore pass. Production npm audit reports zero vulnerabilities. Of **17 issue entries**, **15 have verified corrective changes**; the development-only braces advisory and Supabase service-binding finding remain open with specific next actions. Verify network containment before shared-network use. Normal clinical policy/configuration, historical-record review, human assistive-technology acceptance and public-production operation remain documented limits.
