# CVSRS — FINAL MASTER SYSTEM BLUEPRINT

**Children's Vaccination Scheduling and Records System**  
**Document version:** 1.0 • **Prepared:** 29 September 2026  
**Purpose:** Definitive product and technical blueprint for an academic prototype and a controlled clinic pilot. This is a specification, not an implemented or clinically certified system.

**Source and decision convention.** The supplied master prompt is the source of intended requirements; no separate original brainstorming document was attached. This document consolidates those requirements and makes explicit design decisions where the source is incomplete. “Requires external validation” identifies a rule, permission, or operational policy that must be approved outside the software team. Proposed engineering targets and UI defaults are project decisions, not DOH requirements.

**Baseline scope.** One participating clinic, one responsible organization, Philippine local dates, and synthetic demonstration data first. The schema permits later participating clinics under the same organization, but does not create a national patient registry. A shared organization is a data-access boundary, not automatic permission for all its staff to see every child. A clinic clinical lead and designated privacy officer must approve any use of real patient information.

**Reading guide:** [Product and scope](#1-executive-summary) · [Priorities and phases](#10-feature-prioritization) · [Architecture and workflows](#13-system-architecture) · [Clinical scheduling](#16-vaccination-scheduling-engine) · [Offline and sync](#20-offline-first-architecture) · [Database](#28-database-architecture) · [API and Supabase](#30-api--backend-architecture) · [Security and privacy](#32-security-architecture) · [Page specifications](#38-page-by-page-specification) · [Testing](#44-testing-strategy) · [MVP checklist](#final-mvp-checklist) · [Build order](#build-order).

## 1. Executive Summary

CVSRS is a connected vaccination record and clinic workflow system. It gives guardians a reliable view of their children's records and next steps, while helping clinic staff identify the right child, review an approved schedule, manage arrivals, document administered vaccines, and trace vaccine stock.

The first version delivers a complete chain: **registration → verified record linkage → schedule → appointment or walk-in → check-in → clinical review → vaccination record → stock movement → updated history → printable record → reporting**. A child can receive service without a guardian account, smartphone, birth certificate, or successful SMS delivery.

The system calculates recommendations from approved, versioned rules. Healthcare workers make clinical decisions. An appointment does not establish eligibility; a queue entry does not prove vaccination; recording a physical administration does not automatically mean that dose satisfies the approved schedule.

Use the proposed React, Next.js App Router, TypeScript, Tailwind CSS, Lucide, Supabase/PostgreSQL, RLS, IndexedDB, Service Worker, and Vercel stack. Build one modular application with transactional database functions, not separate microservices. Add offline writes only after the online workflows and reconciliation tests work.

## 2. Problem Statement

Paper records can be lost, hard to retrieve, inconsistent across facilities, and difficult to reconcile. Guardians may miss appointments because they cannot interpret dose sequences, lack connectivity, or face unclear clinic procedures. Staff must calculate timing, search files, monitor stock, and compile reports while attending patients.

Simply digitizing the paper card is insufficient. A useful system must also establish who may see a child's record, distinguish reported from verified vaccinations, preserve corrections, avoid double bookings and double stock deductions, and remain operational when internet or electricity fails.

CVSRS addresses coordination and record quality. It does not promise to eliminate staffing shortages, guarantee vaccine availability, diagnose adverse reactions, or replace approved clinical practice.

## 3. Project Objectives

| Objective | Evidence of success |
|---|---|
| Maintain a continuous, trustworthy child record | Every administration has source, author, time, clinic, verification and amendment history |
| Make the next action understandable | Guardian can identify the next recommended visit and distinguish confirmed booking from recommendation |
| Reduce avoidable staff work | One administration submission updates the event, stock ledger and downstream work without re-encoding |
| Improve safe timing support | Approved rules produce reproducible recommendations; unresolved history produces review, not fabricated dates |
| Preserve equitable access | Staff can register walk-ins and print records for families without accounts |
| Improve lot traceability | Staff can trace an affected batch to administration events and authorized follow-up lists |
| Support interrupted operations | Staff know whether a save is local, synchronized, rejected, or awaiting review |
| Protect health information | Cross-role and cross-clinic access-denial tests pass before any pilot |

Collect baseline and pilot measurements for record retrieval time, appointment completion, and staff encoding effort. Do not claim improvements until observed. The acceptance tests in Section 44 are the first-version completion criteria.

## 4. Target Users

| Role | Main need | Scope |
|---|---|---|
| Parent/guardian | Understand records and arrange care for multiple children | Verified linked children only |
| Registration/clinic assistant | Find or register children, manage appointments and arrival | Assigned clinic; limited health details |
| Nurse/midwife or other authorized vaccinator | Review eligibility and record actual care | Authorized clinical role and clinic access |
| BHW | Follow up assigned households and due children | Explicit area/child assignments, minimum necessary details |
| Clinic supervisor/clinical lead | Approve clinical configuration and exceptional corrections | Assigned clinical governance scope |
| System administrator | Accounts, technical settings, availability | Configuration privileges; no automatic clinical record access |

“Inventory manager,” “certificate issuer,” and “privacy reviewer” are capabilities that can be assigned to suitable staff, not necessarily additional job positions. A small clinic may combine capabilities, but the system records which capability authorized each action. Only a qualified, designated clinical approver can activate clinical rules.

## 5. User Personas

| Persona | Situation | Design implication |
|---|---|---|
| Guardian caring for two young children | Shared phone, prepaid data, occasional access | Persistent child name on every screen, low-bandwidth pages, printed alternative, no smartphone requirement |
| Grandparent accompanying a child | Limited English and low vision | Plain labels, large text, optional Filipino content, staffed identity verification |
| Nurse at a busy barangay clinic | Interruptions and similar patient names | Two-identifier confirmation, keyboard workflow, obvious child banner, explicit final review |
| BHW visiting assigned puroks | Intermittent signal, shared households | Minimal assigned lists and visit outcomes; no unrestricted medical registry |
| Clinic supervisor | Must reconcile stock and submit reports | Exception lists and explainable counts before decorative charts |
| Student system maintainer | Small team and limited deployment budget | One repository, migrations, synthetic data, bounded jobs, repeatable deployment |

These are design personas, not collected personal data or claims about all Philippine users.

## 6. Problems Being Solved

| Problem | CVSRS response | Remaining real-world dependency |
|---|---|---|
| Lost paper card | Authorized digital history and replacement print | Identity verification and historical evidence |
| Confusing dose timing | Clear recommendation, reason and approved rule version | Clinical approval of rules |
| Long or uncertain queues | Arrival-based queue, appointment windows, visible status | Staff capacity and emergencies |
| Missed visits | Follow-up worklist and optional reminders | Reachable contact and BHW capacity |
| Slow patient search | Clinic-scoped search, opaque QR lookup, duplicate review | Accurate identifying information |
| Stock shortages or waste | Lot-level ledger and availability warnings | Procurement and cold-chain operations |
| Weak connectivity | Paper fallback first; controlled offline capture later | Powered device, training and reconciliation |
| Fragmented public/private records | Single timeline with provenance and verification | Access to external evidence |
| Post-vaccination anxiety | Approved care information and clinic contact | Actual clinical support and escalation channels |

## 7. Existing Features Review

| Current Idea | Problem | Recommended Improvement | Final Decision |
|---|---|---|---|
| Digital Vaccination Book; milestone calculator | Could confuse a predicted date with clinical clearance | One timeline plus versioned schedule recommendations | Keep as core |
| One-Tap Search; Baby QR Pass | QR may be mistaken for identity or permission | Scoped search; opaque, revocable locator; confirm identifiers | Keep; no health payload in QR |
| Daily queue number; appointment caps | Booking and arrival are different events | Slot capacity and arrival queue have separate state machines | Keep |
| Express walk-in registration | Fast entry may create duplicates or invented details | Minimal provisional registration, duplicate suggestions, later completion | Keep |
| Multi-child family profile | Household membership is not guardianship | Many-to-many verified guardian relationships | Keep |
| Printable certificate | May imply nationally recognized certification | Clinic-issued record with limited verification and issuer authority | Keep basic verified record; official recognition requires validation |
| SMS reminders | Delivery and response are not guaranteed | Outbox, preferences, deduplication and staff fallback | Phase 2; in-app confirmations in MVP |
| Catch-up scheduler | Clinical complexity exceeds simple date arithmetic | Separate supported rule engine from reviewed catch-up plans | Phase 2 |
| Stock counter; lot logger; low-stock alerts | Mutable counters drift and lose provenance | Ledger from MVP; thresholds and expanded inventory in Phase 2 | Split scope |
| Offline/brownout mode | A web app cannot run without power; concurrent writes conflict | Paper procedure in MVP; controlled device allocations and sync in Phase 2 | Split scope |
| Home care; 24-hour check-in | Could promise monitoring or invent a universal interval | Approved static guidance first; configured follow-up with response ownership later | Keep guidance; defer check-in automation |
| Myth buster; language switcher | Content becomes outdated; machine translation can alter advice | Reviewed content, source, owner, language version, review date | Basic bilingual UI early; library Phase 3 |
| Growth; feeding milestones | Broadens the clinical domain | Measurements with provenance; validated interpretation separately | Phase 3 growth; future nutrition |
| Completion badge | Could imply permanent immunity or shame families | Text-based completion for a named program/version and date | Phase 3, optional |
| Record transfer; public/private history | Copying records creates multiple truths | Verified historical evidence in MVP; controlled access handoff later | Split scope |
| Purok scout; drop-out list | Labels can stigmatize; assignments may overexpose children | “Children needing follow-up”; clinic list in MVP, BHW portal later | Consolidate |
| Refrigerator log | Recording temperature alone does not resolve excursions | Product-specific policy, quarantine and responsible review | Phase 2 manual logging; sensors future |
| Campaign broadcaster; read-aloud; call button | External operations and privacy differ | Approved campaigns later; accessible text now; configured clinic contact early | Phase by dependency |

## 8. Issues, Gaps, Risks, and Improvements

### Issues, Gaps, Risks, and Improvements Identified

| Gap or risk | Required improvement | Acceptance evidence |
|---|---|---|
| Guardian self-links an existing child | Staff-approved link or verified invitation; no name/DOB-only claim | Stranger cannot claim an existing child |
| Duplicate children, twins and incomplete names | Candidate matching with human merge; immutable aliases | Similar names remain separate without review |
| Clinical policy embedded in UI | Approved, effective-dated rule versions and fixtures | Schedule reproducible for stored version |
| Unverified external dose counted as complete | Provenance and verification separate from clinical credit | Parent upload cannot satisfy a rule alone |
| Incorrect administration silently edited | Append correction version with reason and reviewer | Original facts remain recoverable |
| Recording blocked after actual vaccination | Exception capture for already-administered events | Actual care preserved even when timing/stock validation fails |
| Concurrent booking or stock use | Database locks, constraints and idempotency | Last slot/last dose race has bounded outcome |
| Stock counter ignores expiry, losses or transfer | Immutable movement ledger and lot disposition | Opening + receipts − issues/losses matches balance |
| Offline double administration | Assigned workload, local recent history, confirmation and conflict review | Software never claims disconnected devices know all care |
| Offline logout deletes unsent care | Distinguish device lock from logout; sealed recovery bundle | Unsent data recoverable without remaining visible |
| Lost device exposes cached children | Device enrollment, minimum cache, encryption and revocation | No unprotected clinical data in service-worker cache |
| Cached authorization becomes stale | Short offline operating grant; reauthorize every sync | Revoked actor's uploads enter restricted review |
| Certificates expose history publicly | Public minimal authenticity; private detailed verification | QR response has no name, DOB or dose list |
| Transfers create copies or destroy continuity | Access/enrollment handoff around same child ID | One longitudinal record within shared organization |
| SMS fails or goes to reassigned number | Verified contact changes, generic content, retry and follow-up | Delivery state distinct from read/attended |
| Admin has excessive clinical access | Capability separation and audited exceptional access | Technical admin denied patient history by default |
| Coverage denominator is unknown | Separate activity counts from population coverage | No percentage without defined denominator |
| Insufficient access or language support | Assisted registration, accessible controls and reviewed language | UAT includes older and offline guardians |
| Power/server failure | Printed contingency form, reconciliation owner, restore exercise | Clinic can describe fallback and return to service |
| Real deployment assumed from capstone demo | Separate demo, engineering and operational release gates | No synthetic rules presented as approved policy |

## 9. Final Feature Set

Feature IDs below replace inconsistent source numbering. Each capability has one owner and phase; a later phase extends, rather than duplicates, the earlier feature.

| Domain | Canonical features |
|---|---|
| Identity and records | F01 accounts/access; F02 child/guardian registry; F03 search and QR; F04 longitudinal history and external evidence; F05 corrections and audit |
| Scheduling and visits | F06 approved routine rules; F07 appointment capacity; F08 check-in/queue; F09 administration; F10 follow-up worklist; F11 reviewed catch-up |
| Vaccine operations | F12 basic lot ledger; F13 inventory intelligence and transfers; F14 temperature/quarantine; F15 recall tracing |
| Guardian communication | F16 printable/verifiable records; F17 in-app messages; F18 SMS; F19 care guidance/contact; F20 monitored check-ins |
| Reliability | F21 outage procedure; F22 controlled offline writes/sync; F23 backup/monitoring; F24 privacy/security controls |
| Community and content | F25 BHW assignments/visits; F26 record transfer; F27 growth; F28 reviewed education/languages; F29 program completion indicator; F30 community campaigns; F31 read-aloud; F32 nutrition content |
| Governance and insight | F33 core reports; F34 expanded coverage/community reports; F35 master-data/configuration lifecycle; F36 interoperability; F37 advanced hardware integrations |

## 10. Feature Prioritization

Complexity is relative to a small student team: **L** local UI/simple CRUD; **M** several tables and permissions; **H** concurrency, security, clinical governance or cross-system behavior. “Must Have” for a later phase means mandatory if that phase is released, not part of Phase 1.

| Feature | User | Purpose | Priority | Phase | Complexity | Dependencies | Risks |
|---|---|---|---|---|---|---|---|
| F01 Accounts/access | All | Authenticate and scope actions | Must Have | 1 | H | F24 | Unauthorized linkage |
| F02 Child/guardian registry | Guardian/staff | Continuous identity | Must Have | 1 | M | F01 | Duplicates, custody disputes |
| F03 Search and QR | Staff/guardian | Fast retrieval | Must Have | 1 | M | F02 | Enumeration, copied QR |
| F04 History/evidence | Staff/guardian | Preserve all sources | Must Have | 1 | M | F02 | Unverified credit |
| F05 Corrections/audit | Staff/lead | Accountable changes | Must Have | 1 | H | F24 | Silent overwrites |
| F06 Routine rules | Staff/guardian | Explain next recommendation | Must Have | 1 | H | F04,F35 | Incorrect clinical rules |
| F07 Appointments | Guardian/staff | Reserve service capacity | Must Have | 1 | M | F06 | Concurrent overbooking |
| F08 Check-in/queue | Staff/guardian | Manage arrivals fairly | Must Have | 1 | M | F02,F07 | Names exposed publicly |
| F09 Administration | Clinical staff | Record actual care | Must Have | 1 | H | F05,F06,F12 | Wrong child/product |
| F10 Follow-up worklist | Staff | Identify unresolved care | Must Have | 1 | M | F06,F07 | Missed visit mislabeled as missed dose |
| F11 Reviewed catch-up | Clinical lead | Handle complex histories | Should Have | 2 | H | F04,F06 | Unsupported clinical inference |
| F12 Basic lot ledger | Staff | Receive, use and reconcile stock | Must Have | 1 | H | F35,F05 | Double deduction |
| F13 Inventory intelligence | Inventory staff | Alerts, expiry, movement workflows | Should Have | 2 | M | F12 | Bad reorder assumptions |
| F14 Temperature/quarantine | Inventory staff | Track excursion response | Should Have | 2 | M | F12,approved policy | False assurance from a log |
| F15 Recall tracing | Lead | Find affected lots/children | Must Have | 1 basic; 2 follow-up | M | F09,F12 | Incomplete historical lot data |
| F16 Verifiable record | Guardian/issuer | Recoverable proof | Must Have | 1 | M | F04,F05 | Forgery, false official status |
| F17 In-app messages | Guardian/staff | Confirm changes | Must Have | 1 | M | F01,outbox | Stale reminders |
| F18 SMS | Guardian/staff | Reach low-data families | Should Have | 2 | M | F17,provider | Shared phones, failed delivery |
| F19 Care/contact | Guardian | Approved next steps | Must Have | 1 | L | Reviewed content | Unreviewed advice |
| F20 Monitored check-ins | Guardian/clinical staff | Route concerns | Should Have | 2 | H | F18,staff ownership | Unmonitored urgent messages |
| F21 Outage procedure | Staff | Continue service safely | Must Have | 1 | L | Printed form,training | Lost paper or delayed entry |
| F22 Offline writes/sync | Staff | Capture during outages | Must Have | 2 | H | F09,F12,F24 | Conflicts, device theft |
| F23 Backup/monitoring | Operations | Recover and detect failure | Must Have | 1 | M | Deployment | Untested restoration |
| F24 Privacy/security | All | Protect health data | Must Have | 1 | H | Governance | Excessive access |
| F25 BHW work | BHW | Focus outreach | Should Have | 3 | M | F10,assignments | Area-based overexposure |
| F26 Record transfer | Staff | Continue care elsewhere | Should Have | 3 | H | F02,F04,F24 | Duplicated identity |
| F27 Growth | Staff/guardian | Preserve measurements | Nice to Have | 3 | M | F02,validated units | Incorrect interpretation |
| F28 Education/languages | All | Improve comprehension | Should Have | 3; basic UI in 1 | M | Content review | Translation drift |
| F29 Completion indicator | Guardian | Explain program progress | Nice to Have | 3 | L | F06 | Implied lifelong protection |
| F30 Campaigns | Approved coordinator | Target notices | Future | V2+ | M | F18,F25 | Spam or health-data leaks |
| F31 Read-aloud | Guardian | Alternate access | Nice to Have | 3 | M | F28,F24 | Audio heard by others |
| F32 Nutrition | Guardian/staff | Extend approved education | Future | V2+ | M | Clinical content owner | Scope expansion |
| F33 Core reports | Staff | Daily care/stock summaries | Must Have | 1 | M | F09,F12 | Inflated totals |
| F34 Expanded analytics | Lead/BHW | Coverage and community planning | Should Have | 3 | H | F25,denominators | Misleading percentages |
| F35 Configuration lifecycle | Admin/lead | Safe master-data changes | Must Have | 1 | M | F24 | Unreviewed activation |
| F36 Interoperability | Clinics | External exchange | Future | V2+ | H | Agreements,identifiers | Semantic mismatch |
| F37 Sensors/hardware | Inventory staff | Automated readings | Future | V2+ | H | F14,device support | Unreliable telemetry |

## 11. Final Phase Roadmap

### Phase 1 — MVP: one working clinic

Implement F01–F10, F12, basic F15, F16–F17, F19, F21, F23–F24, F33 and F35. The shared table in Section 10 supplies value, dependency, complexity and risk for every feature. These belong together because the record cannot be trusted without identity, clinical provenance, stock linkage, correction and access controls.

The MVP supports online staff recording, a simple approved routine schedule, appointments, walk-ins, a daily queue, receipts/certificates, basic inventory receiving/use/wastage/adjustment, and core reports. Guardians can enter a new provisional child and report external history; staff verify linkage and clinical evidence. The MVP has printable outage forms and later-entry reconciliation. It does **not** claim full offline clinical operation.

Use a controlled schedule import with review and activation instead of a general-purpose visual medical rule builder. Include a basic future-proof schema, but create Phase 2/3 feature tables only when their modules are built. A student demo may use explicitly fictional vaccine rules and stock.

**Exit gate:** one complete synthetic journey; race-condition and permission tests pass; corrections preserve history; backup restores successfully; staff can operate the paper fallback. A real-data online pilot additionally requires approved clinical configuration, privacy review, lawful processing arrangements, training and support ownership.

### Phase 2 — Clinic Intelligence

Add F11, F13–F14, expanded F15, F18, F20 and F22. These require stable online facts, notification ownership and reconciliation. Release offline writes behind a per-clinic/device flag, initially one designated offline writer per station. Extend only after multi-device conflict tests and supervised trials pass.

**Exit gate:** concurrent last-dose and duplicate-sync tests; stale-rule and revoked-device handling; unresolved exceptions visible; SMS delivery and check-in escalation drills. Check-ins remain disabled if nobody owns incoming responses.

### Phase 3 — Community & Advanced Features

Add F25–F29, F31 and F34. These depend on mature identity, area assignments, content review and lawful inter-clinic access. Growth interpretation and coverage denominators need domain validation. Basic English/Filipino interface labels are already supported in Phase 1; additional reviewed languages expand here.

### Future / V2+

F30, F32, F36 and F37 follow actual demand and operating agreements. Do not commit to national integration, sensors or advanced analytics as capstone prerequisites. Reassess value with pilot evidence before development.

**Planning assumption:** a 3–5 person student team can organize Phase 1 into 6–8 short iterations. Treat this as sequencing guidance, not a delivery promise; clinical approval and stakeholder availability may dominate elapsed time.

## 12. System Modules

| Module | Responsibility | Explicit boundary |
|---|---|---|
| Identity/access | Accounts, capabilities, clinic assignment, guardian linkage | Does not decide clinical validity |
| Child registry | Demographics, identity evidence, duplicate review | Does not copy health history into guardian profiles |
| Clinical record | Administration events, historical evidence, amendments | Actual care remains distinct from schedule credit |
| Schedule service | Approved routine/catch-up evaluation | Does not book slots or independently clear a patient |
| Appointment/queue | Capacity, arrival, service states | Does not mark vaccine completed |
| Inventory | Lots, balances derived from ledger, disposition | Does not erase stock use when a record is corrected |
| Communication/content | Outbox, delivery, reviewed material | Does not diagnose messages |
| Certificates | Immutable issued snapshots, revocation and verification | Does not publicly expose the child's record |
| Offline/sync | Device data pack, local queue, reconciliation | Does not bypass present server authorization |
| Community/transfer | Assignments, visits, controlled access handoff | Does not grant blanket barangay access |
| Reporting | Defined metrics and scoped exports | Uses canonical facts; no independent clinical truth |
| Governance/operations | Audit, configuration, backups, incident handling | Admin access remains separated from patient access |

Portals are role-specific views of these modules. Do not build four separate databases or duplicate the same child workflow for each portal.

## 13. System Architecture

### Recommended structure

```text
Guardian web/PWA       Clinic web/PWA       BHW web/PWA (Phase 3)
        \                    |                    /
         Next.js UI + authenticated route handlers
              | scoped reads | validated commands
              v              v
         Supabase Auth + PostgreSQL/RLS + transactional functions
              |             |                |
        Private files   Durable outbox   Audit + change feed
                            |
                 Bounded background worker
                  /          |           \
                SMS      certificates    reports

Clinic device (Phase 2): approved cache + encrypted IndexedDB outbox
                         <-> versioned synchronization API
```

| Technology/layer | Evaluation and responsibility |
|---|---|
| React | Appropriate for reusable forms, timelines, queue tables and interactive state |
| Next.js App Router | Appropriate for one full-stack app; server-render noninteractive views and keep offline interaction in client components |
| TypeScript | Shared contracts and status unions reduce mismatch; still validate every untrusted payload at runtime |
| Tailwind CSS | Consistent semantic tokens and responsive layouts; avoid one-off colors per page |
| Lucide | Consistent icons paired with text; icons never convey clinical status alone |
| Supabase Auth | Account/session identity; application tables determine current capabilities and record access |
| PostgreSQL/RLS | Relational source of truth; enforce transactions, constraints and row scope |
| IndexedDB | Structured local read pack and pending operations for enrolled staff devices; not a universal backup |
| Service Worker | Cache app shell and approved public guidance; assist reconnect but never assume it is always running |
| Vercel | Suitable Next.js hosting; persist no patient state in function memory or filesystem; verify current plan/runtime/region constraints before pilot |
| Worker/job layer | Claim durable database jobs, retry safely, track attempts; no endless process inside an HTTP request |

Put authoritative mutation rules in database commands plus a small application service layer. Ordinary multi-table Supabase client calls are not one transaction. A vaccination's event, stock issue and outbox entry must commit together through one database function.

Suggested source layout: `app/(public)`, `app/(guardian)`, `app/(clinic)`, `app/(bhw)`, `app/(admin)`, `app/api/v1`, `features/{registry,scheduling,visits,inventory}`, `lib/{auth,validation,offline}`, `supabase/{migrations,tests}`, and `tests/{integration,e2e}`. Route grouping is organization, not authorization.

Evaluate alternatives: a plain online-only CRUD app is simpler but misses reliability and clinical provenance; full multi-master replication and microservices add excessive complexity. The selected modular application supports a constrained offline queue without requiring distributed database engineering.

Server-rendered payloads must contain only fields the current actor may receive. Every route handler and server action authorizes its request independently; hiding a button is not a control. These boundaries follow the framework's server/client security model. [Next.js data security](https://nextjs.org/docs/app/guides/data-security)

## 14. User Roles and Permissions

**R** read; **W** permitted workflow command; **A** approve; **—** denied. Every grant is scoped to verified relationships or active clinic/assignment membership.

| Action | Guardian | Assistant | Clinical staff | BHW | Clinical lead | Technical admin |
|---|---|---|---|---|---|---|
| Own account/preferences | W | W | W | W | W | W |
| Linked child's history | R | Limited | R | Due-summary only | R | — |
| Child registration | Provisional | W | W | Referral only | W | — |
| Link guardian to existing child | Request | Verify if assigned | Verify if assigned | — | A/dispute review | — |
| Appointment/queue | Own booking | W | W | Assisted request | W | Configure only |
| Record vaccination | — | — | W | — | W if qualified | — |
| Verify outside evidence | Submit | — | W if granted | — | A | — |
| Amend signed clinical record | Request | — | Propose | — | A | — |
| Stock receiving/issue/adjustment | — | If inventory grant | If inventory grant | — | A exceptions | — |
| Publish clinical rules/content | — | — | Propose | — | A | Technical import only |
| Issue/revoke certificate | Download own | If issuer grant | If issuer grant | — | A | — |
| Area follow-up | Own response | Clinic list | Clinic list | Assigned only | Clinic summary | Aggregate only |
| Role/device management | Own sessions | — | — | — | Request clinical grant | W with review |
| Identifiable export | Own record | Limited grant | Authorized purpose | Assigned minimal list | A | — |
| Audit access | Own security events | — | Own relevant events | — | Clinical scope | Technical metadata |

Multi-role staff use an explicit active clinic and role context. A role assignment alone must not create a guardian relationship. Technical administrators cannot grant themselves clinical privileges without designated governance approval. A prototype may use fixed role presets; a flexible permission editor can wait.

## 15. End-to-End Workflows

### A. New guardian and child

1. Guardian reads the short privacy notice, creates an account using the configured verified contact method and chooses language/contact preferences.
2. Guardian adds a child with known details. A self-created profile is provisional. The app does not reveal names of matching existing children to an unverified user.
3. Staff review duplicate candidates and identity/guardianship evidence at the clinic or through an approved process. They create or link the canonical child and activate the guardian relationship.
4. System evaluates approved rules using birth-date certainty and verified history. Uncertain inputs display “Staff review needed.” The guardian can still request a clinic review visit.
5. Guardian selects an offered appointment window. Server reserves capacity atomically and writes an in-app confirmation. SMS is a later optional channel.
6. On arrival, staff scan the QR or search; confirm child identity; check in and allocate the day's queue ticket. Booking alone never issues an arrival number.
7. Clinician reviews history, eligibility, consent process and usable lot. Vaccination occurs under approved practice.
8. Clinician records the event. The server commits the clinical record, stock movement, audit event and notification job together.
9. The schedule is recalculated, history displays the result, and authorized staff may issue a printable verified record. Approved care instructions and contact details are available.
10. Follow-up tasks are created where policy requires. A configured post-vaccine check-in is only scheduled when that service is enabled and staffed.

### B. Walk-in, including no account or smartphone

Assistant searches existing records using name, birth date/age estimate, guardian and clinic reference. Staff inspect duplicate candidates before a minimal new registration. No birth certificate or phone is required as a software prerequisite. The assistant records the accompanying person's relationship, assigns an arrival ticket within the clinic's walk-in policy, and explains waiting or referral options. Clinician verifies the record and eligibility. Administration and stock are saved together. Printed care instructions and history substitute for a portal. Account linkage can happen later through verified invitation.

### C. Missed appointment or delayed vaccination

A scheduled job identifies elapsed appointments without check-in using a configurable grace policy. It marks the visit `no_show`, not the vaccine overdue. The schedule service separately evaluates each outstanding dose against approved due windows. Staff distinguish “vaccinated elsewhere,” “unable to contact,” “moved,” “declined for now,” and “clinical review.” Verified outside records are added before recalculation. In Phase 2, supported catch-up rules produce a draft with interval explanations; an authorized clinician confirms it. Staff/guardian select a new visit, notifications supersede stale reminders, and completion is tracked against the clinical dose requirement rather than the appointment alone.

### D. Recording after paper operation

Use pre-numbered contingency forms with actual administration date/time and vaccinator signature. When service returns, one assigned staff member searches the child and the paper reference before entry. Store `recorded_at` separately from `administered_at`, source `paper_reconciliation`, and the unique paper reference. A reviewer reconciles event count, lot use and remaining stock. Uncertain or conflicting events enter review without disappearing.

### E. Wrong record discovered

Staff flag the event, select the error category and supply a reason. A lead reviews evidence. Corrected clinical facts form a new version; the original remains. Schedule credits are recalculated. Certificates referencing the superseded version are revoked or replaced as required. Inventory receives a correction only if the physical stock facts changed. If the wrong child was selected, reattribution links both histories with restricted audit visibility and human review.

### F. Stock receiving to use

Inventory staff record delivery reference, product, manufacturer/lot, expiry, presentation, quantity and location. They confirm received units before stock becomes available. A usable lot is selected at vaccination; one administration issues its approved dose quantity. Wastage and adjustments require reason and source reference. Expired/quarantined lots remain in physical balance but are excluded from usable stock. A stock count reconciles book and observed quantities through an approved adjustment.

## 16. Vaccination Scheduling Engine

### Clinical policy versus software logic

Software stores and evaluates approved rules; it does not decide which medical rules are correct. Applicable vaccine schedules, products, age limits, intervals, contraindications, dose credit, product interchangeability, catch-up branches, routes, sites, completion definitions and care advice **Require external validation** by the designated clinical lead against current applicable Philippine DOH/NIP/EPI guidance and relevant product instructions. An official DOH regional program page identifies NIP implementation guidance, but does not establish that a specific downloaded schedule is the latest applicable policy. [DOH Immunization Program](https://ro11.doh.gov.ph/immunization-program/)

The project must obtain the authoritative document/version applicable at deployment. Store issuing authority, document reference, effective dates, reviewer, approval date and test cases. Do not ship invented medical values. For demonstrations, label synthetic rules “DEMO — NOT FOR CLINICAL USE” on configuration and schedule pages.

### Rule lifecycle

`draft → clinical_review → approved → active → retired`. An active version is immutable. Updating rules creates a new version and a preview of affected children. The approver chooses the documented migration policy, effective date and impacted cohort. Activation enqueues recalculation; old recommendations and event evaluations retain their original rule/version references. Previously booked appointments become “needs recheck” if their clinical basis changes; do not silently move bookings.

Use a small, typed rule vocabulary: calendar-age offset, minimum age, minimum interval from a named predecessor, maximum age where relevant, eligible product/antigen mapping, and explicit review conditions. Values carry units: days, weeks or calendar months. A month must not be implemented as an assumed number of days. Expressions that exceed the supported vocabulary require clinical review; no arbitrary administrator-written JavaScript or SQL.

### Evaluation sequence

1. Select the child's approved program/cohort and effective rule version.
2. Read birth date and its precision, verified administration history, product/antigen mappings, amendments, and active clinical review holds.
3. Evaluate which administration events satisfy each antigen-series requirement. One combination product may provide several credits; this still represents one physical administration and one stock issue.
4. Calculate the target date and earliest eligible date from the applicable rules. Conceptually, earliest eligibility is the latest of all applicable minimum-age and predecessor-spacing dates. Unknown required inputs prevent an exact recommendation.
5. Apply any supported maximum-age or other clinical restriction. If minimum/maximum constraints cannot be satisfied together, return `clinical_review_required`.
6. Return a clinical recommendation with target/due window, eligibility, credited history, rule version and explanation. Persist a reproducible calculation snapshot/hash.
7. Separately find practical appointment windows using operating days, holidays, service availability, capacity and reported usable stock. Lack of stock changes logistics, not clinical due status.
8. Revalidate at booking and again before administration. Staff confirm clinical assessment; the software's result is decision support.

**Automatic:** routine date arithmetic, outstanding requirements, supported interval checks, due worklists and offered slots. **Human confirmation:** uncertain history, contraindications/deferral, catch-up plan approval, disputed product credit, identity ambiguity and exceptional timing. “Override” is an accountable clinical exception, never an unrestricted bypass of all checks. Identity/authorization failures cannot be overridden by a clinical timing reason.

### Status model

Do not compress several facts into a single traffic-light value. Store separate axes: `clinical_status`, `verification_status`, `provenance`, `appointment_status`, and `sync_status`. Present one primary next-action label with secondary badges.

| Clinical label | Meaning and calculation | Text/icon/color treatment |
|---|---|---|
| Completed | Approved requirement has valid, verified credit under the evaluated version | Check icon + “Completed”; dark green |
| Not yet eligible | Today is before the earliest supported eligible date | Lock/calendar + date; neutral |
| Upcoming | Outstanding, no review block, target window starts in the future | Calendar + date; blue |
| Due today | Target is today under local calendar rules | Clock + “Due today”; amber |
| Due now | Within an approved due window; not completed | Clock + date range; amber |
| Overdue | Outstanding and past the approved due-window end or explicit program overdue threshold | Alert + “Overdue — contact clinic”; dark red |
| Staff review needed | Missing rule/input, unclear evidence, clinical hold or conflicting history | Review icon + explanation; violet/neutral |
| Not applicable | Approved program rule excludes this requirement; reason preserved | Minus icon + reason; neutral |

When a policy supplies a target date but no overdue threshold, show “Past recommended date — review with clinic”; do not invent a clinical cutoff. `Recorded elsewhere` is provenance, and `Pending verification` is an evidence status, not completion. `Pending sync` visibly qualifies every locally recorded event. A green appointment does not make a dose completed.

## 17. Appointment & Queue System

### Capacity and bookings

Define clinic sessions by local date, start/end time, service, total capacity, online allocation and walk-in allocation. Capacities are nonnegative and online plus reserved walk-in allocation cannot exceed total capacity. These are operational settings approved by the clinic; they are not medical rules.

One appointment represents one child's planned encounter and may reference multiple recommended dose requirements. Co-administration is never inferred merely because multiple items were booked. Use one active appointment per child/session, with duplicate-day warnings for intentional separate visits.

Booking locks the session capacity row, checks remaining allocation, creates the appointment and confirmation job, and commits. Cancellation releases its allocation in the same transaction. A reschedule moves capacity from old to new session atomically; if the new slot is unavailable, the original booking remains. No payment-style temporary holds are needed in MVP.

`confirmed → checked_in → fulfilled`, or `cancelled/no_show`; `rescheduled` links the old appointment to its replacement. Fulfilled means the planned encounter occurred and has an outcome, which may be vaccination, deferral or referral. It does not necessarily mean every planned dose was given.

### Arrival queue

Queue states: `waiting → called → in_service → completed`, with `held`, `left`, `cancelled` and `deferred` outcomes. Calls and re-calls create events. A short missed-call grace procedure moves a ticket to held; returning patients are reinserted according to published clinic policy. Late arrivals retain a history but may need a new service window. No-show rules apply to appointments, not unexplained absence from a future queue.

Allocate numbers atomically per clinic/local date. Numbers are never reused that day. The ticket displays a clinic/date prefix so yesterday's number is distinguishable. Estimated position is not the numeric difference between ticket numbers, because prioritization, holds and multiple service stations change order.

Walk-ins receive a ticket after registration and capacity review. Reserve a clinic-defined share of capacity for walk-ins, including patients without digital access. If all online slots are full, show alternative dates and assisted contact/walk-in guidance; do not promise same-day service. Authorized staff may open overflow capacity with a recorded reason and realistic staffing.

Clinical triage priority is set only by authorized staff under clinic policy with a reason. It is not sold and is not inferred from account type. Public displays show ticket numbers and stations only, never names, birthdays or vaccine types. Guardians see their own private status.

Estimate waiting time from recent service durations and active stations only when sufficient data exists. Show a range and “estimate, may change”; otherwise show people ahead. Realtime updates improve freshness, but reconnection/polling retrieves authoritative state.

During offline operation, a designated queue station owns the local queue. Multiple disconnected devices use prefixed temporary tickets, not competing claims to the same final daily number. Staff reconcile arrival records on reconnect. Final historical order preserves actual timestamps and uncertainty.

## 18. Vaccination Recording Workflow

### Required capture

| Field | Requirement and rationale |
|---|---|
| Child ID and encounter | Required; show name plus another approved identifier for confirmation |
| Product and vaccine source | Required for current administration; source distinguishes clinic stock from documented external supply |
| Actual administration date/time | Required for current event; timezone recorded; historical dates may have reduced precision |
| Series/dose association | Computed proposal reviewed by clinician; underlying antigen credits stored separately |
| Batch/lot and expiry snapshot | Required for clinic stock; linked lot supplies values rather than duplicate typing |
| Quantity/unit | Product-approved administered quantity and stock conversion; never assume all products use the same presentation |
| Route/site | Required only where approved clinical/product policy requires; controlled values plus documented exception |
| Administering clinician and clinic | Required; signed-in recorder defaults to self only if actually the vaccinator |
| Recorder and recorded time | Always server recorded, separate from actual vaccinator and administration time |
| Assessment/consent reference | Record completion/reference to the clinic-approved process; avoid unnecessary diagnostic detail |
| Clinical evaluation/rule version | Required to explain credit or review status |
| Notes | Optional, purpose-limited; not a substitute for structured fields |
| Provenance/evidence | Required for historical/outside records, with verifier and verification status |

No automatic “vaccinated” checkbox from appointment completion. “Save draft,” “Review administration,” and “Sign and record” are distinct. The final screen repeats child, product, lot, actual time and warnings. Changing child clears or explicitly rebinds the unsaved form; it never silently transfers the draft.

### Atomic online command

1. Authenticate and recheck active clinical capability and clinic-child access.
2. Validate payload and idempotency key; lock relevant child/encounter and stock balance rows in consistent order.
3. Detect possible duplicate event and stale versions; confirm usable lot and clinical checks for a planned administration.
4. Insert signed event and first immutable clinical version; apply verified dose credits where approved.
5. Insert exactly one physical administration stock issue (with multiple ledger legs only if the presentation demands it), encounter outcome, audit event and durable outbox jobs.
6. Commit, return canonical IDs and versions, then update UI. PDF/SMS generation happens asynchronously after commit.

If the nurse confirms the vaccine **has already been administered**, a failed timing, expiry or stock check must not make that fact unrecordable. Use an exception command capturing actual facts, reason and supervisor task. Unknown stock creates an unresolved reconciliation item rather than a fictional lot or a silently negative usable balance. No schedule credit is granted until evaluation permits it. The normal planned-administration path remains blocked from knowingly selecting unusable stock.

Adverse event concerns are separate linked clinical follow-up records with reporter, onset/report time, symptoms as reported, triage/review outcome and responsible person. An event after vaccination is not automatically caused by vaccination. Regulatory reporting criteria, forms and escalation timeframes **Require external validation**. The app must not invent an automated diagnosis.

## 19. Vaccine Inventory System

### Ledger, not editable counter

Maintain product, lot and location identity. Store physical movements as signed quantities in a defined stock unit; derive balance from their sum. A transactionally maintained balance table is a performance projection that can be rebuilt, never an independently edited truth.

`physical on-hand = receipts + accepted transfers-in + positive adjustments − administration issues − wastage − transfers-out − negative adjustments`.

`usable stock = physical on-hand in eligible condition/expiry/open-vial state − active allocations/reservations`.

Condition changes such as quarantine do not remove physical stock. A later documented discard creates the wastage movement. Expiry uses the approved interpretation of product expiry dates and any open-vial policy; these clinical/storage rules **Require external validation**.

| Operation | Rules |
|---|---|
| Receive | Delivery reference, product, lot, expiry, presentation, quantity, receiver, location and acceptance check |
| Administer | Linked to one event; reject duplicate movement key; use actual product conversion |
| Wastage/damage/discard | Reason category, quantity, lot, incident/source reference and authorized actor |
| Adjust | Physical count reference, expected/observed count, difference, reason and approval threshold |
| Transfer | Dispatch to in-transit location; receiver verifies quantity/condition; discrepancy remains open; do not count it in both usable balances |
| Quarantine/release | Reason, affected location/lot, reviewer and evidence; release requires appropriate authority |
| Recall | Immediately block future usable selection; identify affected administration events; supervised outreach list |
| Expiry | Exclude from usable availability; retain stock and disposition history until physically removed |
| Low stock | Configured threshold on usable stock with unresolved requisitions visible; no guaranteed delivery date |

MVP supports receipts, administration, wastage, adjustment, quarantine/recall marking and batch-use lookup. Inter-clinic stock transfer, threshold automation, forecasting and temperature logs extend in Phase 2.

Multi-dose products need explicit unit conversion and, where necessary, a vial-open record. A vial's opening, use and residual discard must balance. Do not equate “one vial” with “one dose.” To keep a demo small, use a declared single-presentation synthetic dataset; production support for multi-dose presentations must be enabled and tested before using those products.

Inventory correction follows physical facts. Correcting a misspelled vaccinator name changes no stock. Moving a genuine administration to the correct child changes no stock. Correcting a wrongly selected lot produces linked reversal/replacement movements. Voiding a data duplicate reverses only the duplicate stock issue; a dose actually wasted is classified as wastage, not returned to usable stock.

## 20. Offline-First Architecture

### Release boundary and device requirements

Phase 1 provides an online workflow, app-shell/public-guidance cache where useful, and paper fallback. Phase 2 permits clinical data caching and offline writes only on enrolled, approved staff devices. Guardian devices do not automatically retain a full health database. Offline access is a controlled capability, not the default for every login.

Offline mode requires a previously installed app, a powered device, a prepared data pack and an active offline operating grant. It cannot make an unprepared device function or supply electricity. UPS/battery availability and paper forms are clinic operations requirements.

| Data/action | Offline behavior |
|---|---|
| App shell and reviewed public care content | Cache versioned assets; no patient data in HTTP/service-worker cache |
| Staff's assigned session patients | Minimum encrypted identity/history/rules pack; display last synchronized time and expiry |
| Unrelated clinic registry or all barangay children | Never bulk cached by default |
| Today's queue | Designated device local queue; clear local-state label |
| Provisional new child | Permit minimum data with client-generated UUID; duplicate resolution after reconnect |
| New administration already performed | Permit append-only capture with known lot/allocation and evidence; label pending validation |
| Demographic correction | Store a proposed patch with base version; no silent overwrite |
| New online appointment capacity | Cannot confirm while offline; save request only |
| Guardian linkage, account recovery, roles | Online verified workflow required |
| Rule publication, merge, stock adjustment/transfer, signed certificate issuance | Online only |
| Local receipt | May print “PROVISIONAL — NOT YET SYNCHRONIZED”; not a final certificate |
| External history upload | Draft allowed within storage limits; verification online |

### Local model and protection

IndexedDB stores `read_pack`, `pending_operations`, `receipts`, `conflicts`, and `device_metadata`. Use UUIDs generated at creation as eventual server IDs rather than a fragile temporary-number replacement scheme. Each operation has a separate immutable operation UUID. Parent-child dependencies are explicit.

Encrypt clinical payloads using a reviewed Web Crypto design and per-device data key. Do not keep an unwrapped key beside ciphertext in IndexedDB. Unlock through an approved device/user method; keep plaintext and decrypted keys in memory only. A short PIN alone is not adequate protection against offline guessing. Device disk encryption, OS accounts, screen locks and controlled physical access remain required. Browser encryption does not protect an already-unlocked session from XSS or a compromised operating system.

For recovery, each pending payload also has a server-recoverable encrypted copy using the deployment's recovery public key; only an authorized recovery service holds its private key. This lets logout destroy local read access without silently destroying unsent events. Implement and test this before enabling offline writes; otherwise keep paper fallback.

**Lock** clears in-memory keys and hides records while retaining the user's sealed queue. **Logout** deletes the readable pack and local unlock material, ends the session, and retains only the sealed pending bundle plus minimal nonsensitive receipt metadata. If unsent items exist, explain their count and recovery route. Only an authenticated authorized recovery workflow may upload or review them; logging in as a different staff member grants no right to read them. After successful acknowledgement and retention policy, erase the sealed bundle.

Lost-device response revokes device grants/sessions, blocks future pack downloads, and flags potential exposure. Remote wipe cannot be guaranteed on a disconnected browser. Unsent data lost with the physical device may be unrecoverable; reconcile paper references, stock and staff recollection under clinical supervision.

Request persistent browser storage when supported, monitor quota failures and verify local transaction completion before showing “Saved on this device.” Browser storage can still be cleared; do not describe it as a durable clinical backup. Foreground and manual synchronization are mandatory because Background Sync has limited browser availability. [MDN Background Synchronization API](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API)

## 21. Synchronization & Conflict Resolution

### Operation envelope

`operation_id`, `device_id`, `actor_id`, `clinic_id`, `entity_id`, `operation_type`, `schema_version`, `base_version`, `rule_version_id`, `payload`, `payload_hash`, `client_occurred_at`, `client_sequence`, `dependency_ids`, and `offline_grant_id`. The server supplies receipt time; client clock is evidence, not authority for authorization or ordering. Never queue reusable passwords or a privileged service key.

### Explicit workflow

**Offline → Reconnect → Sync → Validate → Conflict Resolution → Final State**

1. **Offline:** commit the local event and its queue envelope in one IndexedDB transaction. Display `saved_locally`, pending count, cached-rule version and age. If storage fails, display “Not saved” and use paper.
2. **Reconnect:** establish actual API reachability, reauthenticate if required, check device/role/clinic authorization, and fetch critical revocations or rule/lot changes.
3. **Sync:** upload dependency-ordered bounded batches. One operation is one atomic server transaction; a failed operation does not undo unrelated accepted operations. Dependent operations wait for their prerequisites.
4. **Validate:** server checks actor, access, payload hash, schema, base version, clinical context, duplicate candidates and stock allocation. A unique operation key makes a retry return the original receipt. Same key with different payload is rejected as an integrity error.
5. **Conflict resolution:** preserve both submitted and current facts; assign a responsible reviewer. The client displays `needs_review` rather than falsely claiming completion. Reviewer outcomes are new audited commands with fresh IDs.
6. **Final state:** `accepted`, `accepted_with_review` or `rejected_preserved`. Download canonical IDs/versions, refresh authorized read pack, then remove acknowledged local plaintext. Rejected care evidence remains available to the restricted review workflow.

Do not confuse successful transport with accepted clinical credit. API acknowledgement means the server durably stored a receipt or exception; “Completed” requires an accepted clinical evaluation.

### Conflict rules

| Conflict | Resolution |
|---|---|
| Same request replayed | Return stored result; no additional vaccination, movement or notification |
| Two devices edit demographics | Compare base/current version; safely merge disjoint noncritical fields only; review overlapping or identity fields |
| Two devices capture same likely administration | Flag based on child/product/date/encounter evidence; reviewer distinguishes duplicate entry from actual repeat administration |
| Two actual administrations occurred | Preserve both; flag clinical review; software cannot undo physical care |
| Same child registered twice | Create duplicate candidate; link provisional dependent events during approved merge, retaining original IDs as aliases |
| Offline stock exceeds allocation | Preserve event; create stock discrepancy review; do not silently borrow another device's allocation |
| Rule/lot changed while offline | Reevaluate, retain actual event; flag affected clinical review/recall; do not rewrite past facts |
| User/device revoked before upload | Do not execute ordinary writes; send sealed evidence through restricted recovery intake for supervisor review, with original actor retained |
| Child transferred or guardian access revoked | Recheck scope; remove cached pack on reconnect; clinical evidence enters authorized reconciliation if relevant |
| Server restored to earlier backup | Use recovery epoch and receipt reconciliation; do not blindly replay all cached operations |

### Preventing offline stock oversubscription

Before a session, online allocation assigns a limited lot quantity to an enrolled device/station and reduces centrally available quantity. Local events consume that allocation. Server sync locks the allocation and consumes each operation once. Never automatically reclaim an expired allocation while its disconnected device may have unsent events. The supervisor closes it only after sync or physical reconciliation. A lost allocation is an exception to investigate, not newly available stock.

Assignments reduce clinical duplicate risk but cannot guarantee prevention when two devices are disconnected. Display recent local records, require identity/history confirmation and define a station handoff procedure. This limitation must be in training.

### Retry and change delivery

Retry transient network/5xx failures with exponential backoff and jitter, bounded by a configurable cap; honor provider/server `Retry-After`. Do not endlessly retry authorization or invalid-data errors. Provide a manual retry and human-readable last error. Database receipts persist long enough to cover the maximum supported offline/replay window and recovery policy; do not expire a key while old requests can still be replayed.

Download changes through an authorized sequence cursor, not device timestamps alone. Include tombstones/revoked access and paginate. Retention gaps or a changed recovery epoch force a fresh authorized pack. Cache status includes `fetched_at`, `expires_at`, rule version and server cursor. Expired clinical packs block decision-support reliance and direct staff to online or approved paper procedures.

## 22. Notification System

Business transactions write a durable outbox event. A worker translates it into recipient/channel messages after checking current appointment status, relationship, verified contact, language, preferences and template version. In-app delivery is Phase 1; SMS is Phase 2 through a configurable provider adapter.

Message types: confirmation, reminder, cancellation/reschedule, missed-visit follow-up, clinical recommendation changed, stock-unavailable notice, approved care/check-in, and later approved community announcement. Stock notices must offer clinic guidance without claiming a medical recommendation changed.

Templates have purpose, allowed placeholders, language, reviewer, version and activation status. Default SMS content is generic: clinic, appointment date/time and safe contact instructions. Avoid child name, birthday, vaccine details or health status in lock-screen messages and URLs. Preferences cover channel, language and approved contact times; essential care processing is not reduced to an SMS opt-in checkbox.

Deduplication key: business event + recipient + channel + template version/purpose. Rescheduling cancels obsolete unsent reminders and creates replacements. Check again immediately before sending. Delivery states: `queued`, `sending`, `accepted_by_provider`, `delivered`, `failed`, `unknown`, `cancelled`. Provider acceptance is not delivery, and delivery is not proof of reading or attendance.

Retry temporary failures; stop on invalid numbers or terminal rejection and create a staff follow-up task where warranted. Use provider idempotency if available. If a send times out after the provider may have accepted it, query delivery status or mark unknown; do not claim exactly-once external SMS delivery. Validate webhook authenticity and deduplicate provider callbacks.

A “24-hour” check-in is an optional configurable operational example, **not an approved universal clinical interval**. Timing, questions, concerning responses, response hours and escalation routes **Require external validation**. The page clearly states whether it is monitored and when; urgent-care instructions and contact numbers must be approved and locally verified. Nonresponse is a follow-up outcome, not a diagnosis.

## 23. Digital Vaccination Certificate

The MVP issues a **clinic vaccination record extract**. Calling it an officially recognized certificate requires confirmation of format, signatory authority and acceptance by the relevant institution: **Requires external validation**.

Layout: issuing clinic and address/contact; document title; unique certificate identifier; child name and approved identifying fields; verified administration table with dates/product/lot as appropriate; explicit source attribution for verified outside records; issue time; authorized issuer; document version; verification QR; and a short verification statement. Never include unverified history as certified fact. Signature/seal use must follow approved clinic authority, not a copied image chosen by a developer.

Issue from an immutable snapshot of specific verified clinical versions. Store a content hash, private PDF path and referenced versions. Reprints download the same issued document; replacements create a new certificate linked to the prior one. A lost copy need not trigger revocation unless exposure or replacement policy requires it.

The QR contains a high-entropy revocable token or URL, not child data. Public verification returns only document ID, issuer, issue date and current authenticity state (`valid`, `revoked`, `superseded`, `not_found`) with no child name, DOB or vaccination history. Rate-limit lookup and prevent indexing. A copied valid QR does not prove the rest of a paper is unchanged: an authorized recipient must compare the presented document against the authenticated canonical PDF/hash or a guardian-authorized restricted view. State this limitation on the verification screen.

Revocation records reason, actor and time; retains the original issued snapshot; and immediately updates verification. Corrections affecting certified facts create an issuer review task and revoke/supersede affected documents under policy. The server is the verification authority; an offline printed QR cannot prove the latest revocation status.

## 24. Record Transfer System

Within the same governed deployment, transfer changes care enrollment/access around the same canonical child ID. It does not copy the entire record into a second child. Guardian relationships are reviewed, not automatically revoked because the child moved.

1. **Request:** verified guardian or authorized staff names destination and reason.
2. **Identity verification:** match canonical identity and review duplicates; confirm the requester's authority.
3. **Sending approval:** authorized source clinic approves sharing scope and transfer summary under applicable policy.
4. **Receiving acceptance:** destination verifies identity, service scope and permission to receive.
5. **Prepare:** generate versioned manifest of relevant facts and attachments; exclude unnecessary unrelated data.
6. **Integrity check:** verify manifest hashes, counts, identifiers and pending exceptions.
7. **Commit:** in one transaction, activate destination enrollment, update primary-care enrollment and apply source access policy; append audit/event history.
8. **Complete:** notify permitted actors, cancel/reroute future bookings and follow-up tasks appropriately; retain provenance at original administering clinics.
9. **Failure/reversal:** pre-commit failures leave source enrollment intact; retry by transfer ID. After commit, reversal is a new approved compensating transfer, not deletion of history. Explain that downloaded copies cannot be recalled technically.

If source approval is unavailable, new care must not depend on an endless transfer wait. Use documented exceptional access and verification policy approved by clinical/privacy governance; preserve pending transfer status and evidence. Do not invent universal access rights.

Separate organizations/databases require data-sharing arrangements and secure export/import with mapping, signature/hash verification and duplicate review. This is future interoperability, not the same-deployment Phase 3 handoff. Legal basis, retention and sharing terms **Require external validation**.

## 25. Growth Tracking

Phase 3 stores observed date/time, weight with unit, length/height with measurement method and unit, measurer, clinic, source and notes relevant to measurement quality. Optional measurements require a clear clinical purpose. Parent-reported values remain distinguishable from staff measurements.

Use raw measurements first; show trends with accessible tables. Flag improbable values for confirmation using clinician-approved plausibility ranges without silently deleting them. A correction preserves the original value and reason.

Any percentile/z-score requires an approved growth reference, version, required inputs, age calculation and applicable population. Sex-related reference inputs and unknown values must follow that reference's approved handling. The app must not diagnose malnutrition or growth disorders from an unvalidated chart. Growth reference choice, interpretation and referral guidance **Require external validation**.

## 26. BHW / Community Features

Phase 1 clinic staff already have a due/overdue worklist. Phase 3 adds BHW area and child assignment, household grouping, visit planning, follow-up outcomes and supervisor review.

The BHW sees assigned child's minimum identifying/contact information, due-action summary, preferred language and contact restrictions. Detailed clinical notes, all certificates and unrestricted vaccine history are not automatically included. Address proximity or same barangay alone does not authorize access.

Follow-up outcomes include contacted, appointment assistance requested, reported vaccinated elsewhere, moved, declined contact, unavailable and referred to clinic. “Reported vaccinated elsewhere” creates evidence review, not completed vaccination. Record visit date, assigned worker, outcome and next task; avoid unnecessary GPS tracking or photographs. Household membership does not grant access to every member's health record.

Outreach lists are purpose-limited, time-bounded and auditable. Paper exports show only needed fields and are logged. A community summary uses aggregates and small-cell controls. Use “Children needing follow-up” instead of labeling families “defaulters.” Campaign messages require approved audience, clinical content, sender and frequency policy before future release.

## 27. Reporting & Analytics

| Report | Audience and scope | Identifiability | Definition/guardrail |
|---|---|---|---|
| Daily administrations | Clinic clinical staff | Named when operationally needed | Actual events by administration date; exclude voided data duplicates; separate historical entries |
| Appointments | Clinic scheduling staff | Named clinic list | Booked, cancelled, attended, no-show by visit date; denominator documented |
| Queue performance | Supervisor | Aggregate default | Check-in to start and service duration; separate abandoned/held encounters |
| Due/overdue children | Staff, assigned BHW subset | Identifiable | Approved rule/version and as-of date; unresolved history listed separately |
| Inventory balance | Inventory staff | No child data | Physical, usable, allocated, quarantine and in-transit separately |
| Expiry/wastage | Inventory staff | No child data | Product/lot/date/reason; unit conversion explicit |
| Batch use/recall | Authorized clinical lead | Identifiable restricted | Lot → actual administration → child; historical missing-lot cases visible |
| Clinic activity | Administrator/lead | Aggregate | Encounters, actual administrations and unique children are separate measures |
| Consumption | Inventory/admin | Aggregate | Administration issues versus wastage/adjustments, not one combined total |
| Vaccination coverage | Approved program lead | Aggregate | Eligible resident cohort denominator, period, geography, dose definition, source and exclusions |
| Missed-dose patterns | Lead | Aggregate | Distinguish appointments missed, requirements overdue and unreachable contacts |
| Community follow-up | BHW/supervisor | Assigned list or aggregate | Assignment period and unresolved outcomes |
| Monthly/quarterly summary | Authorized reporting staff | Aggregate unless approved form needs IDs | Versioned report definition; output format requires receiving authority validation |

Do not calculate population coverage as vaccinated children divided by app registrations unless explicitly labeled “coverage among registered eligible children.” Handle transfers, deaths/inactive care, duplicates and verified outside doses according to the approved denominator methodology. One combination-product administration may satisfy multiple antigen metrics but counts once as an administration.

Every report carries filters, local date range, as-of time, definition version, preparation status and data-quality notes. Later corrections can change results; preserve issued report snapshots where official submission policy requires. Export requests capture purpose and scope; large reports run as jobs with private expiring downloads. Escape spreadsheet-formula-leading cells in CSV exports. Suppress small cells and related totals where needed to prevent deduction; thresholds **Require external validation** by the privacy owner.

## 28. Database Architecture

### 28.1 Conventions and integrity rules

This is a logical relational schema, not an executable migration. Build only the tables used by the released phase. Tables marked **P2** or **P3** are deferred. Small code lists can be checked text values rather than dedicated tables.

**Notation:** `u` UUID, `t` text, `ts` timestamptz, `d` date, `i` integer, `n` numeric, `b` boolean, `j` JSONB. `?` means nullable; other listed fields are required. `FK table` means a foreign key to that table's primary key. `UQ` means unique constraint. Text statuses use explicit CHECK constraints and legal transitions in commands. JSON is limited to versioned structured rules, snapshots, immutable evidence and metadata; it does not replace ordinary relationships.

**Common base B:** unless an exception is stated, each table has `id:u PK`, `organization_id:u FK organizations`, `created_at:ts` server default, and `created_by:u? FK profiles`. Actor is required for human-created records; a null actor requires a trusted system-job identity in audit. Mutable tables additionally have **M**: `updated_at:ts`, `updated_by:u? FK profiles`, `version:i default 1 CHECK >0`. Commands increment version. `deleted_at:ts?` exists only where explicitly listed. Immutable tables have B only and no ordinary UPDATE/DELETE grants.

**Tenant consistency:** organization-scoped parents have `UQ(organization_id,id)`. Child relations use composite `(organization_id,foreign_id)` FKs so an authorized application bug cannot reference another organization. `profiles` are global account records; membership, not a profile organization column, determines tenancy. Reference geography may be shared. Clinic consistency is checked by composite keys where appropriate and by transactional commands for cross-table relationships.

All times are UTC timestamps with timezone; DOB, vaccine expiry and clinic service date are `date` values. Display and interpret local clinic calendars using configured IANA timezone, default `Asia/Manila`. Names use Unicode text and never serve as unique keys. All mutable records have optimistic version checks. Foreign keys default to RESTRICT for clinical and audit relationships; no cascading deletion of clinical history.

### 28.2 Identity, governance and registry

| Table/base/phase | Columns beyond base | Constraints and principal indexes |
|---|---|---|
| `organizations` (M-like; no org FK, P1) | `id PK`, `name:t`, `status:t`, `created_at:ts`, `updated_at:ts`, `version:i` | One configured organization in MVP; active status required for normal writes |
| `profiles` (global, P1) | `id:u PK FK auth.users`, `display_name:t`, `locale:t`, `status:t`, `created_at:ts`, `updated_at:ts`, `version:i` | No duplicated password table; status active/suspended/deactivated; contact authentication lives in Auth |
| `barangays` (reference, P1) | `id:u PK`, `official_code:t?`, `name:t`, `municipality:t`, `province:t` | UQ official code when present; verify geography source/version before import |
| `clinics` (B+M, P1) | `name:t`, `barangay_id:u FK barangays`, `timezone:t`, `contact_text:t?`, `address:t`, `status:t`, `operational_policy:j` | Index organization/status; policy JSON has a fixed schema and no clinical rules |
| `staff_memberships` (B+M, P1) | `profile_id:u FK profiles`, `clinic_id:u FK clinics`, `role_code:t`, `capabilities:j`, `valid_from:ts`, `valid_until:ts?`, `status:t`, `approved_by:u FK profiles` | Index profile/clinic/status; one active same-role membership per person/clinic; capability list validated against fixed server vocabulary |
| `guardians` (B+M, P1) | `profile_id:u? FK profiles`, `full_name:t`, `preferred_language:t`, `contact_phone:t?`, `contact_email:t?`, `contact_verified_at:ts?`, `contact_status:t`, `deleted_at:ts?` | Partial UQ organization/profile when nonnull; contact NOT globally unique because families share phones |
| `children` (B+M, P1) | `local_record_no:t`, `display_name:t`, `given_names:t?`, `family_name:t?`, `dob:d?`, `birth_date_precision:t`, `estimated_birth_start:d?`, `estimated_birth_end:d?`, `sex_for_clinical_reference:t?`, `barangay_id:u? FK barangays`, `address_text:t?`, `birth_details:j?`, `record_status:t`, `merged_into_id:u? FK children`, `deleted_at:ts?` | UQ organization/local number; DOB not future; precision matches exact/estimated/unknown fields; merge not self/cyclic; indexes organization/name search, DOB and barangay/status |
| `guardian_child_relationships` (B+M, P1) | `guardian_id:u FK guardians`, `child_id:u FK children`, `relationship:t`, `status:t`, `access_scope:t`, `verification_method:t?`, `verified_by:u? FK profiles`, `verified_at:ts?`, `starts_at:ts`, `ends_at:ts?` | One active pair; active relationship requires verified basis; index child/status and guardian/status; no automatic family-wide access |
| `child_clinic_enrollments` (B+M, P1) | `child_id:u FK children`, `clinic_id:u FK clinics`, `status:t`, `is_primary:b`, `access_scope:t`, `starts_at:ts`, `ends_at:ts?`, `basis:t` | One active pair and at most one active primary enrollment per child; closed enrollment preserves administering-clinic provenance without blanket future access |
| `record_review_cases` (B+M, P1) | `kind:t`, `child_id:u? FK children`, `candidate_child_id:u? FK children`, `vaccination_event_id:u? FK vaccination_events`, `operation_id:u? FK command_receipts`, `assigned_to:u? FK profiles`, `status:t`, `reason:t`, `evidence:j`, `resolution:j?`, `resolved_by:u? FK profiles`, `resolved_at:ts?` | Types duplicate/link/correction/clinical/stock/sync; type-specific required references; index scope/status/assignee; generic case routing, clinical truth remains in domain tables |
| `qr_passes` (B+M, P1) | `child_id:u FK children`, `token_hash:t`, `status:t`, `issued_at:ts`, `expires_at:ts?`, `revoked_at:ts?` | UQ token hash; one active pass per configured pass type; hash indexed; never return child to anonymous caller |
| `privacy_records` (B, P1) | `guardian_id:u? FK guardians`, `child_id:u? FK children`, `purpose:t`, `record_type:t`, `notice_version:t`, `decision:t`, `recorded_at:ts`, `evidence_ref:t?` | At least one subject; append new withdrawal/change record; distinguish notice acknowledgement, contact choice, clinical consent evidence and lawful-basis documentation |

Do not create separate `users`, `health_workers` and `nurses` tables with duplicate login identity. `auth.users` authenticates; `profiles` displays account identity; `staff_memberships` authorizes clinic work; `guardians` also represents people without accounts.

### 28.3 Clinical master data and records

| Table/base/phase | Columns beyond base | Constraints and principal indexes |
|---|---|---|
| `antigens` (B+M, P1) | `code:t`, `name:t`, `status:t` | UQ organization/code; stable code never repurposed |
| `vaccine_products` (B+M, P1) | `code:t`, `name:t`, `manufacturer:t?`, `presentation:t`, `stock_unit:t`, `doses_per_container:n`, `administration_unit:t`, `policy_reference:t`, `status:t` | UQ code; positive conversion; immutable presentation/conversion once used—new version/product record for substantive change |
| `product_antigens` (B, P1) | `product_id:u FK vaccine_products`, `antigen_id:u FK antigens` | UQ product/antigen; approved mapping required |
| `schedule_versions` (B+M until active, P1) | `program_code:t`, `version_label:t`, `status:t`, `effective_from:d`, `effective_to:d?`, `cohort_predicate:j`, `source_reference:t`, `source_hash:t?`, `reviewed_by:u? FK profiles`, `approved_at:ts?`, `supersedes_id:u? FK schedule_versions` | UQ program/version; activation checks overlapping cohort/effective rules and approval; active immutable |
| `schedule_rules` (B, P1) | `schedule_version_id:u FK schedule_versions`, `requirement_code:t`, `antigen_id:u FK antigens`, `series_code:t`, `dose_ordinal:i`, `target_offset_value:i?`, `target_offset_unit:t?`, `minimum_age:j?`, `maximum_age:j?`, `due_window:j?`, `review_conditions:j`, `accepted_products:j` | UQ version/requirement; dose ordinal positive; typed JSON validated; unspecified clinical limit stays unknown, not zero |
| `schedule_rule_dependencies` (B, P1) | `rule_id:u FK schedule_rules`, `predecessor_rule_id:u FK schedule_rules`, `minimum_interval_value:i`, `interval_unit:t` | UQ pair; same version unless explicitly supported; nonnegative interval; dependency graph must be acyclic |
| `child_programs` (B+M, P1) | `child_id:u FK children`, `schedule_version_id:u FK schedule_versions`, `starts_on:d`, `ends_on:d?`, `status:t`, `assignment_reason:t` | One active version per child/program; assignment changes audited |
| `encounters` (B+M, P1) | `child_id:u FK children`, `clinic_id:u FK clinics`, `appointment_id:u? FK appointments`, `service_date:d`, `started_at:ts?`, `ended_at:ts?`, `status:t`, `outcome:t?`, `assessment_reference:t?`, `consent_reference:t?` | Index clinic/date/status and child/date; final outcome required on completion |
| `vaccination_events` (B, P1) | `original_child_id:u FK children`, `encounter_id:u? FK encounters`, `origin:t`, `external_provider:t?`, `external_reference:t?`, `paper_reference:t?`, `source_operation_id:u FK command_receipts` | UQ source operation; partial UQ clinic-scoped paper reference via command/encounter; current attributed child is in latest revision |
| `vaccination_revisions` (B, P1) | `event_id:u FK vaccination_events`, `revision_no:i`, `child_id:u FK children`, `product_id:u? FK vaccine_products`, `reported_product_text:t?`, `administered_on:d?`, `administered_at:ts?`, `date_precision:t`, `lot_id:u? FK vaccine_lots`, `reported_lot:t?`, `expiry_snapshot:d?`, `quantity:n?`, `unit:t?`, `route:t?`, `site:t?`, `administered_by:u? FK profiles`, `external_vaccinator:t?`, `clinic_id:u? FK clinics`, `source:t`, `verification_status:t`, `event_status:t`, `reason:t?`, `approved_by:u? FK profiles`, `signed_at:ts?` | UQ event/revision; current is highest accepted revision, never a second editable copy; current local administration requires product/time/clinician/clinic/lot or explicit exception case; outside unknowns allowed; index child/admin date and lot |
| `record_attachments` (B+M verification lifecycle only, P1) | `child_id:u FK children`, `event_id:u? FK vaccination_events`, `case_id:u? FK record_review_cases`, `storage_path:t`, `mime_type:t`, `byte_size:i`, `sha256:t`, `source:t`, `verification_status:t`, `verified_by:u? FK profiles` | UQ storage path; original object/hash/source immutable; verification changes audited; replacement evidence creates new row; positive bounded size; malware/type review before display; upload never grants dose credit |
| `schedule_evaluations` (B, P1) | `child_id:u FK children`, `schedule_version_id:u FK schedule_versions`, `as_of_date:d`, `engine_version:t`, `input_hash:t`, `result:j`, `evaluated_at:ts` | UQ child/version/as-of/engine/input hash; index child/evaluated time; result contains typed per-requirement dates, explanation and cited revisions |
| `dose_credits` (B, P1) | `evaluation_id:u FK schedule_evaluations`, `rule_id:u FK schedule_rules`, `vaccination_revision_id:u FK vaccination_revisions`, `credit_status:t`, `reason:t` | UQ evaluation/rule; revisions may satisfy multiple distinct antigens; only completed evaluations define current credit |
| `clinical_holds` (B+M, P1) | `child_id:u FK children`, `rule_id:u? FK schedule_rules`, `reason_code:t`, `restricted_note:t?`, `starts_at:ts`, `review_on:d?`, `status:t`, `resolved_by:u? FK profiles` | Index child/status; guardian receives appropriate next-action wording, not all restricted notes |
| `catchup_plans` (B+M, P2) | `child_id:u FK children`, `evaluation_id:u FK schedule_evaluations`, `status:t`, `reviewed_by:u? FK profiles`, `approved_at:ts?`, `expires_at:ts?`, `rationale:t` | Approved plan pins evaluated inputs; changed history invalidates pending recommendation |
| `catchup_plan_items` (B, P2) | `plan_id:u FK catchup_plans`, `rule_id:u FK schedule_rules`, `earliest_on:d?`, `recommended_on:d?`, `review_required:b`, `explanation:t` | UQ plan/rule; recommended not earlier than earliest when both known |
| `followup_cases` (B+M, P2) | `child_id:u FK children`, `event_id:u? FK vaccination_events`, `reported_by:u? FK profiles`, `reported_at:ts`, `onset_at:ts?`, `reported_concern:t`, `status:t`, `assigned_to:u FK profiles`, `review_outcome:t?`, `escalation_reference:t?` | Restricted clinical access; index clinic-derived scope/status/assignee; no inferred causation |

The rule engine may return uncertain results; null clinical dates are legitimate when evidence is incomplete. Do not create a fake administration to satisfy a required date field. Proposed corrections live in review cases; only signed initial versions and approved corrections enter `vaccination_revisions`. Thus the highest accepted revision is unambiguous. Each evaluation records exact input revision IDs, and commands enforce that its credits reference rules from its own approved schedule version. If no approved version exists, visits and factual recording remain possible under clinic practice, but calculated clinical clearance and completion claims stay unavailable.

### 28.4 Visits and inventory

| Table/base/phase | Columns beyond base | Constraints and principal indexes |
|---|---|---|
| `clinic_sessions` (B+M, P1) | `clinic_id:u FK clinics`, `service_date:d`, `starts_at:ts`, `ends_at:ts`, `service_code:t`, `total_capacity:i`, `online_capacity:i`, `walkin_capacity:i`, `status:t` | End after start; capacity checks; index clinic/date/service; booking lock target |
| `clinic_calendar_exceptions` (B+M, P1) | `clinic_id:u FK clinics`, `on_date:d`, `status:t`, `reason:t`, `replacement_session_id:u? FK clinic_sessions` | Index clinic/date; closure does not silently cancel bookings—command creates follow-up work |
| `appointments` (B+M, P1) | `child_id:u FK children`, `session_id:u FK clinic_sessions`, `booked_by:u FK profiles`, `channel:t`, `status:t`, `reason:t?`, `replaces_id:u? FK appointments`, `checked_in_at:ts?` | Partial UQ child/session for active statuses; index session/status; server atomically counts/updates capacity |
| `appointment_items` (B, P1) | `appointment_id:u FK appointments`, `rule_id:u? FK schedule_rules`, `purpose:t` | UQ appointment/rule when present; review-only appointment permits null rule |
| `queue_entries` (B+M, P1) | `child_id:u FK children`, `clinic_id:u FK clinics`, `service_date:d`, `appointment_id:u? FK appointments`, `encounter_id:u? FK encounters`, `ticket_no:i`, `station:t?`, `status:t`, `priority_code:t`, `priority_reason:t?`, `arrived_at:ts`, `called_at:ts?`, `service_started_at:ts?`, `completed_at:ts?` | UQ clinic/date/ticket; one active child/clinic/date queue entry; priority reason conditionally required; index clinic/date/status |
| `queue_events` (B, P1) | `queue_entry_id:u FK queue_entries`, `from_status:t?`, `to_status:t`, `occurred_at:ts`, `reason:t?` | Index entry/time; append-only |
| `vaccine_lots` (B+M, P1) | `product_id:u FK vaccine_products`, `manufacturer_lot:t`, `expires_on:d`, `manufacturer:t`, `global_disposition:t`, `policy_version:t` | UQ product/manufacturer/lot; index expiry/disposition; mistaken master data corrected only by reviewed command |
| `stock_locations` (B+M, P1) | `clinic_id:u FK clinics`, `name:t`, `kind:t`, `status:t` | UQ clinic/name; kind usable/quarantine/in_transit/allocated as configured; physical location and condition separately understood |
| `stock_transactions` (B, P1) | `type:t`, `source_reference:t`, `event_id:u? FK vaccination_events`, `reason:t?`, `approved_by:u? FK profiles`, `operation_id:u FK command_receipts`, `reverses_id:u? FK stock_transactions` | UQ operation; each posting has one command receipt; correction chains retained |
| `stock_movements` (B, P1) | `transaction_id:u FK stock_transactions`, `location_id:u FK stock_locations`, `lot_id:u FK vaccine_lots`, `quantity_delta:n`, `unit:t`, `movement_key:t`, `occurred_at:ts` | UQ organization/movement_key; delta nonzero; unit matches lot product; index location/lot/time; transfers balance across ledger legs |
| `stock_balances` (projection, B+M, P1) | `location_id:u FK stock_locations`, `lot_id:u FK vaccine_lots`, `on_hand:n`, `allocated:n`, `condition:t`, `reconciled_at:ts?` | UQ location/lot; nonnegative controlled balance; updated only in ledger transaction; rebuild and reconcile from authoritative movements/allocations |
| `vial_sessions` (B+M, P2 or product-support gate) | `lot_id:u FK vaccine_lots`, `location_id:u FK stock_locations`, `container_reference:t`, `opened_at:ts`, `opened_by:u FK profiles`, `usable_until:ts?`, `status:t`, `policy_version:t` | UQ container reference per location; residual stock reconciliation; required before real multi-dose/open-vial use |
| `stock_transfers` (B+M, P2) | `from_location_id:u FK stock_locations`, `to_location_id:u FK stock_locations`, `status:t`, `manifest:j`, `dispatched_at:ts?`, `received_at:ts?`, `dispatch_transaction_id:u? FK stock_transactions`, `receipt_transaction_id:u? FK stock_transactions`, `discrepancy:t?` | Source differs from destination; typed manifest of lot/quantity references; mismatch requires review |
| `inventory_policies` (B+M, P2) | `clinic_id:u FK clinics`, `product_id:u FK vaccine_products`, `low_stock_threshold:n`, `review_window_days:i`, `approved_policy_reference:t` | UQ clinic/product; nonnegative settings; separate from medical dose rules |
| `temperature_readings` (B+M review lifecycle only, P2) | `location_id:u FK stock_locations`, `measured_at:ts`, `temperature:n`, `unit:t`, `device_reference:t?`, `policy_reference:t`, `review_status:t`, `incident_case_id:u? FK record_review_cases` | Original measured values immutable; review changes audited; erroneous readings retained with correction evidence in linked case; index location/time; approved thresholds external; no invented temperature range |

An inventory projection's nonnegative constraint cannot justify rejecting evidence of real care: exception intake stores the event and unresolved stock case until a valid reconciliation posting exists. Normal commands may not bypass this distinction.

### 28.5 Communication, certificates and synchronization

| Table/base/phase | Columns beyond base | Constraints and principal indexes |
|---|---|---|
| `content_versions` (B+M until published, P1) | `content_key:t`, `language:t`, `version_label:t`, `body:t`, `kind:t`, `source_reference:t`, `reviewed_by:u? FK profiles`, `review_due_on:d?`, `status:t` | UQ key/language/version; published immutable; includes approved care and notification templates |
| `contact_preferences` (B+M, P1) | `guardian_id:u FK guardians`, `purpose:t`, `channel:t`, `enabled:b`, `language:t`, `preferred_window:j?` | UQ guardian/purpose/channel; no assumption consent to every purpose |
| `outbox_jobs` (B+M, P1) | `job_type:t`, `aggregate_type:t`, `aggregate_id:u`, `dedupe_key:t`, `payload:j`, `status:t`, `available_at:ts`, `attempt_count:i`, `locked_until:ts?`, `last_error_code:t?` | UQ organization/dedupe key; index status/available time; polymorphic payload validated by command type; no independent clinical facts |
| `notifications` (B+M, P1) | `recipient_guardian_id:u? FK guardians`, `recipient_profile_id:u? FK profiles`, `child_id:u? FK children`, `template_version_id:u FK content_versions`, `channel:t`, `event_key:t`, `status:t`, `scheduled_at:ts`, `read_at:ts?` | Exactly one recipient; UQ event/recipient/channel/template; index recipient/status and scheduled time |
| `notification_attempts` (B, P2 SMS; P1 if needed) | `notification_id:u FK notifications`, `attempt_no:i`, `provider:t`, `provider_message_id:t?`, `requested_at:ts`, `result:t`, `error_code:t?`, `destination_masked:t` | UQ notification/attempt; partial unique provider/message ID; provider callbacks stored as audited state updates with deduplication |
| `certificates` (B+M lifecycle only, P1) | `child_id:u FK children`, `clinic_id:u FK clinics`, `certificate_no:t`, `snapshot:j`, `content_hash:t`, `private_pdf_path:t?`, `verification_token_hash:t`, `status:t`, `issued_at:ts?`, `issuer_id:u FK profiles`, `replaces_id:u? FK certificates`, `revoked_at:ts?`, `revocation_reason:t?` | UQ certificate number and token hash; snapshot immutable; issued requires PDF/hash/issuer; status pending/issued/revoked/superseded/failed |
| `certificate_items` (B, P1) | `certificate_id:u FK certificates`, `vaccination_revision_id:u FK vaccination_revisions` | UQ pair; enables correction impact lookup |
| `command_receipts` (B, P1; finalized transactionally) | `operation_key:u`, `actor_id:u FK profiles`, `device_id:u? FK enrolled_devices`, `command_type:t`, `payload_hash:t`, `status:t`, `result:j`, `received_at:ts`, `completed_at:ts?` | UQ organization/operation key; actor and hash must match retry; denied users cannot retrieve another actor's receipt |
| `enrolled_devices` (B+M, P2) | `clinic_id:u FK clinics`, `device_public_id:u`, `label:t`, `status:t`, `last_seen_at:ts?`, `revoked_at:ts?`, `recovery_key_version:t` | UQ public ID; online enrollment and reapproval |
| `offline_grants` (B+M, P2) | `device_id:u FK enrolled_devices`, `profile_id:u FK profiles`, `clinic_id:u FK clinics`, `scope:j`, `issued_at:ts`, `expires_at:ts`, `status:t`, `rule_pack_hash:t` | End after issue; device/user/clinic consistent; signed grant never substitutes for reconnect authorization |
| `stock_allocations` (B+M, P2) | `grant_id:u FK offline_grants`, `location_id:u FK stock_locations`, `lot_id:u FK vaccine_lots`, `allocated_quantity:n`, `consumed_quantity:n`, `status:t`, `closed_at:ts?` | Nonnegative; consumed <= allocated; locked consumption and reviewed closure |
| `sync_intake` (B, P2) | `device_id:u FK enrolled_devices`, `claimed_actor_id:u FK profiles`, `operation_key:u`, `payload_hash:t`, `sealed_payload_path:t?`, `receipt_id:u? FK command_receipts`, `intake_status:t` | UQ device/operation key; preserve rejected evidence; normal clients cannot read others' sealed payloads |
| `change_feed` (B, P2) | `sequence:bigint`, `entity_type:t`, `entity_id:u`, `entity_version:i`, `change_kind:t`, `scope_reference:j`, `recovery_epoch:u` | UQ organization/sequence; cursor index; no PHI payload broadcast; server rechecks access |
| `audit_logs` (B, P1) | `actor_id:u? FK profiles`, `actor_capability:t`, `action:t`, `entity_type:t`, `entity_id:u`, `before:j?`, `after:j?`, `reason:t?`, `server_time:ts`, `request_id:u`, `device_id:u?`, `session_reference:t?`, `outcome:t`, `system_job_id:u?` | Index entity/time, actor/time, request; immutable to app roles; actor or trusted system job required; no tokens/passwords |
| `report_runs` (B+M, P1) | `requested_by:u FK profiles`, `report_type:t`, `definition_version:t`, `filters:j`, `purpose:t`, `as_of_at:ts`, `status:t`, `storage_path:t?`, `expires_at:ts?`, `error_code:t?` | Index requester/status/time; private export and expiration |

For Phase 1, `command_receipts.device_id` may be omitted until the Phase 2 device migration; receipt idempotency itself is mandatory from the start. An outbox job and a command receipt serve different purposes: one schedules later work, the other prevents repeating a committed command.

### 28.6 Deferred community tables

| Table/base/phase | Columns beyond base | Constraints and principal indexes |
|---|---|---|
| `puroks` (B+M, P3) | `barangay_id:u FK barangays`, `name:t`, `status:t` | UQ barangay/name within organization |
| `households` (B+M, P3) | `purok_id:u FK puroks`, `reference_code:t`, `address_text:t?`, `status:t` | UQ reference code; no automatic medical access |
| `household_children` (B+M, P3) | `household_id:u FK households`, `child_id:u FK children`, `starts_on:d`, `ends_on:d?` | Index child/current membership; past residence retained only as required |
| `bhw_assignments` (B+M, P3) | `profile_id:u FK profiles`, `child_id:u FK children`, `purok_id:u? FK puroks`, `starts_at:ts`, `ends_at:ts?`, `status:t`, `assigned_by:u FK profiles` | Active child assignment is access basis; area alone is insufficient; index worker/status |
| `followup_visits` (B+M, P3) | `assignment_id:u FK bhw_assignments`, `visited_at:ts`, `outcome:t`, `next_action:t?`, `next_visit_on:d?`, `notes:t?` | Index assignment/time; edits audited |
| `record_transfers` (B+M, P3) | `child_id:u FK children`, `from_clinic_id:u FK clinics`, `to_clinic_id:u FK clinics`, `status:t`, `reason:t`, `requested_by:u FK profiles`, `identity_verified_by:u? FK profiles`, `source_approved_by:u? FK profiles`, `destination_accepted_by:u? FK profiles`, `manifest_hash:t?`, `manifest:j?`, `completed_at:ts?`, `reverses_id:u? FK record_transfers` | One active transfer per child; source differs from destination; final transitions require approvals/integrity |
| `growth_records` (B with corrections, P3) | `child_id:u FK children`, `clinic_id:u? FK clinics`, `observed_at:ts`, `weight_kg:n?`, `length_height_cm:n?`, `measurement_method:t?`, `source:t`, `measured_by:u? FK profiles`, `supersedes_id:u? FK growth_records`, `correction_reason:t?` | At least one measurement; positive values with approved plausibility review; index child/time |

### 28.7 Index and validation strategy

Index all frequently joined FKs and RLS lookup keys, especially active guardian links, clinic enrollments, staff memberships and BHW assignments. Add trigram/search indexes to normalized name search columns only after measuring query patterns. Keep names as entered; normalization is a search aid, not an identity replacement. Do not add indexes blindly to every field.

Use partial unique indexes for active links/bookings/queue entries. Cross-row capacity, rule dependency cycles, transfer state transitions and stock allocation checks require locked functions or constraint triggers; a single-row CHECK alone cannot enforce them. Migrations include grants, RLS policies, indexes and seed/reference versions together.

## 29. Entity Relationship Explanation

```text
Auth user --1:1--> Profile --1:N--> Staff membership --> Clinic
                    |
                    +--0:N--> Guardian (per organization)
Guardian --N:M through verified relationship--> Child
Child --N:M through enrollment--> Clinic
Child --1:N--> Program assignment --> Schedule version --> Rules
Rules --dependency edges--> Prior rules
Product --N:M--> Antigen <-- Rules

Child --> Appointment --> Clinic session
Child --> Queue entry --> Encounter --> Vaccination event
Vaccination event --> Immutable revisions --> Schedule evaluation credits
Vaccination revision --> Product + Lot + actual administering context
Vaccination event --> Stock transaction --> Stock movements --> Lot/location

Certificate --> Referenced vaccination revisions + immutable snapshot
Business command --> Receipt + Audit + Outbox (same transaction)
Device --> Offline grant --> Stock allocation / scoped read pack
BHW --> Explicit child assignment --> Follow-up visit
```

A guardian can care for several children; a child can have several verified guardians. Neither relationship requires all parties to have accounts. Clinic enrollment establishes present care scope; administration provenance preserves which clinic performed past care.

A vaccine **product** is what is physically administered and stocked. An **antigen requirement** is what the approved program evaluates. Keeping these separate prevents combination products from being double-counted in inventory or under-counted in clinical coverage.

An **event** identifies an occurrence. A **revision** records the signed or corrected description of that occurrence. An **evaluation** explains whether those facts satisfy a particular rule version. A **certificate** freezes a selected view at issuance. These are different responsibilities, not four competing copies of the same editable record.

Views such as `current_vaccination_history`, `current_schedule`, `usable_stock`, `children_due`, and `daily_clinic_activity` are derived. They have no independent edit forms. Staff do not update a “completed vaccine counter” in a child row.

## 30. API / Backend Architecture

### Command and response contract

Expose versioned route handlers under `/api/v1`. Reads use cursor pagination and explicit field selection. Writes require runtime-validated bodies, authenticated actor, scope checks and a client-generated `Idempotency-Key`. Updates carry `expectedVersion`; server compares it to the current version before mutation.

Response envelope: `data`, `requestId`, and optional `warnings`; command receipts include canonical IDs, versions and acceptance state. Errors contain a stable code, safe message, field errors and retryability; never SQL text, raw stack traces, private identifiers or credential details.

Use 400 for malformed input, 401 for unauthenticated, 403 or non-enumerating 404 for denied resources, 409 for version/capacity/idempotency conflicts, 422 for validly shaped but unacceptable data, 429 for rate limits and 503 for temporary service unavailability. Successful asynchronous work returns 202 plus an authorized job-status URL. Clinical exception capture can return accepted-with-review without pretending the ordinary validation passed.

| Operation / example route | Authorization/input | Transaction and result |
|---|---|---|
| Register account / Auth flow | Public, rate-limited; verified configured contact | Auth creates identity; server creates own profile only; no self-assigned staff role |
| `POST /children` | Guardian provisional or clinic registrar; demographic minimum | Duplicate candidates restricted to staff; child, enrollment/link request, audit atomically |
| `GET /children/search` | Active clinic role; bounded query | Scoped limited matches; cursor; no public cross-clinic search |
| `GET /children/:id` | Verified guardian or authorized clinic assignment | Minimum authorized projection, versions and provenance |
| `POST /guardian-links` | Requester authority and verification evidence | Link remains pending until authorized activation |
| `POST /qr/resolve` | Authenticated scoped staff; opaque token | Resolve token, recheck child access, return minimal identity; generic failure |
| `POST /appointments` | Linked guardian or clinic staff; child/session/purpose | Lock capacity; insert appointment/items/outbox/audit; 409 if full |
| `POST /appointments/:id/cancel` or `/reschedule` | Own booking or clinic staff; reason/version | Release/move capacity atomically; deduped notifications |
| `POST /check-ins` | Assigned clinic staff; verified child/booking | Create queue entry and arrival event once; allocate daily number under lock |
| `POST /queue/:id/transition` | Scoped staff; allowed target/version/reason | Check transition, append queue event; no clinical completion side effect |
| `POST /vaccinations` | Authorized vaccinator; reviewed administration payload | Event/revision + ledger + audit + outbox + receipt in one database transaction |
| `POST /vaccinations/exception-intake` | Clinical staff or restricted sync recovery | Preserve actual-care evidence and review case; no false stock or dose credit |
| `POST /vaccinations/:id/corrections` | Clinical proposal; qualified approval required | Append revision and optional compensating stock posting; affected certificates queued for review |
| `GET /children/:id/history` | Scoped read | Current facts plus permitted amendment provenance; no destructive rewrite |
| `POST /children/:id/evaluate` | Authorized staff or server event | Deterministic supported evaluation; guardian read endpoint returns latest approved result |
| `POST /catchup-plans` | Phase 2 clinician; evaluation reference | Draft then approval; no unsupported automated medical branches |
| `POST /inventory/transactions` | Inventory capability; typed operation/lot/location | Lock stock; ledger and projection commit once; approval for exceptional adjustment |
| `POST /certificates` | Issuer capability; child and verified revision IDs | Freeze snapshot/authorization, create generation job; document remains pending until PDF stored |
| `GET /verify/:token` | Public rate-limited | Minimal authenticity fields only; no clinical table access |
| `POST /certificates/:id/revoke` | Issuer/lead; reason/version | Revoke lifecycle state, audit, invalidate cached verification |
| `POST /record-transfers` and transitions | Phase 3 scoped source/destination approvals | Same canonical child; commit enrollment changes only at completed transition |
| `POST /sync/batches` | Enrolled device and reauthenticated actor | Per-operation transactional receipt; accepted/review/rejected outcomes |
| `GET /sync/changes?cursor=` | Current authorized scope | Paginated change cursor, tombstones and pack-refresh instruction |
| `POST /reports` | Report permission; filters/purpose | Scoped snapshot/job; private expiring output |
| `POST /notifications/provider-callback` | Verified provider signature | Deduplicate callback; update delivery state; never trigger clinical changes |
| `POST /schedule-versions/:id/activate` | Qualified approver; reviewed tests/source | Lock program activation, validate overlap, publish version and enqueue recalculation |

Database functions should accept business facts and expected versions, not trust client-supplied role, organization ownership or calculated stock balance. Obtain actor identity from the authenticated database context. When a service-role worker is unavoidable, it must reestablish the authorized job scope and never execute arbitrary client table names or SQL.

Read-heavy screens can use RLS-protected Supabase reads for non-sensitive operational data, but identifiable record reads go through an audited server route. Deny direct browser SELECT on underlying clinical tables when comprehensive read auditing is required; expose approved commands/views only. Record each batch/export read purpose rather than logging every rendered DOM element.

## 31. Supabase Architecture

### Authentication and database

Use Supabase Auth for verified account sessions, recovery and staff MFA. A contact phone for reminders is not automatically the login identifier. Configure one reliable authentication path for the pilot and an assisted recovery procedure; do not require every guardian to have email. If phone authentication is selected, its SMS cost, reliability and verification flow must be tested.

Use migrations in source control for schemas, functions, policies and indexes. Keep internal audit, sealed sync evidence and worker internals in a non-exposed schema. Expose only the required API schema and grants. RLS policies constrain rows; grants constrain available operations. Service-role credentials bypass RLS and remain server-only. Use security-invoker views where appropriate or tightly controlled functions; review every function/view for bypass. [Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security)

### Policy intentions

| Resource | Read policy | Write policy |
|---|---|---|
| Own profile | `profile.id = auth.uid()` | Own safe fields only; no roles/status escalation |
| Child/guardian projection | Active verified link or permitted clinic enrollment | Provisional creation/patch via command; guarded identity fields |
| Clinical history | Verified guardian permitted view or active clinical scope | Clinical functions only; no direct UPDATE/DELETE |
| BHW list | Active explicit assignment and minimum column projection | Assigned follow-up outcomes only |
| Appointments/queue | Own child or active clinic scope | Capacity/transition functions; public ticket projection excludes identity |
| Lots/stock | Active inventory/clinical scope | Ledger functions; no direct balance writes |
| Certificates | Linked guardian or issuer scope | Issue/revoke commands; public token function returns minimal result |
| Audit/sync evidence | Restricted reviewers in approved scope | Trusted append only |

RLS does not hide individual columns. Use separate restricted views/RPC projections or column grants for BHW/assistant summaries. Membership helper functions use a hardened search path, minimal privileges and no recursive policy loops. Never authorize with editable user metadata. Test authenticated access, anonymous access, API functions, views, storage and workers separately.

### Storage, realtime and jobs

Use private buckets for clinical evidence, certificate PDFs, reports and sealed recovery payloads. Object paths are random identifiers, not child names. Upload/download policies map object metadata to current record access; signed links are short-lived and granted only after authorization. Storage policies are separate from application table policies. [Supabase Storage access control](https://supabase.com/docs/guides/storage/security/access-control)

Use Realtime only for authorized clinic queue updates and job/status hints. Realtime is not offline conflict resolution. Use restricted channels and minimal payloads; refetch authoritative state after reconnect. A waiting-room display uses a sanitized endpoint, never a broad child-table subscription.

Triggers may maintain versions, append audit changes and enforce invariant bookkeeping. They should not send SMS or call external APIs inside a clinical transaction. Scheduled jobs handle reminder eligibility, expired sessions/stock availability, retries, review reminders, data retention and backup monitoring. Use one documented job scheduler with bounded batches, locking and idempotency. Edge Functions are optional for provider callbacks or bounded workers; do not duplicate the same business logic across Edge Functions and Next.js.

## 32. Security Architecture

### Access and session controls

Enforce least privilege at UI, API and database boundaries. Staff accounts are individually assigned; prohibit shared clinical logins. Require MFA for staff/admin/clinical approvers and reauthentication for role changes, bulk exports, certificate revocation and sensitive account recovery. Allow password managers and paste; use a documented length/passphrase policy, provider rate limits and compromised-password controls where available. Do not invent a local password-hashing system.

Use secure, reviewed session handling with Secure/SameSite cookies where applicable, server-side session validation and explicit logout/revocation. Do not promise HttpOnly protection for tokens that the chosen browser SDK needs to read; select and test the actual authentication architecture. Define clinic-approved inactivity locking and absolute session lifetime. Proposed pilot starting points are a short shared-terminal idle lock and a work-shift maximum session; exact values are operational policy, not clinical standards.

### Threat model

| Threat | Mitigation and residual risk |
|---|---|
| Unauthorized account access/weak password | MFA for privileged roles, throttling, recovery verification, session alerts; shared contacts still require careful linkage |
| Stolen guardian phone | Minimal default persistence, session revocation, lock-screen-safe notifications; downloaded documents can remain exposed |
| Shared clinic computer | Individual login, visible actor/clinic, idle lock, no browser autocomplete for clinical drafts, clean logout |
| Copied QR/ID enumeration | Opaque revocable tokens, authenticated lookup, scoped access, rate limits; QR is locator, not identity proof |
| Excessive staff privileges | Fixed role presets, separate grants/approval, periodic access review, current membership checks |
| Malicious record modification | Immutable revisions, reasoned approvals, protected ledger, audit monitoring; infrastructure owners remain highly privileged |
| SQL injection | Parameterized SQL/SDK calls, typed commands, no arbitrary rule SQL |
| XSS | Escape untrusted content, sanitize approved rich text, restrictive CSP, avoid raw HTML injection, no third-party trackers on patient pages |
| CSRF | Verify origin and anti-CSRF protection for cookie-authenticated mutations; never change state with GET |
| Insecure direct object access | Recheck scope on every object/action including files, exports and nested IDs |
| Exposed Supabase keys | Browser publishable key is not an authorization secret; never ship service-role/secret keys; scan builds and rotate on exposure |
| Offline database theft | Enrolled devices, encrypted payloads, key separation, minimum pack and expiry; unlocked compromised browser remains vulnerable |
| Session hijacking | TLS, safe cookies/token handling, short-lived sessions and revocation; reauthenticate sensitive actions |
| Forged certificate | Random token, canonical snapshot/hash and revocation; compare content through authorized verification |
| Unauthorized export | Explicit scope/purpose, row limits, private expiring links, export audit and anomaly alerts |
| Malicious attachment | File type/size limits, scanning/quarantine, safe download disposition; never execute uploaded active content |
| Abused SMS endpoint/webhook | Server-only provider access, verified callback signatures, spending/rate limits and replay protection |
| Insider browsing | Audited clinical-read gateway, purpose checks, unusual-volume alerts and supervisor review |

Encrypt traffic with TLS and verify provider encryption/backups and region choices before deployment. Separate development, test and production; production data must not be copied to a student demo. Secrets live in managed deployment settings; logs redact tokens, DOBs, message bodies and health facts unless a protected audit purpose requires them. Monitor denied reads, repeated QR lookups, bulk exports, privilege changes and abnormal certificate issuance.

## 33. Privacy Architecture

Health information is sensitive personal information under the Philippine Data Privacy Act. The law also establishes transparency, legitimate purpose and proportionality principles. This blueprint is an engineering design, not a determination of the clinic's legal basis or a compliance certification. [National Privacy Commission: Data Privacy Act](https://privacy.gov.ph/data-privacy-act/)

**Requires external validation:** controller/processor responsibilities, lawful basis for each processing purpose, guardian authority, handling of minors' rights, retention periods, data-sharing arrangements, hosting/cross-border considerations, privacy impact assessment, access/correction/erasure handling and incident/breach notification obligations. The responsible organization and privacy officer must resolve these before a real-data pilot.

Apply purpose-specific minimization:

- Collect identity and contact details needed for care, not an unrestricted family dossier. Birth-certificate scans, national ID numbers, photos and geolocation are not default requirements.
- Explain separately why records are processed, how SMS works, who can access data and how to request help. Do not treat one bundled checkbox as permission for all future uses.
- Verify guardianship before access and provide a restricted dispute workflow for custody conflicts. Changing a phone does not transfer account ownership.
- Allow guardians to request correction and access. Clinical records use reviewed amendments; account deactivation does not erase an existing medical record.
- Default operational reports to aggregates. Named exports require purpose and permission. Exclude advertising trackers, session replay and public analytics from health pages.
- Separate retained health facts from removable convenience data such as expired delivery logs and cached packs. Define retention per category rather than a single arbitrary duration.
- Soft deletion hides eligible registry drafts/configuration but does not satisfy every erasure request. Legally authorized hard deletion/anonymization follows a reviewed process, includes dependent files, and records action without retaining unnecessary sensitive content in the deletion audit.
- Backups and exports follow documented expiry/access rules; restoration must reapply suppression/deletion decisions and revocations after the backup point.

For the capstone, use visibly synthetic names, dates, contacts, rule sets and evidence. Screenshots and demonstration exports must contain no real child information.

## 34. Audit Trail

Audit is a history of accountable actions, not an editable notes field. Record actor, capability, clinic scope, entity and action, before/after values or a controlled diff, server time, request/operation ID, device/session reference where appropriate, reason, outcome and reviewer. Do not store passwords, access tokens, unnecessary full messages or unbounded raw request bodies.

Audit these actions: child identity edits; guardian verification/revocation; clinical creation/correction/voiding; evidence verification; rule import/approval/activation; lot and stock changes; quarantine/recall; queue priority changes; transfers; role/device changes; certificate issue/reprint/revoke; exports; identifiable record reads; and administrative configuration changes.

The database transaction writes the domain change and its audit event together. Rejected and suspicious requests go to security-event logging with safe metadata. A record cannot be considered successfully changed if its mandatory audit write fails.

Vaccination versions, stock movements, issued certificate snapshots, completed transfers and clinical approval histories cannot be silently deleted. Application roles cannot modify audit history. Restrict infrastructure access and export protected audit checkpoints to a separate access boundary for stronger tamper evidence. A database table alone is not tamper-proof against its database owner; a hash chain without external anchoring does not solve that problem.

Reviewers see only the audit scope required for their role. Full before/after clinical values themselves constitute sensitive data and need retention and access controls. Preserve author identity attribution even if the person's login is later disabled.

## 35. Accessibility

Target **WCAG 2.2 Level AA** for the released web interface, with automated checks and human testing. Relevant requirements include text contrast, keyboard operation, labels, focus visibility, error identification and accessible authentication. Do not claim conformance merely because a component library is used. [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)

Project requirements:

- Every action is keyboard operable, with logical focus order, visible focus and no keyboard trap. Dialogs return focus to their trigger and do not hide the active control under sticky bars.
- Form labels remain visible. Use correct input types and autocomplete for account identity where appropriate; avoid accidentally storing clinical draft data in browser autofill. Errors identify the field, explain recovery, and link from an error summary.
- Use text/icon/status combinations. Color alone never means “overdue,” “completed” or “pending sync.” Screen readers receive a concise status announcement without reading every queue update.
- Aim for at least 44×44 CSS-pixel primary touch areas as a product target, with adequate spacing. This is a design choice above some minimum standard cases, not a claim about one universal WCAG threshold.
- Support browser zoom, 200% text enlargement and reflow at narrow widths; no information exists only on hover. Tables have captions/headings and an accessible compact view.
- Standard text contrasts at least 4.5:1 against its background; meaningful controls and indicators receive appropriate non-text contrast. Verify actual rendered pairs and disabled/error states.
- Allow password managers and paste; offer recovery without cognitive puzzles. Provide manual patient lookup when camera/QR access is unavailable.
- Use simple English and reviewed Filipino terminology. Date examples include the month name, such as “29 Sep 2026,” to avoid numeric ambiguity. Medical content translations require clinical review.
- Respect reduced motion. Avoid autoplay, flashing, countdown pressure, animated KPI counters and celebratory effects in clinical tasks.
- Optional read-aloud starts only on request, has pause/stop controls and warns that nearby people may hear sensitive text. Ordinary screen-reader accessibility is required from MVP and is not deferred with the read-aloud feature.

UAT must include keyboard-only operation, an actual screen reader, a low-cost phone, large-text use and older/low-literacy guardians. Accessible printed instructions remain part of service delivery.

## 36. UI/UX Design System

### Visual direction

Use a calm community-health record style: warm light background, white work surfaces, dark teal actions, clear navy text, restrained borders and generous form spacing. Give the child timeline and “Next step” priority over dashboard decoration. Avoid hospital stock photography, toy-like 3D components, low-contrast embossed controls and dense KPI walls.

The design-skill search returned marketing/soft-3D patterns that do not fit this workflow. The following is a deliberate project-specific direction using accessibility guidance, not an endorsement of those generated patterns.

| Token/component | Specification |
|---|---|
| Background/surface | `#F7FAF9` / `#FFFFFF`; one bordered surface level, minimal shadows |
| Text/secondary text | `#16302B` / `#475569`; never pale gray body copy |
| Primary/on-primary | `#0F766E` / white; reserve solid primary button for the main step |
| Success | `#166534` text on `#F0FDF4`, check icon and explicit label |
| Attention | `#92400E` text on `#FFFBEB`, clock/alert icon and explanation |
| Error | `#B91C1C` text on `#FEF2F2`; explain correction next to input |
| Focus | Clearly visible contrasting outline with offset; verify against adjacent backgrounds |
| Type | Self-hosted Atkinson Hyperlegible if licensed/available, or readable system sans; 16–18 px body, roughly 1.5 line height |
| Scale | 4/8/12/16/24/32 px spacing; modest 8–12 px corner radius |
| Buttons | Text labels; primary, secondary, destructive and quiet variants; loading keeps label context |
| Child identity banner | Name, clinic record number and known DOB/age certainty; always visible during clinical entry |
| Status chip | Icon + label + optional date; never use a colored dot by itself |
| Timeline | Actual history separate from future recommendations; provenance/verification and pending sync visible |
| Form layout | One task per screen; related fields grouped; optional detail collapsible; no placeholder-only labels |
| Confirmation | Review child/product/lot/time before signing; destructive/irreversible actions require specific wording and reason |
| Feedback | Persistent inline confirmation for clinical saves; toast may supplement but never be sole proof |
| Navigation | Guardian bottom navigation: Home, Children, Visits, Messages; account/help in a consistent menu |
| Staff workspace | Sidebar on desktop; prioritized task menu on mobile; search always accessible |

Clinical action wording: “Save draft,” “Review administration,” “Sign and record,” “Request correction,” “Saved on this device,” “Synchronized,” and “Needs staff review.” Avoid ambiguous “Done” buttons. Filipino UI examples may use “Tala ng Bakuna” for vaccination record, but a language reviewer must confirm terminology in context.

Staff mobile forms use one column and a persistent child header; a compact action bar must not cover fields. A wide inventory table can offer a labeled horizontal-scroll container and a card alternative; it must not make the entire page overflow. Charts are optional and always include a textual/table alternative.

## 37. Sitemap

```text
PUBLIC
  Service information / clinic contact / accessibility / privacy
  Sign in / Create account / Verify contact / Recover account
  Certificate authenticity check (minimal public fields)

GUARDIAN
  Home
  Children
    Add child / Link existing record request
    Child overview
      Profile and guardian access
      Schedule and next steps
      Vaccination history / Report outside vaccination
      QR pass
      Certificates
      Care guidance
      Growth (Phase 3)
  Visits
    Book / Detail / Cancel / Reschedule
    Private queue status
  Messages / Preferences
  Education and language content (Phase 3 expansion)
  Account / Security / Privacy requests / Help

CLINIC
  Today dashboard
  Patient search / Scan / Register
  Child workspace
    Identity / Relationships / History / Schedule / Evidence
    Encounter / Administration / Correction request
    Clinical review / Catch-up (Phase 2)
    Certificates / Transfer (Phase 3) / Growth (Phase 3)
  Appointments / Session calendar
  Arrival queue / Walk-ins / Ticket display
  Inventory
    Balance / Receive / Lot detail / Ledger / Count & adjustment
    Wastage / Quarantine / Recall
    Stock transfer / Temperature (Phase 2)
  Children needing follow-up
  Clinical check-in inbox (Phase 2)
  Reports / Export jobs
  Offline sync center / Device preparation (Phase 2)

BHW (Phase 3)
  Home / Assigned area & children
  Due and follow-up list / Visit detail & logging
  Community summary / Assigned export

ADMIN / CLINICAL GOVERNANCE (capability-gated)
  Operations dashboard
  Users / Clinic memberships / Devices
  Clinics / Sessions / Closure rules
  Vaccine products / Antigens / Presentation rules
  Schedule versions / Review / Activation
  Content / Templates / Languages
  Communication provider settings
  Review cases / Duplicate resolution / Guardian disputes
  Audit / Security events
  Reports / Retention & privacy requests / Backup status
```

Routes are views over shared modules. “Clinic child history” and “Guardian history” use the same underlying record service with different projections. Secondary pages may be tabs or drawers if navigation and accessibility remain clear. Defer hidden Phase 2/3 navigation rather than presenting nonfunctional buttons.

## 38. Page-by-Page Specification

### Shared page contract

Each major page below has a defined role, purpose, components/fields, actions, validation, states, permissions, mobile behavior and tables. These shared defaults apply to every row unless overridden:

Page-table shorthand refers to the canonical Section 28 names: `relationships` = `guardian_child_relationships`, `enrollments` = `child_clinic_enrollments`, `review_cases` = `record_review_cases`, `products` = `vaccine_products`, `lots` = `vaccine_lots`, `revisions` = `vaccination_revisions`, `evaluations` = `schedule_evaluations`, `rules` = `schedule_rules`, `credits` = `dose_credits`, `holds` = `clinical_holds`, `sessions` = `clinic_sessions`, `queue` = `queue_entries`, `ledger` = `stock_transactions`/`stock_movements`, and `audit` = `audit_logs`. Other shortened plurals refer to the matching fully named domain tables, not additional entities.

- **Loading:** labeled skeleton/placeholders, no fake zero counts; keep existing data with a visible refresh indicator during refetch.
- **Empty:** explain why nothing is shown and the authorized next action. “No access” is never disguised as “no records.”
- **Error:** concise inline message, request/reference ID, preserved safe draft and explicit retry where safe; no stack trace. A mutation timeout shows “Checking save status” until its receipt is resolved.
- **Success:** persistent result, canonical reference and next action; clinical records distinguish signed, pending review and pending sync.
- **Permission:** server and database enforce the role plus record scope from Section 14. UI omission alone is insufficient.
- **Mobile:** single-column task flow; readable labels; 44 px primary targets; dialogs fit viewport; tables become cards or have a contained labeled scroll area.

### Dashboard specifications

| Page/role | Purpose, KPIs, primary actions | Tables/alerts/charts | Empty/loading/error states | Mobile/permissions/tables |
|---|---|---|---|---|
| D1 Guardian Home | Answer “What should I do next?”; per-child next visit and outstanding action count; select child, book, show QR | Child cards, upcoming visit, unverified-history alert; no KPI chart required | Empty: add/link child; loading: child-card skeleton; error: safe retry, no health details from stale unauthorized cache; success: updated next-step card | One child card at a time; verified links; children, relationships, evaluations, appointments, notifications |
| D2 Clinic Today | Run today's session; waiting, in-service, completed encounters, pending reviews; search, register, call next | Queue table, planned visits, stock/clinical/sync exceptions; optional hourly arrivals chart | Empty: no session/open session if permitted; loading: keep timestamped queue; error: stale banner and fallback procedure; success: authoritative refreshed counts | Queue/actions first; clinic scope; sessions, queue, encounters, balances, review cases |
| D3 BHW Home (P3) | Prioritize assigned follow-up; due, unresolved and visits completed | Assigned worklist, next contact, overdue follow-up; optional summary by assigned purok | Empty: no assignment, contact supervisor; loading: assignment skeleton; error: cached pack only if authorized; success: visit outcome and next task | Route/list first, no mandatory map; assignment scope; assignments, evaluations, visits |
| D4 Operations Home | Identify service failures; failed jobs, unresolved security events, backup age, pending approvals | Job health, restore-test status, access alerts; aggregate clinic activity trend only | Empty: system setup guidance; loading: distinguish unknown from healthy; error: service-check unavailable; success: acknowledged/resolved task | Critical alerts first; admin metadata, clinical approvals separately gated; outbox, audit, reports, configuration |

Dashboard filters include clinic, local date and as-of time where applicable. KPI labels define what is counted and link to their underlying list. No dashboard reveals clinical names simply because its viewer is an administrator.

### Identity and guardian pages

| Page / role / purpose | Main components and fields | Buttons/actions and validation | Empty / success | Loading / error specifics | Permission / mobile / related tables |
|---|---|---|---|---|---|
| P01 Service/help/privacy / public / understand service | Clinic hours/contact, accessibility, versioned privacy notice | Sign in, register, call; validate configured contact links | No configured clinic: service-contact fallback; success: navigation/contact opened | Static shell; unavailable contact labeled, never invented | Public reviewed content only; readable long text; clinics, content_versions |
| P02 Authentication/recovery / account holder / access account | Contact, password/OTP as configured, language, recovery state | Register, verify, sign in, recover; rate limits and provider validation; no role selector | New user: registration link; success: own role home | Disable repeated submit; generic account-recovery response prevents enumeration | Self only; keyboard/paste supported; auth.users, profiles |
| P03 Children list/add/link / guardian / manage family records | Child cards, known name/DOB precision, relationship, clinic, request evidence | Add provisional child, request existing link; no name/DOB-only ownership; duplicate candidates hidden from guardian | No children: assisted add/link guide; success: provisional/verified clearly labeled | Pending request visible; conflict routes to staff without leaking matches | Own profiles/links; one card per child; children, guardians, relationships, review_cases |
| P04 Child profile/access / guardian or registrar / accurate identity | Names, DOB certainty, address, guardians, verification status, record number | Request edit, authorized staff update, link/revoke request; expectedVersion and field validation | Unknown data shown “Not recorded”; success: saved or awaiting verification | Draft preserved; version conflict comparison; never replace known date silently | Sensitive identity changes staff reviewed; stacked fields; children, relationships, enrollments, audit |
| P05 Schedule / guardian or clinical staff / next action | Requirement cards, date/eligibility explanation, version, verification badges | Book visit, request review; no booking presented as clinical clearance | Insufficient history: staff-review CTA; success: confirmed visit link separate from recommendation | Latest evaluation loading; stale/version notice or calculation failure | Linked child/clinical scope; vertical timeline; rules, evaluations, credits, holds, appointments |
| P06 History/outside evidence / guardian and clinical staff / continuous record | Timeline, actual dates, product, source, verified status, amendment indicator, attachments | Report outside dose/upload; clinician verify/reject; file/partial-date checks | No known history: “No recorded vaccinations”; success: evidence pending or verified | Safe attachment preview; failed upload retriable; never imply unrecorded means unvaccinated | Guardian submits but cannot sign clinic events; cards; events, revisions, attachments, review_cases |
| P07 Booking/detail / guardian or assistant / reserve visit | Clinic/session, child, visit purpose, remaining availability, confirmation | Book/cancel/reschedule; active link, capacity and duplicate checks | No slots: alternate dates/contact; success: booking ID and arrival guidance | Check capacity on submit; 409 refreshes options while preserving selection intent | Own child or clinic; stepwise mobile picker; sessions, appointments, items |
| P08 Private queue / guardian / know arrival progress | Own ticket, state, station, timestamp and qualified wait estimate | Refresh/contact; no self-promote; check-in remains staff action | Not checked in: arrival guidance; success: called/in-service state | “Last updated” on stale data; reconnect refetch | Own active child's queue; large ticket, no other names; queue_entries/events |
| P09 QR pass / guardian / assist lookup | Child context and opaque QR, issue/revocation status, print alternative | Show/print, request replacement; no private payload | No issued pass: clinic help; success: active pass | Loading hides old revoked QR; camera not required for display | Linked child only; brightness-friendly large QR; qr_passes, children |
| P10 Certificate list/detail / guardian or issuer / obtain record | Issued document cards, issue/status, issuer, replacement relationship | Download/reprint; issuer generate/revoke with reason; verified revisions only | No issued extract: request clinic; success: immutable PDF and ID | Pending generation with retry status; failed render does not re-sign clinical record | Guardian own/issuer scope; readable preview and download; certificates, items, revisions |
| P11 Public verification / public / check authenticity | Minimal document ID, clinic, issue date, state, verification limitation | Verify token; rate limit; detailed view requires separate authorization | Invalid token: generic not-found; success: minimal validity result | No cached stale validity on revoke; unavailable means “Cannot verify now” | No child data; simple mobile status; restricted certificate verification function |
| P12 Messages/preferences / guardian / understand updates | Inbox, message date/type, channel/language and contact preferences | Mark read, update preferences, verify changed contact; validate purpose choices | No messages: next notification explanation; success: saved preference/read state | Delivery state separate from inbox read; retry failed preference save | Own recipient; grouped list; notifications, preferences, guardians |
| P13 Care/education/contact / guardian / approved guidance | Relevant reviewed article, language, source/review date, clinic contact | Open article, call, optional read-aloud P3; only active reviewed content | No language version: approved fallback marked; success: content displayed | Offline cached version/date shown; expired content routes to clinic | Public generic or linked contextual view; readable type; content_versions, clinics |
| P14 Account/security/privacy / user / control access | Account identity, sessions, verified contacts, privacy request status | Change verified contact, recover, revoke session, deactivate/request access; reauthenticate sensitive steps | No requests: explain request options; success: reference and next step | Recovery/contact errors generic; unsent data logout warning for staff | Own account; separate destructive action area; profiles, guardians, privacy_records, review_cases |

### Clinic pages

| Page / role / purpose | Main components and fields | Buttons/actions and validation | Empty / success | Loading / error specifics | Permission / mobile / related tables |
|---|---|---|---|---|---|
| P15 Search/scan/register / assistant or clinician / identify child | Name, DOB/estimate, guardian, record number, scan panel; minimal registration | Search, scan, open, register; bounded scoped results and duplicate review | No matches: verify spelling then register; success: confirmed child banner | Camera denied: manual search; offline: prepared pack only | Assigned clinic; large search and result cards; children, enrollments, QR, relationships |
| P16 Child workspace/encounter / clinical staff / review before care | Identity banner, verified history, schedule, holds, encounter purpose/assessment references | Start encounter, review evidence, defer/refer, open administration; current scope and identity confirmation | No history: documented review; success: encounter outcome | Keep pending clinical state visible; identity conflict blocks wrong-person workflow | Clinical scope; banner pinned safely; encounters, revisions, evaluations, holds |
| P17 Administration form / vaccinator / record care | Child, product, proposed credit, lot/expiry, actual time, route/site where required, vaccinator, notes | Draft, review, sign; product/lot/interval/identity/stock checks; already-given exception path | No usable lot: inventory/contact action; success: signed event or explicit pending review | Timeout resolves receipt; offline local commit clearly labeled; no blind resend | Clinical grant; one-column review screen; events/revisions, lots, ledger, receipts |
| P18 Correction/verification review / clinical lead / resolve discrepancies | Original/submitted values, evidence, reason, impacted credits/stock/certificates | Approve correction, reject with reason, request evidence; preserve originals | No cases: caught-up state; success: new revision and downstream impact list | Concurrent review conflict; pending files do not permit false verification | Assigned clinical reviewer; before/after stacked on mobile; review_cases, revisions, attachments, certificates |
| P19 Session calendar/appointments / assistant / manage capacity | Date/session, capacities, bookings, cancellations, late/no-show filters | Create session, book, reschedule, close, check in; capacity locks and authorized exceptions | No session: configured creation action; success: reservation or audited closure | Conflict refresh; cancelled clinic day offers contact task list | Clinic scheduling capability; list alternative to calendar; sessions, exceptions, appointments |
| P20 Queue/walk-ins / assistant or clinician / manage arrivals | Tickets, state, station, priority reason, arrival time | Check in, call/re-call, hold, start, complete/defer, mark left; legal transitions and priority authority | Empty queue: register/check in; success: ticket/state receipt | Realtime disconnect banner; manual refresh; no hidden removal of held ticket | Clinic role, sanitized display separate; mobile action menu; queue, queue_events, encounters |
| P21 Stock overview/receive / inventory staff / know usable supply | Product/lot balances, condition, expiry, receipt reference, quantity/unit | Receive, inspect lot, begin count; positive unit-consistent quantities | No stock: receive action; success: posted ledger reference | Balance as-of time; race rejection reloads affected lot | Inventory capability; product cards; products, lots, balances, transactions/movements |
| P22 Lot/ledger/adjustment/recall / inventory lead / trace and reconcile | Lot identity, movements, physical count, reason, affected use | Record waste, propose/approve adjustment, quarantine/recall; authority, quantity, physical facts | No movements: initial receipt guidance; success: balanced posting/case | Negative-balance conflict uses discrepancy workflow; no silent force-save | Inventory grant; identifiable recall list separately clinical-gated; ledger, lots, review_cases, revisions |
| P23 Stock transfer/temperature / inventory staff (P2) / preserve custody | Source/destination manifest, condition, readings/unit/time, excursion review | Dispatch, receive, flag discrepancy, log reading; configured product policy and transfer integrity | No transfers/readings: approved entry form; success: custody/read reference | Partial receipt visible; invalid/unknown threshold shows review | Inventory grant; stepwise mobile entry; stock_transfers, temperatures, lots, policies |
| P24 Follow-up worklist / staff / recover missed care | Due status, appointment outcome, last contact, reason/filter, current rule version | Review history, contact, book, assign later BHW; no automatic dose completion | No pending care: date/as-of explanation; success: documented next action | Stale evaluations marked; failed notification doesn't remove child | Clinic scope; action cards; evaluations, appointments, notifications, review_cases |
| P25 Catch-up planner / qualified clinician (P2) / approve supported plan | Verified history, interval explanation, earliest/recommended dates, review conditions | Generate draft, approve, revise; current inputs and approved rules | Unsupported case: manual clinical review; success: approved plan with version | Changed history invalidates draft; no fallback invented dates | Clinical approval capability; requirement cards; catchup_plans/items, evaluations, rules |
| P26 Clinical check-in inbox / assigned clinician (P2) / act on concerns | Assigned cases, reported concern, event link, report/onset time, response status | Acknowledge, contact, escalate, close; approved protocol and ownership | No cases: monitored hours shown; success: outcome/next task | Connectivity problem warns queue may be stale; urgent response follows approved external route | Clinical scope only; priority list without diagnosis automation; followup_cases, events, content |
| P27 Sync/device preparation / enrolled staff (P2) / know data safety | Grant/pack age, pending operations, receipts, conflicts, stock allocations, recovery status | Prepare pack, sync, retry, open review, lock/logout; no wipe of unsent evidence | No pending operations: last successful sync time; success: canonical receipts/remaining cases | Per-operation error, storage failure, revoked device recovery path | Current user/device/clinic; large status summary; grants, receipts, intake, allocations, change_feed |
| P28 Reports/export jobs / authorized staff / operational review | Report definition, date range/clinic, purpose, filters, preview, as-of | Run, export, download; scope, range limits, safe CSV | No events: actual zero with filters; success: report/job and private link | Large job progress; failed generation retried without broadening scope | Report/identifiable-export capabilities; summarized mobile columns; domain views, report_runs |
| P29 Record transfer / source/destination staff (P3) / continuity | Identity, source/destination, approval timeline, manifest counts/hash, pending care | Request, approve, accept, commit, reject or compensating reversal; state gates | No transfer: start request if authorized; success: same-child enrollment handoff | Failure leaves source active until commit; post-commit discrepancies reviewed | Respective source/destination capability; step list; transfers, enrollments, audit |
| P30 Growth / clinical staff and guardian (P3) / record measurements | Observation date, kg/cm, method, source, raw trend/table | Staff record/correct; guardian report separately; positive values and plausibility confirmation | No measurement: neutral explanation; success: new observation with provenance | Unknown reference prevents percentile display; chart failure retains table | Guardian read/clinical write; chart/table toggle; growth_records, children |

### BHW and governance pages

| Page / role / purpose | Main components and fields | Buttons/actions and validation | Empty / success | Loading / error specifics | Permission / mobile / related tables |
|---|---|---|---|---|---|
| P31 Assigned area/children / BHW (P3) / plan outreach | Assigned purok, minimal child/contact, due action, contact restrictions | Filter, open assigned visit, request help; assignment valid at read | No assignment: supervisor contact; success: scoped list | Offline only approved pack; expired scope blocks access | Explicit child assignment; list-first, no mandatory GPS; assignments, households, evaluations |
| P32 Follow-up visit/community summary / BHW (P3) / record outcome | Visit time, outcome, next step/date, minimal notes; aggregate summary | Log visit, request appointment, submit outside evidence; no clinical credit write | No prior visit: first-visit form; success: saved outcome/task | Local pending status if enabled; submission failure preserved | Assigned scope; single form; visits, assignments, reports |
| P33 Users/memberships/devices / admin plus approver / control access | Account status, clinic role/capabilities, approver, validity, device status | Invite, propose/approve grant, suspend, revoke; no self-elevation | No staff: authorized setup invitation; success: effective scope and audit | Partial external-auth failure reconciled; refresh revoked state | Admin metadata; clinical grants need designated approval; profiles, memberships, devices |
| P34 Clinic/operating configuration / admin or supervisor / define operations | Clinic contacts/timezone, hours, capacity allocations, closure and queue policies | Save versioned settings; nonnegative capacity, valid timezone, affected-booking preview | Unconfigured: setup checklist; success: effective configuration | Conflict retains edits; policy validation near field | Config capability; grouped mobile sections; clinics, sessions, calendar_exceptions |
| P35 Products/antigens / authorized data steward / reliable master data | Product code/name/manufacturer, antigen mapping, presentation/units, reference | Import/review/activate/retire; unique codes, approved mapping, used values protected | No products: validated import guide; success: versioned available master | Invalid import gives row errors; no partial silent activation | Steward plus clinical approval; tabular desktop/card mobile; products, antigens, mappings |
| P36 Schedule configuration/review / clinical lead / govern rules | Source, version, effective cohort/dates, rules/dependencies, fixture results, impact preview | Draft/import, validate, submit, approve/activate, retire; acyclic dependencies and approved tests | No approved version: scheduling explicitly unavailable; success: active version/recalculation job | Failed tests block activation; old version preserved | Technical import and clinical approval separated; readable review steps; schedule_versions/rules/dependencies, outbox |
| P37 Content/templates/SMS settings / content owner/admin / approved communication | Language/version/body, placeholder schema, source/review date, provider secret status | Preview, review/publish, test with synthetic contact, rotate server secret; no unreviewed clinical publication | Missing translation: approved fallback; success: published version/provider test | Delivery failures shown; never display plaintext saved provider secret | Content approval vs technical settings separated; preview before save; content_versions, notifications, deployment secrets |
| P38 Review cases/duplicate resolution / assigned reviewer / settle ambiguity | Candidate identifiers, evidence, affected records, reason and proposed survivor | Request evidence, merge, reject, resolve linkage dispute; no auto-merge by name | No cases: queue clear; success: survivor/aliases and impact report | Locked/conflicting merge stops safely; preserve both sources | Purpose-specific reviewer; side-by-side desktop/stacked mobile; review_cases, children, links, audit |
| P39 Audit/security/privacy requests / authorized reviewer / accountability | Actor/action/time/scope filters, before/after permitted fields, request purpose/status | Inspect, annotate investigation, scoped export; no edit/delete audit | No results: confirm filters; success: tracked review/reference | Sensitive query errors don't broaden access; paginated loads | Restricted capability; compact readable diffs; audit, privacy_records, review_cases |
| P40 Backup/retention/job status / operations admin / recoverability | Last backup/restore drill, job failures, retention approvals, storage backup status | Retry bounded job, schedule reviewed retention, view runbook; destructive restore outside ordinary UI | No successful restore: unresolved readiness warning; success: recorded verification result | Unknown health remains unknown; distinguish DB vs file backup failure | Operations metadata only; critical status first; outbox, report_runs, deployment monitoring |

## 39. Validation Rules

Validate on the client for immediate help and again on the server/database for authority. A hard error blocks structurally impossible or unauthorized input; a warning requests review for plausible unusual data. Do not turn every unusual real-world value into an impossible registration.

| Data | Required validation | Legitimate exceptions/handling |
|---|---|---|
| Child name | Nonempty display name; trim surrounding space; safe length; Unicode accepted | Mononyms, multiple surnames, punctuation, diacritics and temporary clinic-approved names allowed; no letters-only regex |
| DOB | Not future; exact/estimated/unknown precision consistent | Missing certificate does not imply unknown DOB; uncertain DOB stores a range/precision, not fabricated 1 January |
| Sex/reference input | Valid approved code if required by a clinical calculation | Unknown/not recorded permitted where appropriate; do not infer from name |
| Address | Enough locality/contact detail for stated purpose | No mandatory street number, GPS or formal postal address when absent |
| Birth details | Only clinically needed approved fields, with source | No mandatory birth weight, delivery history or certificate scan solely for registration |
| Guardian | Name, relationship, verification status; valid active link required for access | Accompanying adult can be recorded provisionally; disputed authority restricted and reviewed |
| Contact | Normalize verified telephone format, including Philippine international format as appropriate; reasonable email validation | Shared numbers and no number allowed; phone is not a unique person identifier |
| Contact change | Reverify channel and invalidate old delivery destination | Assisted identity recovery available; prior number alone insufficient proof |
| Product/dose | Active applicable product; rule-backed credit and sequence; current event uses exact product | Unknown historical product stored as reported text pending clinical review |
| Administration date | No future physical administration; date/time precision and timezone consistent | Historical month/year or uncertain date allowed as partial evidence without invented exact time |
| Batch/expiry | Correct product/lot, usable state and approved expiry handling for planned use | Missing outside lot permitted and shown unknown; actual erroneous administration preserved through exception path |
| Administering staff | Authorized person at actual care time where verifiable; recorder separately identified | Historical external clinician may be text/unknown; retrospective entry needs provenance |
| Duplicate administration | Heuristic warning plus exact idempotency enforcement | Do not impose blanket unique child/product/date: more than one event may genuinely occur and needs review |
| Appointment | Active scope, service date, legal state and available allocation | Staff overflow only through audited operational procedure |
| Stock | Positive received/issued magnitude, correct unit, no unauthorized negative posting | Count mismatch enters review; no invented receipt to hide discrepancy |
| Growth | Positive numeric values with explicit units/date and approved plausibility flags | Unusual values require confirmation; no universal hard-coded percentile rules |
| Attachment | Allowed type, actual MIME/content validation, size limit and private object scope | Staff can record evidence reference when no digital file exists |

Distinguish `null` (unknown/not collected) from zero, empty text and “not applicable.” Record why a required clinical element is missing through the exception workflow. Validation messages explain what to do next.

## 40. Error Handling

| Failure | User-facing behavior | System handling |
|---|---|---|
| Network unavailable | “Connection unavailable. Last updated …” | Use authorized offline pack or paper; no false save confirmation |
| Mutation timeout | “We are checking whether this was saved.” | Query receipt using same operation key before retry |
| Invalid data | Field-specific explanation and correction | Return structured validation; retain safe draft |
| Duplicate child | Staff sees possible match review | No automatic merge; guardian receives safe review message |
| Suspected duplicate vaccination | “A similar record needs review.” | Preserve submission; distinguish duplicate entry from actual repeat care |
| Unauthorized record | “This record is unavailable to your account.” | Consistent denied/not-found response, safe security log |
| Expired session | “Sign in again to continue.” | Lock sensitive view; preserve sealed unsent data; reauthorize before send |
| SMS failure | Delivery failed/unknown, staff next action | Bounded retry or contact worklist; do not remove appointment |
| Sync failure | Per-operation status and retry/review action | Other independent operations can finish; preserve dependencies and receipts |
| Database failure | “Service is temporarily unavailable. Reference …” | Roll back atomic command; paper/offline fallback; alert operations |
| Certificate render failure | “Record saved; document generation needs retry.” | Keep clinical transaction committed; idempotent PDF job retry |
| Inventory conflict | “Stock changed. Recheck this lot.” | Reload normal planned use; actual administered event enters exception capture |
| Browser quota/device crash | “Not saved on this device” if commit absent | Do not assume draft survived; recover committed local queue or use paper |
| Provider/job outage | Pending state with timestamp | Durable outbox, retry cap, dead-letter/review queue and alert |

Support sees request IDs and redacted diagnostics. Ordinary users never receive raw SQL, stack traces, JWTs, provider credentials or another child's identity in an error message.

## 41. Edge Cases

| Edge case | Required system response |
|---|---|
| Child has no birth certificate | Register using available identity evidence and DOB certainty; do not deny software access solely for missing document |
| Child/family has no smartphone | Staff-assisted registration/booking, printed ticket/history/care, later account linkage optional |
| Parent changes phone | Verify replacement, stop sends to old destination, audit change and recheck recovery factors |
| Parent forgets password | Provider recovery or approved assisted verification; never disclose records to whoever controls a shared number alone |
| Duplicate registration | Review candidate records, select survivor, preserve aliases/provenance and resolve dependent records transactionally |
| Twins/similar siblings | Separate IDs; show distinguishing identifiers and guardian confirmation; never deduplicate solely by name/DOB |
| Incomplete history | Store uncertainty and evidence; no assumed missing/complete doses; clinical review |
| Vaccinated at another public clinic | Record outside provenance, verify evidence, evaluate credit; no local stock deduction |
| Vaccinated privately | Same outside-record workflow; public/private source remains visible |
| Moves barangay | Update residence through verification; transfer care enrollment separately; preserve history |
| Arrives without appointment | Walk-in capacity/queue; no account requirement |
| Fully booked clinic | Alternative dates, assisted contact and published walk-in/overflow policy; no guaranteed same-day slot |
| Vaccine out of stock | Keep clinical requirement due; offer clinic-guided alternatives/date; notify affected appointments |
| Expired lot | Block planned use, exclude usable stock, retain physical disposition history |
| Batch recalled | Quarantine/block; trace affected events; clinically supervised notification and follow-up |
| Internet fails | MVP paper procedure; Phase 2 enrolled offline capture with provisional labels |
| Electricity fails | Powered device/UPS if available; otherwise numbered paper forms and later reconciliation |
| Device crashes mid-entry | Recover only transactionally committed local draft/operation; otherwise clearly indicate no saved record |
| SMS fails | Retry eligible failures and create staff follow-up; retain in-app/printed alternatives |
| Parent does not respond | Record nonresponse, follow contact policy, consider assigned outreach; no automatic clinical inference |
| Nurse enters wrong demographic information | Versioned identity correction with evidence and duplicate impact check |
| Vaccination recorded incorrectly | Append reviewed clinical revision; evaluate stock impact and certificate invalidation separately |
| Vaccine actually given incorrectly | Preserve actual event, restrict clinical credit, create clinical incident/review and follow approved care protocol |
| Certificate lost | Authorized reprint same snapshot or policy-based replacement; do not duplicate vaccination |
| Certificate revoked | Public status changes promptly; previous PDF retained privately; replacement linked if issued |
| User compromised | Suspend/revoke sessions and grants; investigate access/changes; protect sealed pending evidence |
| Two devices edit same record | Base-version detection and field-aware review; no last-writer-wins for clinical facts |
| Duplicate synchronization | Same receipt returned; one clinical event/stock posting/message job |
| Server unavailable | Queued local/paper work, no new authoritative online booking, recovery runbook |
| Unauthorized user opens record URL | Deny at API/DB/file layer; reveal no child details |
| Guardian dispute or revoked relationship | Suspend disputed access through authorized workflow; preserve care record; do not let one guardian erase another's evidence |
| Birth date changes | Reevaluate recommendations and affected plans; retain old values and issued record provenance |
| Product contains multiple antigens | One stock issue; separate approved clinical credits |
| Real repeat administration on same day | Preserve both actual events with review; do not collapse based only on similarity |
| Child dies or leaves service | Authorized inactive status and communication stop according to policy; retain required records and denominator decisions |
| Lot allocation device is lost | Quarantine unresolved allocation from availability until physical reconciliation; no automatic reuse |
| External record date/lot unknown | Preserve partial evidence; clinician determines whether it can support credit |
| Pending operation references merged child | Resolve alias to canonical child under authorization; keep submitted original reference in audit |
| Schedule activated during an outage | Revalidate uploads under applicable policy; preserve old calculation reference and actual event |
| Server clock/device clock disagree | Server receipt time authoritative for system sequence; actual-care time uncertainty flagged |
| Browser clears local storage | Explain unsent-data risk; recover server-acknowledged data, reconcile remaining paper/stock evidence |

## 42. Performance Requirements

These are **proposed test targets**, not measured performance or service guarantees. Initial load model: one clinic, 10,000 child records, 100,000 administration events, about 20 concurrent staff and 100 concurrent guardian sessions. Use anonymized synthetic data. Test on a representative low-cost Android device and ordinary clinic workstation, with a throttled mobile link around 5 Mbps/150 ms round-trip plus separate offline tests.

| Operation | Proposed target and measurement |
|---|---|
| Search | p95 server response ≤800 ms for indexed scoped query; useful results visible within about 2 s on reference network |
| QR lookup | p95 authorized lookup ≤1 s server-side; camera acquisition measured separately |
| Dashboard | Main actionable content within about 3 s on reference network; deferred charts must not block actions |
| Appointment commit | p95 ≤2 s excluding new authentication; concurrent last-slot tests prove correctness before speed tuning |
| Vaccination commit | p95 ≤2 s for database command under initial load; PDF/SMS excluded and visibly asynchronous |
| Local draft/event commit | p95 ≤500 ms on reference device; success shown only after IndexedDB transaction completes |
| Sync | 100 small dependent-aware operations in ≤60 s on stable reference link excluding attachments and review; show progress and partial outcomes |
| Queue freshness | Realtime target ≤5 s while connected, with configurable polling fallback; stale timestamp always visible |
| Routine daily report | ≤5 s at initial scale; larger exports return a job promptly and target completion within a few minutes |
| Certificate generation | Return pending job promptly; target PDF ready within 15 s under reference load |

Measure p50/p95, failure rates, device class, query plan and sample count. Tune payload size, indexes and pagination before adding infrastructure. Set separate operational availability targets only after budget, service plans and monitoring are known. Never optimize away authorization, audit or transaction correctness.

## 43. Backup & Disaster Recovery

Define **RPO** as acceptable data loss since the last recoverable backup and **RTO** as intended time to restore service. Proposed pilot objectives are RPO no more than 24 hours with verified daily backup and RTO within one working day. These require stakeholder acceptance and a demonstrated restore; use more frequent backups/PITR if the clinic cannot accept that loss window. Offline unsynchronized data is outside server backup coverage.

Supabase database backup availability and retention depend on the selected plan. Database backups do not contain the actual Storage objects, so certificate/evidence/export files need their own backup and recovery strategy. Verify the selected plan instead of assuming free hosting includes a sufficient recovery service. [Supabase database backups](https://supabase.com/docs/guides/platform/backups)

Back up: database schema/data and relevant Auth records; private objects with checksums; rule/content versions; migrations; deployment configuration inventory; and separately secured recovery secrets/keys. Do not store credentials in the same unprotected export as the data. Keep encrypted off-site copies with restricted access and policy-approved retention. Monitor both backup creation and usable restore verification.

### Recovery runbook

1. Declare outage/incident, appoint incident owner, stop unsafe writes and tell clinics to use approved local/paper procedure.
2. Determine failure window, last verified backup, outstanding local operations and whether credentials are compromised.
3. Restore into an isolated environment; restore database and matching object files/configuration/keys; rotate compromised secrets.
4. Validate referential integrity, clinical revision counts, stock ledger reconciliation, certificate revocations, RLS, authentication and representative file hashes.
5. Reapply post-backup access revocations, privacy deletions and security blocks from protected recovery records. Increment recovery epoch.
6. Reconcile missing server receipts against surviving local receipts and paper forms; replay only reviewed operations with stable keys. Inspect outbox/provider state before resending messages to avoid duplicate external delivery.
7. Reopen service, reconcile affected clinics, communicate data-loss limitations, and record corrective actions.

For accidental deletion, prefer selective verified restoration with reviewed reapplication to the current database over blindly rolling the whole clinic backward. For a failed device, recover server-acknowledged work on an enrolled replacement and reconcile unsent work manually. Conduct a restore drill before pilot and at an agreed recurring interval, for example quarterly as a project proposal. A backup job's “success” flag alone does not prove recoverability.

## 44. Testing Strategy

Tests must cover business invariants and failures, not simply reproduce UI implementation. All clinical fixtures are fictional for development or explicitly approved/versioned for a clinical pilot. Test results from fictional rules do not validate medical correctness.

| Test layer | Required scope |
|---|---|
| Unit | Calendar arithmetic including leap days/month boundaries; rule dependency evaluation; status precedence; product unit conversion; notification dedupe keys; state transitions |
| Integration | Full transaction commit/rollback; actual API/Auth/Postgres interaction; outbox retries; file authorization; provider callback verification |
| Database | FK/unique/check constraints; capacity and stock locking; immutable histories; projection rebuild; migration upgrade/rollback or forward-fix plan |
| RLS/security | Every role allow/deny matrix; unrelated child, wrong clinic, revoked membership; anonymous/token/view/storage paths; no service-key exposure |
| Offline/sync | Lost response, repeated requests, revoked actor, stale pack, duplicate child, two devices, out-of-order dependencies, quota failure, browser restart, logout recovery and restore epoch |
| UI/end-to-end | Guardian and walk-in journeys; identity banner; double-click prevention plus server idempotency; corrections and pending-state honesty |
| Accessibility | Automated scans plus keyboard, screen reader, zoom/reflow, target size, focus management, plain-language comprehension |
| Performance | Defined synthetic load, realistic network/device, indexed RLS queries, queued exports; report p95 and failures |
| UAT | Nurse, assistant, guardian, older guardian, inventory worker, BHW in its phase, and privacy/clinical lead |

### Critical acceptance cases

| ID | Scenario | Expected result |
|---|---|---|
| T01 | Linked guardian opens child's record; unrelated guardian uses same ID | First permitted; second denied without leaked details |
| T02 | Two bookings race for one remaining allocation | Exactly one confirmed; other receives availability conflict |
| T03 | Signed administration succeeds | One event/revision, correct ledger posting, audit and outbox committed together |
| T04 | Inject database failure after event insert but before stock issue | Whole normal command rolls back; no partial clinical save claimed |
| T05 | Save succeeds but response is lost; retry same operation | Original receipt returned; no duplicate event, stock or job |
| T06 | Reuse operation key with changed payload | Integrity conflict; original data unchanged |
| T07 | Requested dose earlier than approved fixture interval | Planned use blocked/reviewed with explanation; already-given path preserves fact without automatic credit |
| T08 | Combination product administered | One physical issue; correct separate antigen credits under approved fixture |
| T09 | Outside vaccination submitted by parent | Pending evidence; no local stock issue; no completed credit until verification/evaluation |
| T10 | Two similar names and DOBs are twins | Separate records retained; no automatic merge |
| T11 | Confirmed duplicate records merged | One canonical child; aliases resolve; history/certificates/audit remain attributable |
| T12 | Approved catch-up fixture with late predecessor | Expected earliest date and explanation; unsupported case goes to review |
| T13 | Expired/recalled/quarantined lot selected | Planned administration blocked; relevant stock excluded from usable balance |
| T14 | Two staff issue final available quantity | One normal issue succeeds; second rechecks stock; actual-care exception preserved if needed |
| T15 | Physical dose exists but ledger is wrong | Exception recorded and assigned; no fabricated stock; reconciliation posting audited |
| T16 | Clinical correction changes lot | Original revision retained; proper compensating movements; total physical use remains correct |
| T17 | Two devices change the same identity field | Conflict case displays both versions; no silent overwrite |
| T18 | Offline dependent child + event arrive out of order | Event waits for child or review; no orphan row |
| T19 | Offline user revoked before reconnect | Ordinary writes denied; sealed care evidence retained for restricted review |
| T20 | Logout with pending operations, then another user logs in | No readable prior patient pack; sealed recovery retained; unrelated user cannot view it |
| T21 | Device/browser storage fails during local commit | UI says not saved; no pending-success fiction |
| T22 | Copied baby QR used anonymously or by wrong clinic | No private record returned |
| T23 | Certificate issued, then relevant fact corrected/revoked | Public status updates; old snapshot preserved; authorized replacement linked |
| T24 | Forged paper carries copied valid QR | Public page explains limited authenticity; authorized canonical-content comparison detects mismatch |
| T25 | SMS accepted but HTTP response lost | Unknown/provider status resolved; no blind unlimited resend |
| T26 | Appointment rescheduled before reminder executes | Old reminder cancelled; new appointment confirmed once |
| T27 | Transfer fails before commit | Source enrollment intact; retry does not clone child |
| T28 | Restore backup older than existing client receipts | Recovery epoch forces reconciliation; no blind duplicate replay/message storm |
| T29 | Screen reader signs an administration using keyboard | Identity, labels, warnings and result understandable; focus correct |
| T30 | Report includes combination products, outside history and voided duplicates | Counts follow metric definition; antigen counts differ appropriately from administration count |
| T31 | Rule version changes effective cohort | Preview and approval required; past evaluations retained; affected bookings flagged |
| T32 | Privacy or clinical administrator requests data beyond scope | Denied even if account has technical configuration privileges |

**Release gates:** no unresolved critical access-control, data-loss, wrong-child, duplicate-posting or stock-integrity failures. Clinical lead signs off approved policy fixtures; privacy owner signs off scope and operational procedures; clinic users complete UAT. Record tested versions, evidence and accepted residual limitations. Security is tested throughout the build, not left for the final week.

## 45. Demo / Presentation Flow

Use two fictional guardians, two distinct children with similar names, one clinic, a documented synthetic schedule and synthetic lots. Keep a visible demo banner and resettable seed dataset. Do not send real SMS or use real patient attachments.

1. Show guardian registration and a provisional child, then staff verification/linking.
2. Display the child's schedule with rule source/version and a clear next action.
3. Book an available window and show the in-app confirmation. Explain that arrival creates the queue ticket.
4. Switch to staff, scan the opaque QR, confirm identity and check in.
5. Show the private ticket and sanitized public display.
6. Nurse reviews history and approved synthetic eligibility; show why a wrong lot/too-early date is blocked.
7. Record one synthetic administration correctly. Show the saved reference, changed stock ledger and updated history.
8. Issue a clinic record extract. Open its QR verification page and demonstrate that it reveals no child health details.
9. Show approved demo care content/contact and the next recommended step.
10. Open daily report and trace that event to its lot.
11. Demonstrate a correction preserving the original and a retry returning the same receipt.
12. Demonstrate a denied unrelated-parent lookup and the paper outage process.

**Optional Phase 2 extension:** disconnect an enrolled device, record a synthetic event within allocation, show “Saved on this device,” reconnect and synchronize once. Demonstrate a real conflict case and its resolution rather than merely switching the network icon. Show SMS in a sandbox with failed/unknown delivery. Do not present these as completed Phase 1 capabilities unless they have actually been built and tested.

## 46. Features to Delay or Remove

### Features We Should NOT Build in the Initial Version

| Feature | Decision and reason | Condition for reconsideration |
|---|---|---|
| AI diagnosis or autonomous vaccination decisions | Exclude; unnecessary safety and validation burden | Outside current product purpose |
| General-purpose clinical rule programming language | Delay; unsupported policy complexity and security risk | Validated need beyond typed supported rules |
| Full multi-device offline editing of every table | Delay; conflicts/access/stock cannot be solved by simple replication | Controlled append workflows and reconciliation proven first |
| Automatic identity merge or national child ID matching | Exclude from MVP; severe wrong-child risk | Agreements, reliable identifiers and reviewed matching workflow |
| Unrestricted administrator patient browsing | Remove; technical role does not imply clinical purpose | Only specific separately approved clinical capability |
| Public child history via QR | Remove; unnecessary exposure | No reconsideration within this design |
| Gamified competition or ranking of families | Remove; privacy/stigma and weak care value | Neutral individual progress text only |
| Broad education CMS, nutrition and feeding tracker | Delay; dilutes core scope and needs content ownership | Demonstrated demand and clinical review capacity |
| Automatic 24-hour check-in for all vaccines | Delay; staffing and medical policy not established | Approved timing/content plus response ownership |
| Temperature sensors/IoT and predictive procurement | Delay; hardware support/data quality dependencies | Reliable manual ledger and cold-chain process |
| Mass outbreak messaging | Delay; authority, audience and messaging governance needed | Approved public-health operating procedure |
| National registry/FHIR or private-provider live integration | Delay; external contracts and semantic mapping | Concrete partner interface and consent/legal arrangements |
| Payment/billing/insurance subsystem | Exclude; no requirement supporting core value | Separate approved scope |
| Complex microservices, blockchain certificates, distributed event platform | Remove from recommended initial architecture | Evidence the modular application cannot meet actual scale |
| Separate native apps per role | Delay; multiplies maintenance | PWA field evidence demonstrates an unmet device requirement |
| Universal “fully immunized forever” badge | Remove misleading claim | Versioned program completion as of a date only |

## 47. Final Recommended Architecture

Use **one Next.js/TypeScript application and one Supabase project per environment**, with four role-aware portals over a shared canonical data model. Keep PostgreSQL authoritative, use RLS and explicit grants, centralize transactional commands, and deliver external effects through a durable outbox. Use Vercel for the app and a bounded worker runtime selected after deployment constraints are verified. Keep private files in protected storage.

Start with one clinic. Use client-generated operation IDs from the first online version, append-only clinical revisions, a lot-level ledger, and clear command receipts. These foundations make later controlled offline capture possible without redesigning clinical truth. A prepared staff device later receives a scoped encrypted pack and stock allocation; it does not become an independent clinic database.

### Final architecture quality review

| Review area | Final decision/check |
|---|---|
| Missing requirements | All source feature groups, workflows, role portals, offline behavior, database/API, reporting, operational risks and demo are mapped into this document |
| Contradictory requirements | “MVP offline” split into paper continuity now and controlled digital writes later; appointments and clinical eligibility separated |
| Duplicate features | One follow-up domain replaces separate overlapping defaulter/drop-out/scout lists; one content/version system supports education/care/templates |
| Duplicate database truth | Auth identity, clinical events, schedule credit, stock ledger and issued snapshots have distinct owners; projections are read-only |
| Circular dependencies | Rules form a validated acyclic graph; administration commits before asynchronous notifications/certificates; schema migrations order or later-add nullable FKs for review references |
| Security/privacy | Technical roles lack default clinical access; QR tokens reveal no health data; file/view/function policies included |
| Offline weaknesses | Acknowledged limits: stale authorization, unknown concurrent care, storage loss, inability to remotely wipe disconnected devices; constrained workflow and recovery specified |
| UX complexity | Task-focused portals, common child banner, explicit pending states, accessible lists and no unused phase navigation |
| Auditability | Clinical amendments, physical stock corrections, rule activation, access and exports attributable |
| Error and edge states | Section 38 page states plus Sections 40–41 cover failures and exceptional real-world inputs |
| Unrealistic assumptions | No guaranteed SMS delivery, real-time global offline knowledge, automatically official certificate or unbudgeted uptime promise |
| Medical validation | No actual clinical dose intervals, temperature bounds, contraindication lists or treatment instructions invented |
| Operational ownership | Clinical approver, privacy owner, inventory lead and technical operator assigned before pilot |

### External validation register

| Item | Owner to obtain approval | Required evidence before enabling related feature |
|---|---|---|
| Current routine/catch-up and product-credit policy | Clinic clinical lead / appropriate DOH authority | Source/version, applicability, approved fixtures, reviewer/date |
| Contraindications, timing exceptions and consent process | Clinical lead | Approved workflow and escalation policy |
| Product units, expiry, open-vial and temperature policies | Vaccine/cold-chain lead | Product-specific references and validated conversions |
| Care content, languages, check-in triage and contact routes | Clinical/content lead | Approved version, response responsibility, review date |
| Certificate format, signature and external recognition | Authorized clinic/institution | Issuer authority and accepted purpose/format |
| Guardian authority, privacy basis, retention and sharing | Privacy officer/legal owner | Documented purpose/basis, procedures and agreements |
| Coverage denominators and official reports | Program reporting owner | Metric definitions, population source and receiving format |
| Growth references and interpretations | Qualified clinical lead | Approved reference/version and test fixtures |
| Hosting/security/backup service configuration | Technical operator with privacy owner | Chosen plans/regions, contracts where needed, recovery test and access review |

Each item above is marked **Requires external validation**. This review confirms design coverage; it does not assert that these approvals or implementation tests have already occurred.

## 48. Final Recommendations

1. Build a trustworthy clinical record first. Identity, verified guardian linkage, provenance, correction and access are core functionality.
2. Separate physical administration, clinical dose credit and appointment attendance. This resolves several hidden counting and safety errors in the original concept.
3. Use approved versioned policy with reproducible explanations. Never hard-code unverified medical assumptions into components.
4. Include a basic lot ledger in MVP and make the administration transaction atomic. Defer inventory forecasting and hardware, not essential traceability.
5. Treat offline work as controlled pending evidence. Use idempotency from day one, explicit device/stock allocation and human conflict review.
6. Preserve equitable access. Walk-ins, assisted registration and printed records are permanent service paths.
7. Limit QR and public certificate verification to their stated purposes. Neither is a substitute for identity or authorization.
8. Assign owners for review queues, failed notifications, reconciliation and clinical concerns. A feature without an operational owner should remain disabled.
9. Measure retrieval time, encoding burden, failure recovery and user comprehension during the pilot before expanding features.
10. Distinguish a capstone demonstration from clinical deployment. Use synthetic data until governance, configuration, security and recovery gates are met.

## FINAL CVSRS VISION

CVSRS becomes a dependable community-clinic vaccination companion: guardians understand the next step, staff can find and document the right child's care, vaccine use remains traceable, and records retain their meaning through corrections, outages and changes of clinic. Its value comes from a complete, understandable care workflow and trustworthy data.

## MOST IMPORTANT IMPROVEMENTS MADE

- Replaced overlapping feature names and numbering with one prioritized taxonomy and phased ownership.
- Defined verified guardianship and clinic/BHW access rather than assuming account ownership equals permission.
- Separated recommended dates, eligibility, booking, arrival, administration and schedule credit.
- Added product-to-antigen mapping so combination vaccines do not corrupt inventory or coverage counts.
- Made current/historical/private-clinic records share one provenance-aware timeline.
- Introduced immutable clinical revisions, clinically reviewed exceptions and certificate impact handling.
- Replaced stock counters with reconciled movements, lot status and accountable corrections.
- Designed actual offline packs, local transactions, sealed recovery, idempotency and conflict outcomes.
- Prevented copied QR codes and public verification pages from exposing child health records.
- Added realistic failure behavior, restore reconciliation, measurable targets and critical acceptance tests.
- Reduced the MVP to one connected clinic workflow while preserving a clear expansion path.
- Created an explicit external-validation register instead of inventing medical or legal requirements.

## FINAL MVP CHECKLIST

### Foundation and governance

- [ ] One configured clinic and organization; named clinical, privacy, inventory and technical owners.
- [ ] Separate development/test environments and synthetic demo dataset.
- [ ] Agreed MVP boundaries and documented paper outage procedure.
- [ ] Approved policy sources/fixtures for any real clinical use; visible fictional-rule warning for demos.
- [ ] Reproducible database migrations, constraints, indexes and private storage policies.
- [ ] Account verification/recovery, individually assigned staff access, MFA for privileged roles, RLS and access tests.

### Working care journey

- [ ] Provisional child registration, duplicate review, verified guardian linkage and multi-child portal.
- [ ] Scoped search and revocable opaque QR with manual lookup fallback.
- [ ] Unified history, external evidence submission and clinician verification.
- [ ] Routine rule evaluation with version, explanation and uncertainty handling.
- [ ] Appointment capacity locking, cancellation, reschedule and no-show workflow.
- [ ] Walk-in check-in, daily queue, late/held/priority outcomes and sanitized public display.
- [ ] Clinical encounter and signed administration with actual-time/recorder distinction.
- [ ] Product/lot/expiry and required approved clinical fields; already-administered exception capture.
- [ ] Atomic event, stock issue, audit, command receipt and outbox transaction.
- [ ] Basic stock receipt, wastage, correction/adjustment, quarantine/recall and lot-use lookup.
- [ ] Supported presentation/unit accounting tested; multi-dose products disabled until their required workflow is ready.
- [ ] Reviewed clinical correction preserving original values and physical stock facts.
- [ ] Private printable clinic record with minimal public verification, reprint and revocation.
- [ ] In-app confirmations, reviewed care guidance, clinic contact and clinic follow-up list.
- [ ] Daily care, appointment, queue and stock reports with clear metric definitions.

### Readiness and quality

- [ ] Plain-language, accessible mobile/desktop pages with all empty/loading/error/success states.
- [ ] No medical status encoded by color alone; basic reviewed language support.
- [ ] Timeout/idempotency and last-slot/last-dose concurrency tests pass.
- [ ] Cross-child, cross-clinic, anonymous, revoked-role and storage access tests pass.
- [ ] Clinical correction, external-history, duplicate-registration and certificate tests pass.
- [ ] No unprotected health data in public caches, public QR payloads or application logs.
- [ ] Automated database and file backups configured; isolated restore drill completed.
- [ ] Paper-to-digital reconciliation demonstrated with no duplicated stock/event.
- [ ] Pilot UAT, performance measurements and training complete; unresolved critical defects closed.
- [ ] Real-data release has documented external approvals; capstone demonstration remains clearly synthetic otherwise.

Full offline clinical writes, live SMS, automated clinical check-ins and the BHW portal are not required to declare this bounded MVP complete. Their release requires the Phase 2/3 gates stated above.

## BUILD ORDER

1. **Validate scope and policy ownership.** Confirm pilot workflows, data purposes, supported products and synthetic fixtures. Record external approvals still required.
2. **Design database invariants and migrations.** Create identity, clinic, role, child and core audit/receipt structures; set grants/RLS alongside tables.
3. **Implement authentication and authorization.** Build own-account flows, staff invitation/MFA, scoped access helpers and denial tests before patient screens.
4. **Build child registry and verified relationships.** Add duplicate review, clinic enrollment, manual search and safe QR lookup.
5. **Add clinical master data and rule approval.** Products, antigens, supported units, approved schedule versions and test fixtures.
6. **Build history and routine evaluation.** External evidence, immutable clinical version structures, dose credit, uncertainty and status explanations.
7. **Build basic lot inventory.** Receiving, usable stock and ledger commands before administration can consume stock.
8. **Implement appointments and queues.** Capacity/arrival state machines, walk-ins, concurrency tests and encounter outcomes.
9. **Implement administration and corrections.** Atomic event/stock/audit/outbox, exception capture, amendments and reconciliation.
10. **Deliver guardian history and certificates.** Private snapshot, authorized issue/download and minimal public verification/revocation.
11. **Finish in-app communications and care guidance.** Versioned content, delivery jobs, contact preferences and follow-up worklist.
12. **Add operational reports and paper reconciliation.** Verify counts against actual events and ledger; retain metric definitions.
13. **Complete MVP release checks.** Accessibility, permission and concurrency suites, backup/restore, operational runbook and UAT. Security testing runs through every preceding step.
14. **Phase 2: expand clinic operations.** Reviewed catch-up, inventory alerts/temperature/transfer, live SMS and staffed check-ins.
15. **Phase 2: enable controlled offline capture.** Device enrollment, encrypted packs, sealed pending recovery, stock allocation, sync and conflict tests; supervised pilot before broad enablement.
16. **Phase 3: extend continuity and community work.** BHW assignments, approved transfers, growth, richer reviewed language/content and validated coverage analytics.
17. **Reassess future features with evidence.** Integrations, campaigns, nutrition and hardware only when ownership, value and operational readiness are established.

This order places inventory, authorization, audit and idempotency before the workflows that depend on them. Hardening and testing accompany every increment; they are not a final patch applied after the clinical system is built.
