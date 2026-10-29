# eVacTrack essential system review and simplification plan

Date: 17 October 2026. Status: proposal for review; no implementation authorized or performed.

**Goal:** Make the existing children's vaccination scheduling and records system easier to operate and maintain while preserving clinical records, privacy and the complete clinic visit workflow.

**Approach:** Simplify existing screens and optional services first. Remove code only after checking its callers, database dependencies, tests and operational use. This is a research and scope plan, not an approved design for deleting modules.

**Stack:** Next.js 16.3, React 19, Supabase Auth/PostgREST, PostgreSQL, Tailwind, Vitest and Playwright.

## Basis and limits

Reviewed PRODUCT.md, README.md, package.json, current navigation and selected family/account/card/question pages, existing graph relationships, recent audit reports, known limitations and external prerequisites. Current source takes precedence over an older status table. The working tree contains extensive existing changes; do not revert or overwrite them.

Assumption: the target remains a Philippine community clinic system with a family portal, rather than a general hospital platform. Recommendations about optional services require confirmation against actual clinic practice and capstone requirements. No usage analytics or staff interviews were available. No live database, hosted environment, physical device or fresh test suite was checked in this review.

External research:

1. [WHO Digital Adaptation Kit for Immunizations, 2025](https://www.who.int/publications/i/item/9789240099456): reference for structuring an immunization system around actual service workflows and data requirements, adapted to the local context.
2. [WHO immunization business processes](https://smart.who.int/immunizations/v1.0.0/business-processes.html): registration, service planning, administering and recording vaccines, reminders, overdue follow-up, duplicate resolution and reporting. These support keeping less-visible clinical operations; they do not require every feature in this repository.
3. [Philippine Data Privacy Act, NPC publication](https://privacy.gov.ph/data-privacy-act-/): health data is sensitive personal information; transparency, legitimate purpose, proportionality and security matter. The clinic's privacy owner must determine the applicable basis, retention and disclosure policy. This review does not establish legal compliance.

WHO guidance is a requirements reference, not approval of the application's clinical rules. Obtain the clinic's current approved DOH/NIP schedule and policies before changing clinical calculations. No clinical intervals or new treatment logic are proposed here.

## Main assessment

The system already contains most essential functional modules. Its clearest problems are breadth of navigation, partially operational options, and documentation that no longer consistently describes current behavior. Adding more modules is lower priority than proving the core workflows and reducing visible complexity.

For example, src/lib/auth/clinic-navigation.ts defines 14 possible staff destinations, filtered by capability. This does not mean every staff member sees 14 links. It does mean administration, setup and occasional tasks can compete with daily work for users with multiple roles.

The family Appointments page reuses existing booking components, while Vaccination records links to the child record. These are purposeful task entrances, not evidence of duplicate databases or unused features. Keep them unless actual user testing shows they confuse families.

## Essential: keep and verify

| Capability | Minimum useful behavior | Decision |
| --- | --- | --- |
| Accounts and guardian access | Immediate signup; clinic verifies authority before exposing a child's clinical record | Keep. No verification or confirmation email. Account access and authority over a child's records are separate checks. |
| Child registry | Register, search, link guardians, correct identity and resolve duplicate records | Keep. Avoid making digital registration a condition of walk-in care. |
| Vaccination history | Distinguish reported from verified doses; preserve author, date and correction history | Keep manual entry and staff review. Never let OCR directly establish verified history. |
| Approved schedule | Show due/overdue/next steps from the approved clinic schedule; clearly state when it is unavailable | Keep. Clinical approval and real examples are prerequisites. |
| Appointments and clinic day | Book, cancel, reschedule, walk in, check in, record vaccination and finish the visit | Keep a single coherent clinic-day workflow. |
| Reminders and overdue follow-up | In-app notices plus an actionable staff list and a workable manual contact path | Keep the function. A paid SMS provider is optional. |
| Clinical integrity | Corrections, duplicate-event handling, appropriate approval and audit | Keep even if moved out of the main navigation. |
| Stock safety | Lot/expiry traceability, stock status, quarantine and cold-chain handling when this app manages inventory | Keep existing safeguards. Whole-module removal requires a separate decision about the authoritative inventory system. |
| Records output and reporting | Useful printable history; basic clinic activity and overdue summaries | Keep. Confirm the clinic's reporting formats; do not label unsupported measures as official coverage. |
| Security and operations | Role/clinic isolation, staff MFA, validation, rate limiting, backups and restore, privacy and outage process | Keep. These are operational necessities, not UI extras. |

## Simplify, remove from routine screens, or defer

| Candidate | Evidence / reason | Proposed treatment | Dependency or decision gate |
| --- | --- | --- | --- |
| Admin console and Staff access as separate primary entries | Both are offered by clinic-navigation.ts for some roles | One Administration entrance with existing application/access functions inside | Preserve two-person approvals, membership rules, audit and direct-link behavior. Do not merge permissions merely to merge navigation. |
| Setup and occasional tasks beside daily work | Clinical setup, operations, content and outage forms are separate destinations | Group setup/administration and put printable outage forms in an easy-to-find secondary location | Check each role's entry route, mobile menu, keyboard use and emergency access to forms. |
| Questions and plans | questions/page.tsx combines family questions with clinical plan reviews | Keep plan reviews reachable through clinical review; offer family questions only where staff own a response process | Do not delete catch-up review or unanswered submissions when hiding questions. |
| SMS controls without a real provider | src/lib/sms/index.ts supports none and sandbox; production rejects sandbox | Hide unavailable enrollment/delivery controls and retain in-app messages | Keep existing consent/history. Do not promise SMS or remove the worker needed for in-app delivery. |
| Language choices without translated screens/messages | Account and message forms explicitly say English is still used | Remove nonfunctional language switching from routine UI; retain stored preferences if useful for staff | Distinguish a contact-language preference from a real interface-language setting. No forced rewrite of saved preferences. |
| Card photo OCR | Optional client-side Tesseract flow; manual entry is already available | Keep manual entry primary. Defer OCR from the essential acceptance checklist; remove only if real-device trials show poor value | Trace card-scanner, parser, preparation script, public OCR assets, postinstall, dependencies, docs and tests together. Preserve reported-dose submission and staff verification. |
| General care publishing and nonurgent family questions | Useful adjuncts but not necessary to record a vaccination | Secondary/disabled unless approved content and a responsible responder exist | Retain relevant safety information and existing records. Clinical owners decide what is necessary. |
| Stock and child-record transfers | Useful for multiple clinics, less relevant to a single-clinic rollout | Keep secondary and show where operationally relevant | Do not delete custody, pending transfer state, audit or historical links. Confirm actual deployment scope first. |
| Certificate authenticity infrastructure | Supports clinic-issued certificates and third-party checks; greater complexity than printing history | Keep if required by clinic/capstone; otherwise consider plain record output as the smaller future scope | Decide issuer/acceptance requirements first. Existing issued certificates must remain verifiable/revocable. Never confuse /verify certificate checks with email confirmation. |
| Mascot animation | Active page-mascot import and sign-in integrations exist | Low priority; simplify only if it impedes sign-in, accessibility or device performance | Treat as a product choice, not dead code. Preserve readable textual sign-in feedback. |
| Stale operational/status documents | external-validation.md still describes some built modules as planned/not built; newer files document their implementation | One current readiness checklist, clearly mark older audit snapshots as historical | Do not erase the original specifications or evidence of past decisions. |
| Unused dependencies/assets/scripts | package.json alone cannot prove they are unused | Delete only after import, dynamic-use, script and deployment tracing | No blanket package removal. Keep migration history and evidence required for maintenance. |

## What the system needs most next

1. **Clinical acceptance:** approved schedule/product mappings and representative normal, delayed, reported-dose and correction cases reviewed by clinic staff. The goal is trustworthy existing behavior, not a new automatic catch-up engine.
2. **A shorter role-based daily path:** staff should get from finding a child to recording the visit without navigating administration. Keep advanced tasks available to the right role.
3. **A current readiness register:** reconcile old limitations against current implementation, then list owner, evidence and remaining action for each actual gap. Existing test counts are historical evidence, not fresh passes.
4. **Usability on intended devices:** family registration, next-due information, booking, walk-ins, manual card entry and staff recording on a low-end phone/clinic computer, keyboard and assistive technology. Test real card/camera use before prioritizing OCR.
5. **Operational proof before real deployment:** hosted Auth/RLS configuration, worker delivery, rate-limit/ingress configuration, recovery and backup restore, log visibility and approved privacy/retention decisions. These are release prerequisites, not reasons to block local evaluation.

## Options

- **Recommended: simplify around the existing core.** Reduce competing menu entries, hide unavailable services, reconcile documentation and validate the real visit workflow. Lowest data risk and makes use of work already done.
- **Strict scheduling-and-records scope.** Consider retiring OCR, questions/content, SMS, transfers and advanced certificates after checking clinic/capstone needs and existing records. Less code, but higher integration cost and potential loss of useful workflows.
- **Retain the whole clinic platform.** Keep all modules and invest in acceptance, deployment and training. Broadest capability and ongoing maintenance burden; unsuitable if the goal is a small capstone deliverable.

## Proposed execution sequence after review

### 1. Confirm the deletion boundary

- [ ] Establish local/capstone versus operational clinic scope, number of clinics, mandatory assessment requirements and who uses each optional module.
- [ ] Produce the final keep/consolidate/hide/delete list. Treat uncertain candidates as secondary rather than deleting them.
- [ ] For every deletion, record routes, UI callers, RPCs, schema relations, queued jobs, existing records, tests, fixtures, exports, config and documentation affected.

**Acceptance:** every proposed removal has evidence of non-use or an agreed replacement. No clinical or historical data is scheduled for silent deletion.

### 2. Consolidate navigation and inactive settings

Primary files: src/lib/auth/clinic-navigation.ts, src/components/workspace-sidebar.tsx, src/app/clinic/[clinicId]/staff-nav.tsx, relevant admin/access pages, src/app/account/account-forms.tsx and src/app/messages/text-settings.tsx. Inspect current role-destination helpers and their callers before changing entry routes.

- [ ] Read relevant installed Next.js guides before implementation.
- [ ] Consolidate administration entry points; retain valid old URLs or deliberate redirects.
- [ ] Group occasional tasks without changing capability checks.
- [ ] Make unavailable SMS/translation choices absent or clearly unavailable at their point of use.
- [ ] Update navigation/unit/browser tests for family, clinical, BHW, inventory and administrator roles, including mobile and keyboard behavior.

**Acceptance:** every role can still reach authorized actions; unauthorized actions remain blocked; no broken existing deep links; immediate signup still works without confirmation email.

### 3. Retire only approved optional code

- [ ] Work one optional module at a time, using the dependency inventory from step 1.
- [ ] Preserve records and pending work; use forward migrations if schema changes are actually necessary. Do not rewrite applied migrations or reset the normal database.
- [ ] Remove orphaned packages/assets/scripts only when all users of them are gone; update the lockfile and installation documentation together.
- [ ] Run affected unit/database/browser tests. Confirm reported-versus-verified history and role isolation remain intact.

**Acceptance:** the removed capability has no broken callers, public promises or background jobs; retained history is still readable and auditable.

### 4. Reconcile readiness and verify the retained system

- [ ] Update PRODUCT.md, README.md and current implementation readiness/limitations documents; mark historical reports rather than overwriting their findings.
- [ ] Run npm run check and npm run build; run npm run test:db for RPC/schema/security changes and relevant isolated browser journeys for workflow/navigation changes.
- [ ] Prove registration → guardian verification → schedule → booking/walk-in → recording → history → follow-up; also exercise duplicate/correction, restricted access and outage-paper re-entry.
- [ ] Obtain clinic acceptance and separately execute deployment checks before using real patient information in a hosted release.

**Acceptance:** fewer routine choices, complete retained workflows and current evidence with explicit remaining limits. No new general-purpose abstractions, dependencies or unrelated redesign.

## Review focus

- Grouped navigation must not grant extra capabilities or strand single-role users.
- Removing an optional screen must not delete historical data, pending approvals or issued certificate checks.
- Removing SMS must not interrupt in-app messages, and removing questions must not interrupt clinical plan review.
- Manual entry and walk-in care must work without camera support or family portal access.
- Schedule accuracy, privacy and production readiness require external acceptance; local test success alone cannot establish them.

No code, dependency, database or existing working-tree file was changed for this review. Only this plan was added.
