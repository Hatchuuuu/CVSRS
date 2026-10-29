# eVacTrack three-portal design and research brief

Date: 17 October 2026. Status: proposed design for the requested implementation plan; product code has not been changed by this planning task.

## Outcome and boundaries

Make the existing local vaccination system coherent for three audiences: parents managing their children's care, clinic workers delivering care, and developers administering technical access and operations. Finish and verify the existing workflows before adding modules. The user requested a plan, so this document does not authorize execution or claim the application has passed new tests.

**Protected:** the landing page and sign-in/create-account pages, handlers, authentication behavior, signup confirmation policy, redirects, cookies, MFA and recovery logic. Do not redesign or rewrite them. Account profile layout may change; its password/security behavior may not. No confirmation or verification emails are added. Immediate account access remains separate from clinic approval of staff privileges and guardian authority over clinical records.

The current working tree contains substantial pre-existing changes. The implementation baseline is the current working tree, not HEAD. Preserve those changes and use forward migrations only. Do not reset the normal local database.

## Research and its application

Sources checked on 17 October 2026. These inform requirements, not clinical approval or certification.

| Source | Relevant finding | Decision for this system |
| --- | --- | --- |
| [WHO Digital Adaptation Kit for Immunizations, 2025](https://www.who.int/publications/i/item/9789240099456) | Describes operational requirements, personas, workflows, data and decision support for immunization systems. | Build around real tasks and trace each requirement to a tested journey. Do not import a new clinical algorithm simply because it appears in a reference. |
| [WHO immunization business processes](https://smart.who.int/immunizations/v1.0.0/business-processes.html) | Includes registration, service planning, administration, reminders, overdue tracing, duplicate resolution and reports. | Retain these existing capabilities and connect them through a complete clinic visit. Duplicate/correction workflows are essential even if used infrequently. |
| [DOH/UNICEF/WHO Philippine immunization strategies, January 2025](https://www.who.int/philippines/news/detail/30-01-2025-doh--unicef--who-highlight-key-strategies-to-achieve-95--child-immunization-in-the-philippines) | Emphasizes reaching children and sustainable vaccine supply. | Prioritize reachable follow-up lists and reliable stock workflows over decorative dashboard metrics. |
| [WHO Philippine vaccination programme field experience](https://www.who.int/philippines/news/feature-stories/detail/overcoming-challenges-in-the-immunization-programme-with-vaccine-heroes) | Describes community health workers helping families understand and access vaccination. | Give BHWs a focused registration/follow-up workspace, without assuming clinical administration authority. |
| [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) | Least privilege, deny by default and permission validation on every request. | Portal menus are presentation; server commands and database permissions remain the enforcement boundary. Technical administrators do not automatically receive clinical access. |
| [Philippine Data Privacy Act, NPC](https://privacy.gov.ph/data-privacy-act-/) | Health information is sensitive personal information; processing and security obligations apply. | Minimize visible data, retain guardian/clinic isolation and audit, and avoid exposing patient records in technical diagnostics. This design does not establish legal compliance. |
| [W3C target-size guidance](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) | Explains minimum target size and spacing. | Keep the project's stronger 44px control target, keyboard access, visible focus and responsive reflow. |

DOH NIP manual PDFs were found but could not be opened through the research tool. No vaccine intervals, reporting formulas, professional licensure rules or purported official forms are inferred from search snippets. Retain the existing approved-schedule mechanism. Clinical rules for real use need the clinic's current approved source and acceptance; locally seeded examples must be marked synthetic.

## Evidence from the current repository

| Area | Evidence | Assessment |
| --- | --- | --- |
| Family destinations | `src/app/{children,vaccination-records,appointments,help,messages,account}/page.tsx` | All six exist. Redesign and workflow verification are needed; they are not missing modules. |
| Registration clutter | `src/app/children/page.tsx`, `forms.tsx` | Both long forms render below records. Move each into a dedicated, intentionally opened task. Preserve privacy acknowledgement and existing anchors. |
| Portal context | `src/app/layout.tsx`, `src/components/workspace-sidebar.tsx` | Navigation favors the first active staff membership. Shared pages and multiple roles need explicit context rather than an accidental first-clinic choice. |
| Staff roles | `src/lib/staff-roles.ts`, `src/lib/auth/clinic-access.ts`, migration `0053_bhw_registry_access.sql` | Nurses/midwives share `clinical_staff`; BHW has its own capabilities. Active memberships already merge per clinic and check expiry. Reuse this. |
| Staff creation | `src/app/api/v1/clinics/[clinicId]/staff-accounts/route.ts`, clinic `admin/create-staff-account.tsx` | Already implemented with MFA, operation-key retry handling and approval workflow. Relocate its presentation, not its authentication contract. |
| Clinic navigation | `src/lib/auth/clinic-navigation.ts` | Up to 14 capability-filtered destinations; group daily work separately from occasional management. |
| Operations | clinic `settings/page.tsx`, `get_ops_status`, worker modules | Backlog, failed jobs and recorded backup/restore evidence already exist. Reuse them; never claim a recorded check proves the service is healthy now. |
| Messages | `src/app/messages/page.tsx`, worker/outbox | Real local in-app inbox and pagination exist. SMS settings currently compete with the inbox; real SMS is not a local completion dependency. |
| Care information | `src/app/help/page.tsx` | Reviewed clinic content exists. A null result currently becomes an empty list; establish the RPC contract and distinguish read failure from genuinely unpublished content. |
| Account | `src/app/account/page.tsx` | Profile/password/security sections exist. Contact preferences are linked through Messages; move their presentation to settings without changing commands. |
| Local execution | `scripts/dev.ts`, `scripts/e2e.ts`, README | Real local Supabase, worker, isolated browser test stack and local database tests exist. Docker/WSL and installed dependencies are prerequisites. |
| Limitations registry | `docs/implementation/known-limitations.md` | Contains explicitly stale/resolved entries. Verify source and tests before classifying any item as a missing feature. |

No fresh tests or live clinical acceptance were run during planning. Historical test counts are not a new pass.

## Portal architecture

Use one application, one existing identity system and one command/database layer. Separate navigation, page composition and permitted task entry points. Do not create three databases or three login implementations.

### Parents Portal

Keep existing URLs and six primary destinations: My Children, Vaccination records, Appointments, Care Info, Messages, Settings / Account. A staff member viewing family pages receives family navigation and only their independently authorized guardian records. Staff status never grants family access to unrelated children.

### Clinics Portal

Keep `/clinic` as clinic selection and `/clinic/[clinicId]/*` as clinical workspace. Show the clinic name and role context persistently. Group navigation:

- Daily work: Today, Find or register, Follow-up.
- Records and review: Review queue, Record transfers, Questions and plans.
- Clinic management: Vaccine stock, Reports, Care information, Clinical setup, Staff approvals, Outage forms.

Each link remains capability-filtered; empty groups disappear. Clinical workers receive their existing role-appropriate starting destination. Do not grant BHWs vaccination recording through a navigation change.

### Developer Console

Add `/developer` for assigned technical clinics and `/developer/[clinicId]/{staff,settings,operations,audit}`. This is a technical-administrator workspace, not a browser database owner interface. Use existing active `tech_admin` membership plus each action's capability and MFA. A technical administrator can operate only assigned clinics; no global superuser is invented.

Essential features:

1. Staff account creation using the existing provisioning endpoint; show account-created, pending-approval, active, rejected and revoked states accurately.
2. Staff access administration using existing request/review/revoke commands and independent-approval rules. Clinical approvals stay available in Clinics Portal to clinical leads.
3. Existing clinic contact/hours/timezone configuration, with explicit clinic scope.
4. Operations status: queued/failed local messages and recorded backup/restore evidence, with refresh and clear unknown/error states.
5. A restricted technical audit view of staff-access/configuration/operations actions. Do not expose clinical audit payloads to `tech_admin`, which currently lacks `audit.read`; implement a dedicated sanitized read if needed.
6. Existing local bootstrap and restore runbooks, reachable as operational documentation. No browser shell, SQL editor, secret viewer, reset-database button, impersonation or automatic patient export.

Preserve old admin deep links through server redirects or compatibility pages after access checks. `/clinic/[clinicId]/admin` must still serve the existing clinical-lead approval path; redirect only technical-only users to the console. Existing sign-in destinations therefore remain valid without changing authentication.

Shared `/account` and `/messages` remain single implementations. An explicit validated `portal`/`clinic` navigation context may choose their shell; it never authorizes a command. When absent, use a stable default based on available memberships. Do not infer access from query parameters, local storage or a display label.

## Role boundaries

| Actor | Primary work | Must not gain through redesign |
| --- | --- | --- |
| Parent/guardian | Own linked children, authorized records, bookings, inbox, profile | Other families, staff tools, clinical write access |
| Registration assistant | Existing registration, identity and queue capabilities | Clinical approval or administration merely from job title |
| BHW | Search/register permitted identity data, assigned-scope follow-up, contact outcomes | Full clinical history or dose recording absent explicit existing capability |
| Nurse/midwife (`clinical_staff`) | Authorized clinical care, records, sessions and stock use | Technical access provisioning or self-approval |
| Clinical lead | Clinical review, schedule/content/access approvals allowed by current capabilities | Approval of own request or automatic owner privileges |
| Inventory clerk | Authorized stock/custody/count/cold-chain tasks | Unnecessary patient details |
| Developer (`tech_admin`) | Assigned-clinic staff provisioning, technical configuration and operations | Clinical records, clinical approvals, unassigned clinics, secrets |
| Local database operator | Controlled CLI bootstrap/recovery/restore | A corresponding unrestricted web role |

The database capability union remains authoritative for people with multiple roles. Portal selection changes presentation, not which capabilities exist. Specific clinical permissions must be verified against the latest migrations before implementation.

## UI/UX direction

Retain civic blue, light backgrounds and current operational typography. Use existing design tokens and components. No landing-page styling or new visual dependency. Give every page one title, a short purpose, one primary action and useful secondary actions. Desktop: stable sidebar, generous content width but forms capped near 44rem. Mobile: compact navigation with active destination, one-column forms and no hidden essential actions. Avoid decorative metrics without a task behind them.

| Page | Proposed arrangement | Complete behavior |
| --- | --- | --- |
| My Children | Records first; one concise access summary per child; Register and Link as explicit task entrances | Full-page register/link forms, cancel/back to records, retained validation, privacy notice before submission, visible saved/pending result. Preserve `#add-h`/`#link-h` compatibility. |
| Child record / Vaccination records | Select child, identity header, Next steps / History / Certificates sections; secondary record actions grouped | Existing anchors remain valid; reported and verified doses visibly distinct; no clinical links for restricted guardians; download is a real PDF, not a preview-only button. |
| Appointments | Child selector and clinic context, upcoming bookings, book visit, recent history | Capacity/duplicate rejection, no sessions, timezone, cancel confirmation, reschedule success and persistent result; never silently switch selected child. |
| Care Info | Topic index and readable reviewed articles grouped by clinic | Source/review date/language fallback remain visible; unavailable read is not unpublished content; no new invented medical advice. |
| Messages | Inbox first, unread status, newest/older pagination, record links | Mark-read persistence, no skipped items at equal timestamps, revoked-record links reveal no protected data; contact settings move to Account. No chat composer without a supported conversation workflow. |
| Settings / Account | Profile, contact preferences, existing security links and account information | Independent save states; preserved passwords/MFA behavior; language preference does not promise unavailable translations; old text-settings anchor leads to new location. |
| Clinic Today | Session/date context, arrivals, queue and next actions | Walk-in remains first-class; a visit may finish without a vaccination using existing supported outcomes; failures retain entered data and show retry. |
| Clinic child record | Identity strip, current visit, dose entry, history/review tools | Correct child and clinic always visible; lot/expiry/stock checks remain; corrections retain originals and reasons. |
| Developer Staff | Searchable staff list, status/filter, Create staff task, pending decisions | Clear distinction between identity creation and role activation; retry-safe creation, duplicate email handling and no password in logs/audit. |

All pages include real loading, empty, error, restricted, success and stale-data states. Errors preserve input where safe, focus an error summary, and do not imply success. Dialogs, if reused, have focus return/Escape behavior; long registration forms use dedicated pages rather than cramped modals. Respect reduced motion. Screenshots and keyboard tests cover 390, 768 and 1440px plus 200% zoom.

## Essential gaps and exclusions

Confirmed priorities: portal-context separation; distinct technical console; registration/linking task separation; coherent account/contact placement; capability-specific staff navigation; technical audit projection; fresh local end-to-end evidence.

Verification-driven priorities: stale/null read handling, message worker recovery, duplicate/correction and transfer continuity, booking concurrency, access expiry and loss of approvers. Fix demonstrated failures in existing shared code. Do not call these missing modules before tests establish the gap.

Add an expiring-approver warning if current access reads omit it: show when an approval-capable membership expires within seven days, without claiming that every expiry removes the final approval path. Keep the existing last-approver protection and owner recovery runbook.

Exclude real SMS/email delivery, cloud hosting, AI diagnosis, automatic contraindication/catch-up recommendations, online payments, telemedicine, national registry integration, sensor integration, maps, social chat, browser offline synchronization and a global developer superuser. Retain existing optional source/data rather than deleting it. Unavailable integrations must not appear as working actions. Manual card entry, typed QR fallback and paper outage forms remain usable local paths.

## Local completion contract

Local means a prepared machine running the real Next.js app, local Supabase Auth/PostgREST/PostgreSQL and local worker. Initial dependency/image downloads need internet; after preparation, core journeys must work without an external service. Local does not mean service-worker offline operation or a static mock.

Completion requires every essential scenario in the implementation plan to pass, persistent effects verified after reload/restart, no unresolved high-impact functional/accessibility/access-control defects, and unchanged protected behavior. A build or screenshot alone is insufficient. Real clinical approval, physical-device testing, hosted delivery and regulatory compliance are separate claims that this plan does not make.
