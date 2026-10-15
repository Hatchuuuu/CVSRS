/**
 * Requirements traceability matrix generator/checker.
 *   npm run matrix         -> regenerates docs/implementation/requirements-matrix.md
 *   npm run matrix:check   -> validates ids/statuses/evidence, exits non-zero on drift
 * The single source of truth is the tables below. A status of verified_local REQUIRES named evidence that exists on disk.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const STATUSES = ["not_started", "in_progress", "implemented_unverified", "verified_local", "verified_staging", "blocked_external", "approved_exclusion"] as const;
type Status = (typeof STATUSES)[number];

interface Row {
  id: string;
  kind: "BP" | "F" | "D" | "P" | "T" | "C";
  section: string;
  title: string;
  phase: string;
  deps?: string;
  impl?: string;
  tests?: string;
  status: Status;
  evidence?: string;
  blocker?: string;
  gate?: string; // clinical/privacy release gate, tracked separately from engineering status
  info?: boolean;
}

const rows: Row[] = [];
const add = (r: Omit<Row, "status"> & { status?: Status }) => rows.push({ status: "not_started", ...r });

// ---- Blueprint sections -------------------------------------------------------------------------------------------
const BP: [number, string, Status?, string?][] = [
  [1, "Executive Summary"], [2, "Problem Statement"], [3, "Project Objectives"], [4, "Target Users"], [5, "User Personas"],
  [6, "Problems Being Solved"], [7, "Existing Features Review"], [8, "Issues, Gaps, Risks, Improvements"], [9, "Final Feature Set"],
  [10, "Feature Prioritization"], [11, "Final Phase Roadmap"], [12, "System Modules"], [13, "System Architecture", "in_progress"],
  [14, "User Roles and Permissions", "in_progress"], [15, "End-to-End Workflows", "in_progress"], [16, "Vaccination Scheduling Engine"],
  [17, "Appointment & Queue System"], [18, "Vaccination Recording Workflow"], [19, "Vaccine Inventory System"], [20, "Offline-First Architecture"],
  [21, "Synchronization & Conflict Resolution"], [22, "Notification System"], [23, "Digital Vaccination Certificate"], [24, "Record Transfer System"],
  [25, "Growth Tracking"], [26, "BHW / Community Features"], [27, "Reporting & Analytics"], [28, "Database Architecture", "in_progress"],
  [29, "Entity Relationship Explanation", "in_progress"], [30, "API / Backend Architecture", "in_progress"], [31, "Supabase Architecture", "in_progress"],
  [32, "Security Architecture", "in_progress"], [33, "Privacy Architecture", "in_progress"], [34, "Audit Trail", "in_progress"], [35, "Accessibility", "in_progress"],
  [36, "UI/UX Design System", "in_progress"], [37, "Sitemap", "in_progress"], [38, "Page-by-Page Specification", "in_progress"], [39, "Validation Rules", "in_progress"],
  [40, "Error Handling", "in_progress"], [41, "Edge Cases", "in_progress"], [42, "Performance Requirements", "in_progress"], [43, "Backup & Disaster Recovery", "in_progress"],
  [44, "Testing Strategy", "in_progress"], [45, "Demo / Presentation Flow"], [46, "Features to Delay or Remove"], [47, "Final Recommended Architecture", "in_progress"],
  [48, "Final Recommendations"],
];
for (const [n, t, s] of BP) {
  add({ id: `BP${String(n).padStart(2, "0")}`, kind: "BP", section: `Section ${n}`, title: t, phase: "-", status: s ?? "not_started", info: n <= 12 || n === 45 || n === 46 || n === 48,
        evidence: s ? "see child C-rows and F/P/T rows" : undefined });
}

// ---- Features ------------------------------------------------------------------------------------------------------
const F: [number, string, string, Partial<Row>?][] = [
  [1, "Accounts/access", "1", { status: "in_progress", impl: "supabase/migrations/0001,0002,0005; src/lib/db/*; src/app/sign-in; src/app/account/security", tests: "tests/db/foundation.test.ts; tests/e2e/01-accounts.spec.ts; tests/e2e/02-first-staff.spec.ts; tests/e2e/03-staff-application.spec.ts", evidence: "DB authz verified_local; immediate automatic-confirmation signup without confirmation email, duplicate signup safety, reload persistence, password recovery, first-staff bootstrap, approvals, TOTP and role refusals verified on the local Supabase stack (tests/e2e/01-03, 2026-10-08); hosted project not yet", blocker: "hosted Supabase project for verified_staging", gate: "privileged-role MFA policy approval" }],
  [2, "Child/guardian registry", "1", { status: "in_progress", impl: "0003_registry.sql; src/app/children; src/app/clinic", tests: "tests/db/registry.test.ts", evidence: "core verified_local; privacy-notice UI, account invitation, guardian contact verification pending" }],
  [3, "Search and QR", "1", { status: "in_progress", impl: "0003 staff_search_children/resolve_qr; workspace.tsx", tests: "tests/db/registry.test.ts (T22)", evidence: "manual/QR-token lookup verified_local; camera scanning not started" }],
  [4, "History and external evidence", "1", { status: "in_progress", impl: "0006, 0009; src/app/children/[childId]; clinic child page", tests: "tests/db/evidence.test.ts", evidence: "outside-evidence report/verify + immutable revisions verified_local; file attachments need Supabase Storage; clinic-administered events arrive in M06", blocker: "Supabase Storage for attachment upload" }],
  [5, "Corrections and audit", "1", { status: "in_progress", impl: "0001 audit/receipts; 0003 identity update", tests: "tests/db/foundation.test.ts, registry.test.ts", evidence: "audit immutability + identity-edit versioning verified_local; clinical revision corrections not started" }],
  [6, "Approved routine rules", "1", { status: "in_progress", impl: "0006-0008; private.evaluate_rules", tests: "tests/db/schedule.test.ts; tests/db/evidence.test.ts", evidence: "typed-vocabulary engine, lifecycle gates and pinned evaluations verified_local with FICTIONAL DEMO rules only; no real schedule exists", blocker: "Approved clinical schedule (external-validation.md)", gate: "clinical lead approval of real rules" }], [7, "Appointment capacity", "1", { status: "in_progress", impl: "0012, 0013; src/app/children/[childId]/visits.tsx; today page", tests: "tests/db/visits.test.ts", evidence: "booking/cancel/reschedule/session close verified_local incl. last-slot race; verified in browser; calendar exceptions and holiday handling not built" }],
  [8, "Check-in / queue", "1", { status: "in_progress", impl: "0012, 0013; src/app/clinic/[clinicId]/today; src/app/display", tests: "tests/db/visits.test.ts", evidence: "check-in, ticket allocation, state machine, call-next, priority, public display verified_local and in browser; wait-time estimates intentionally absent" }],
  [9, "Administration recording", "1", { status: "verified_local", impl: "0015_administration.sql; clinic child page administration.tsx", tests: "tests/db/administration.test.ts", evidence: "atomic record + stock + credit + audit + outbox verified_local incl. injected-fault rollback; exception intake and corrections verified_local; UI two-step review-and-sign verified in browser (local shim). Multi-dose vial workflow deliberately not enabled", gate: "clinical policy for route/site, consent and timing rules" }],
  [10, "Follow-up worklist", "1", { status: "verified_local", impl: "0022_followup_holds_privacy.sql; src/app/clinic/[clinicId]/followup", tests: "tests/db/followup.test.ts", evidence: "engine-derived list with contact attempt log verified_local and in the browser; needs an approved schedule to list anyone" }], [11, "Reviewed catch-up", "2", { status: "verified_local", impl: "0021_catchup_checkins.sql; clinic child page catchup.tsx", tests: "tests/db/catchup.test.ts", evidence: "staff-authored, two-person reviewed plans verified_local; no catch-up rules exist by design" }], [12, "Basic lot ledger", "1", { status: "in_progress", impl: "0011_inventory.sql; src/app/clinic/[clinicId]/inventory", tests: "tests/db/inventory.test.ts", evidence: "ledger, projection, receive/wastage/count/disposition/reconcile verified_local; UI verified in browser (local shim); issue-at-administration wired in M06; multi-dose vial workflow deliberately disabled", blocker: "Cold-chain/expiry/open-vial policy (external-validation.md)", gate: "vaccine/cold-chain lead approval" }], [13, "Inventory intelligence and transfers", "2", { status: "in_progress", impl: "0019_transfers_temperature.sql; inventory/transfers; inventory/cold-chain", tests: "tests/db/transfers.test.ts", evidence: "transfers with in-transit custody verified_local and in the browser; forecasting and expiry intelligence not built", blocker: "cold-chain and forecasting policy" }],
  [14, "Temperature/quarantine", "2", { status: "in_progress", impl: "0019_transfers_temperature.sql; inventory/cold-chain", tests: "tests/db/transfers.test.ts", evidence: "readings, approver-set limits with policy reference, excursion flag and review verified_local and in the browser; no sensors/automation; limits are clinic policy", blocker: "Cold-chain policy values (external-validation.md)" }], [15, "Recall tracing", "1 basic; 2", { status: "in_progress", impl: "0011 set_lot_disposition", tests: "tests/db/inventory.test.ts", evidence: "recall/quarantine blocks use and receipt; restricted audited lot-to-child trace verified_local; supervised outreach after a recall is Phase 2" }], [16, "Printable/verifiable records", "1", { status: "in_progress", impl: "0017_certificates_messages.sql; src/lib/certificates; certificate routes; verify page", tests: "tests/db/certificates.test.ts; tests/unit/certificate-pdf.test.ts", evidence: "frozen snapshot + private PDF, revocation, replacement, correction review flag and minimal public check verified_local and in the browser; issuer/format not clinic-approved", blocker: "Certificate format and signatory authority (external-validation.md)", gate: "clinic approval of certificate format/issuer" }], [17, "In-app messages", "1", { status: "in_progress", impl: "0017 messages + private.process_outbox; src/app/messages; src/lib/worker", tests: "tests/db/certificates.test.ts", evidence: "visit and certificate messages delivered by the bounded worker (retry, dedupe, withdrawal) verified_local and in the browser; approved care guidance content not built" }],
  [18, "SMS", "2", { status: "in_progress", impl: "0020_sms_preferences.sql; src/lib/sms; src/app/messages", tests: "tests/db/sms.test.ts; tests/db/sms-dispatch.test.ts; tests/unit/sms.test.ts", evidence: "consent, pipeline and callbacks verified_local with a sandbox provider; nothing is sent to real phones", blocker: "SMS provider account and receipt contract" }], [19, "Care guidance/contact", "1", { status: "verified_local", impl: "0024_config_content_audit_ops.sql; src/app/help; clinic content page; public start page hours/contact", tests: "tests/db/config.test.ts", evidence: "clinic-written, second-person-approved care information in the family's language with a marked English fallback verified_local; the system ships no text; contact and hours shown exactly as typed" }], [20, "Monitored check-ins", "2", { status: "in_progress", impl: "0021 checkins; src/app/clinic/[clinicId]/questions; guardian AskTheClinic", tests: "tests/db/catchup.test.ts", evidence: "verified_local and in the browser; off until a clinical lead writes the safety notice", blocker: "clinic-approved safety notice wording", gate: "clinical lead approval of the notice and staffing" }], [21, "Outage procedure", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/outage-forms; docs/operations/runbook.md", tests: "-", evidence: "printable paper log, stock log and arrival sheet; later-entry reconciliation verified_local; printing not tested on a real printer", blocker: "clinic to approve form wording" }],
  [22, "Controlled offline writes/sync", "2", { status: "not_started", blocker: "deferred by decision D70 pending a threat model", evidence: "not built" }], [23, "Backup/monitoring", "1", { status: "in_progress", impl: "scripts/backup-drill.ts; settings page operations status; docs/operations/runbook.md", tests: "npm run drill:restore; tests/db/config.test.ts", evidence: "local restore drill and recorded-facts status page verified_local; Supabase backups/monitoring not exercised", blocker: "Supabase project / hosting" }],
  [24, "Privacy/security controls", "1", { status: "in_progress", impl: "RLS/grants in 0001-0005; src/next.config.ts headers; src/lib/security", tests: "tests/db/*.test.ts; tests/unit/security.test.ts", evidence: "grant/RLS hardening + CSRF/rate-limit units verified_local; retention/privacy-request workflows pending", gate: "privacy officer approval" }],
  [25, "BHW assignments/visits", "3", {}], [26, "Record transfer", "3", { status: "in_progress", impl: "0023_record_transfer.sql; clinic/[clinicId]/transfers; children/[childId]/move-record.tsx", tests: "tests/db/record-transfer.test.ts", evidence: "within one organization verified_local and in the browser; cross-organization exchange not built", blocker: "data-exchange agreement" }], [27, "Growth", "3", { status: "blocked_external", blocker: "approved growth reference and protocol; not invented here", evidence: "not built by design" }], [28, "Reviewed education/languages", "3; basic UI 1", {}],
  [29, "Program completion indicator", "3", {}], [30, "Community campaigns", "V2+", {}], [31, "Read-aloud", "3", {}], [32, "Nutrition content", "V2+", {}],
  [33, "Core reports", "1", { status: "verified_local", impl: "0018_reports.sql; src/app/clinic/[clinicId]/reports; src/lib/reports", tests: "tests/db/reports.test.ts; tests/unit/csv.test.ts", evidence: "daily activity, vaccinations by product, stock summary with ledger check, backlog and paper reconciliation with definitions, audited CSV export and small-cell rule verified_local and in the browser; suppression threshold needs privacy-owner decision" }], [34, "Expanded coverage/community reports", "3", {}],
  [35, "Master-data/configuration lifecycle", "1", { status: "in_progress", impl: "0008; src/app/clinic/[clinicId]/clinical", tests: "tests/db/schedule.test.ts", evidence: "antigens/products/schedules governed lifecycle verified_local; clinic/session config, content and templates not started" }],
  [36, "Interoperability", "V2+", { blocker: "requires partner interface specification" }], [37, "Sensors/hardware integrations", "V2+", { blocker: "requires device protocol/hardware" }],
];
for (const [n, t, ph, o] of F) add({ id: `F${String(n).padStart(2, "0")}`, kind: "F", section: "BP10", title: t, phase: ph, ...o });

// ---- Dashboards and pages -----------------------------------------------------------------------------------------
const D: [string, string, Partial<Row>?][] = [
  ["D1", "Guardian Home", { status: "in_progress", impl: "src/app/children/page.tsx", evidence: "children list verified in in-app browser (local shim); no schedule/next-step yet" }],
  ["D2", "Clinic Today", { status: "in_progress", impl: "src/app/clinic/[clinicId]/page.tsx; today page", evidence: "queue, expected families, walk-in, sessions verified in browser (local shim); stock/clinical exceptions and sync alerts pending" }],
  ["D3", "BHW Home (P3)", {}], ["D4", "Operations Home", {}],
];
for (const [id, t, o] of D) add({ id, kind: "D", section: "BP38", title: t, phase: id === "D3" ? "3" : "1", ...o });

const P: [number, string, string, Partial<Row>?][] = [
  [1, "Service/help/privacy", "1", { status: "in_progress", impl: "src/app/page.tsx", evidence: "clinics + no-account guidance shown; privacy notice/accessibility statement content pending" }],
  [2, "Authentication/recovery", "1", { status: "verified_local", impl: "src/app/sign-in, sign-up, auth/*, account/*", tests: "tests/e2e/01-accounts.spec.ts; tests/unit/auth-entry.test.ts", evidence: "immediate automatic-confirmation signup without confirmation email, duplicate signup without duplicate account, email or session loss, reload persistence and password reset verified in a browser on the local Supabase stack (tests/e2e/01-accounts.spec.ts, 2026-10-08); sign-in, wrong password, sign-out and Auth-side 12-character rule verified locally (2026-10-04); no local sign-in shim exists any more", blocker: "hosted project + real SMTP for verified_staging" }],
  [3, "Children list/add/link", "1", { status: "in_progress", impl: "src/app/children", evidence: "add child verified in browser (local shim); link request API+DB verified_local" }],
  [4, "Child profile/access", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/children/[childId]", evidence: "staff view/edit verified in browser; guardian view + edit-request UI pending" }],
  [5, "Schedule", "1", { status: "in_progress", impl: "src/app/children/[childId]; clinic child page; src/components/schedule-view.tsx", tests: "tests/db/evidence.test.ts", evidence: "guardian + staff schedule verified in browser (local shim, DEMO rules); booking action pending M05" }],
  [6, "History/outside evidence", "1", { status: "in_progress", impl: "src/app/children/[childId]/report-dose.tsx; clinic child page evidence.tsx", tests: "tests/db/evidence.test.ts", evidence: "report + verify flow verified in browser and DB tests; attachments not built" }], [7, "Booking/detail", "1", { status: "in_progress", impl: "src/app/children/[childId]/visits.tsx", tests: "tests/db/visits.test.ts", evidence: "book verified in browser; cancel/move UI implemented, DB verified_local" }],
  [8, "Private queue", "1", { status: "in_progress", impl: "src/app/children/[childId]/page.tsx queue card", tests: "tests/db/visits.test.ts", evidence: "people-ahead status verified_local; page shows it; live refresh is manual" }],
  [9, "QR pass", "1", { status: "in_progress", impl: "src/app/children/forms.tsx QrPanel", evidence: "issue/resolve verified_local in DB tests; staff QR rendering seen in browser; guardian panel not browser-verified" }],
  [10, "Certificate list/detail", "1", { status: "verified_local", impl: "children/[childId]/page.tsx; clinic child page certificates.tsx", tests: "tests/db/certificates.test.ts", evidence: "guardian list/download and staff issue/retry/replace/revoke exercised in the in-app browser" }], [11, "Public verification", "1", { status: "verified_local", impl: "src/app/verify/[token]/page.tsx; api/v1/verify", tests: "tests/db/certificates.test.ts", evidence: "valid state seen in the browser; minimal fields, rate limited; invalid, pending and unknown tokens indistinguishable" }], [12, "Messages/preferences", "1", { status: "in_progress", impl: "src/app/messages", tests: "tests/db/certificates.test.ts", evidence: "inbox, unread badge and mark-read verified in the browser; notification preferences not built" }], [13, "Care/education/contact", "1", {}],
  [14, "Account/security/privacy", "1", { status: "in_progress", impl: "src/app/account, src/app/account/security", tests: "tests/e2e/02-first-staff.spec.ts", evidence: "TOTP enrolment and challenge verified on the local Supabase stack; privacy requests pending", blocker: "privacy request process (privacy officer)" }],
  [15, "Search/scan/register", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/workspace.tsx", evidence: "search + register + duplicate prompt implemented; search verified in browser; camera scan pending" }],
  [16, "Child workspace/encounter", "1", { status: "in_progress", impl: "clinic child page; get_open_encounter", tests: "tests/db/administration.test.ts", evidence: "identity banner, schedule, history, encounter-bound recording verified; growth/holds UI absent" }],
  [17, "Administration form", "1", { status: "verified_local", impl: "administration.tsx AdministerPanel, ExceptionForm", tests: "tests/db/administration.test.ts", evidence: "review-before-signing, repeat confirmation and exception path; recording verified in the in-app browser" }],
  [18, "Correction/verification review", "1", { status: "in_progress", impl: "review page cases.tsx; CorrectionForm", tests: "tests/db/administration.test.ts", evidence: "correction request/approve/decline and exception decisions implemented; DB verified_local; review UI not browser-exercised" }], [19, "Session calendar/appointments", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/today", tests: "tests/db/visits.test.ts", evidence: "session create/close, expected list; not a calendar grid; closure exceptions/holidays pending" }],
  [20, "Queue/walk-ins", "1", { status: "verified_local", impl: "src/app/clinic/[clinicId]/today", tests: "tests/db/visits.test.ts", evidence: "queue, walk-in allocation, priorities and display verified_local and in the browser" }], [21, "Stock overview/receive", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/inventory", tests: "tests/db/inventory.test.ts", evidence: "register lot + receive verified in browser; DB verified_local" }],
  [22, "Lot/ledger/adjustment/recall", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/inventory; review queue stock cases", tests: "tests/db/inventory.test.ts", evidence: "ledger view, count/adjust approval, quarantine/recall UI implemented; DB verified_local; UI partly browser-exercised" }], [23, "Stock transfer/temperature", "2", { status: "verified_local", impl: "inventory/transfers; inventory/cold-chain", tests: "tests/db/transfers.test.ts", evidence: "send, receive (also short/not accepted), cancel and resolve exercised in the in-app browser; axe clean" }],
  [24, "Follow-up worklist", "1", { status: "verified_local", impl: "src/app/clinic/[clinicId]/followup", tests: "tests/db/followup.test.ts", evidence: "in the browser; axe clean" }], [25, "Catch-up planner", "2", {}], [26, "Clinical check-in inbox", "2", {}], [27, "Sync/device preparation", "2", {}],
  [28, "Reports/export jobs", "1", { status: "verified_local", impl: "src/app/clinic/[clinicId]/reports", tests: "tests/db/reports.test.ts", evidence: "reports and audited CSV export in the browser; large asynchronous export jobs not needed at this scale" }], [29, "Record transfer", "3", { status: "verified_local", impl: "src/app/clinic/[clinicId]/transfers", tests: "tests/db/record-transfer.test.ts", evidence: "two-clinic flow in the browser; axe clean" }], [30, "Growth", "3", {}], [31, "Assigned area/children (BHW)", "3", {}], [32, "Follow-up visit/community summary", "3", {}],
  [33, "Users/memberships/devices", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/access", evidence: "request/approve/revoke UI implemented; DB workflow verified_local; device management pending" }],
  [34, "Clinic/operating configuration", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/settings; 0024 update_clinic_profile", tests: "tests/db/config.test.ts", evidence: "contact, hours, time zone with before/after audit verified_local; capacity allocations live on sessions; closure calendar and queue-policy settings not built" }],
  [35, "Products/antigens", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/clinical", tests: "tests/db/schedule.test.ts", evidence: "UI implemented; DB governance verified_local; UI not browser-exercised" }],
  [36, "Schedule configuration/review", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/clinical/schedules", tests: "tests/db/schedule.test.ts", evidence: "import/review/approve/activate/retire UI implemented; DB lifecycle verified_local; UI not browser-exercised" }],
  [37, "Content/templates/SMS settings", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/content", tests: "tests/db/config.test.ts", evidence: "reviewed content publishing verified_local; message templates are fixed in code and there is no provider secret UI (secrets stay in the deployment)" }],
  [38, "Review cases/duplicate resolution", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/review", evidence: "link/duplicate/edit cases implemented; DB verified_local; UI not fully browser-exercised" }],
  [39, "Audit/security/privacy requests", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/audit; 0024 search_audit", tests: "tests/db/config.test.ts", evidence: "read-only audit search with filters, paging and self-audit verified_local and in the browser; privacy requests (export/deletion) and investigation notes not built" }], [40, "Backup/retention/job status", "1", { status: "in_progress", impl: "src/app/clinic/[clinicId]/settings; 0024 get_ops_status", tests: "tests/db/config.test.ts", evidence: "recorded restore/backup checks and real queue health verified_local; unknown stays unknown; retention scheduling not built" }],
];
for (const [n, t, ph, o] of P) add({ id: `P${String(n).padStart(2, "0")}`, kind: "P", section: "BP38", title: t, phase: ph, ...o });

// ---- Acceptance scenarios -----------------------------------------------------------------------------------------
const T: [number, string, Partial<Row>?][] = [
  [1, "Linked guardian reads; unrelated guardian denied", { status: "verified_local", tests: "tests/db/registry.test.ts (guardian self-registration; linking to an existing child)", evidence: "npm run test:db" }],
  [2, "Two bookings race for one slot", { status: "verified_local", tests: "tests/db/visits.test.ts (booking and capacity)", evidence: "npm run test:db; a mutation run without the session lock failed the many-booking test (8 confirmed for capacity 3)" }], [3, "Signed administration commits atomically", { status: "verified_local", tests: "tests/db/administration.test.ts (normal recording)", evidence: "event, revision, one stock issue, credit, outbox, audit, receipt in one transaction" }],
  [4, "DB failure after event insert rolls back", { status: "verified_local", tests: "tests/db/administration.test.ts (idempotency and atomic rollback)", evidence: "a trigger injected a fault after the stock movement: no event, revision, receipt or stock change remained" }],
  [5, "Lost response retry returns original receipt", { status: "verified_local", tests: "tests/db/administration.test.ts (idempotency and atomic rollback); registry.test.ts; inventory.test.ts", evidence: "same key returns the original receipt; concurrent duplicates create one event and one stock issue" }],
  [6, "Operation key reused with changed payload", { status: "verified_local", tests: "tests/db/administration.test.ts (idempotency and atomic rollback); registry.test.ts", evidence: "reuse with a different payload is CV409 and changes nothing" }],
  [7, "Too-early dose blocked/reviewed", { status: "verified_local", tests: "tests/db/administration.test.ts (timing and eligibility; exception intake)", evidence: "planned path refuses with an explanation and writes nothing; already-given path preserves the fact, posts the real stock use, opens review and grants no credit" }],
  [8, "Combination product credits", { status: "verified_local", tests: "tests/db/administration.test.ts (a combination product uses one physical dose)", evidence: "one stock issue, one credit per antigen" }],
  [9, "Outside vaccination submitted by parent", { status: "verified_local", tests: "tests/db/evidence.test.ts (outside evidence never becomes credit without verification)", evidence: "npm run test:db; also seen in browser" }],
  [10, "Similar names / twins remain separate", { status: "verified_local", tests: "tests/db/registry.test.ts (staff registration, duplicates and twins)", evidence: "npm run test:db" }],
  [11, "Confirmed duplicate merge preserves history/aliases", { status: "in_progress", tests: "tests/db/registry.test.ts (merge and aliases)", evidence: "registry/relationship/enrollment/QR part verified_local; clinical history/certificates pending" }],
  [12, "Approved catch-up fixture"], [13, "Expired/recalled/quarantined lot blocked", { status: "verified_local", tests: "tests/db/inventory.test.ts (disposition; issue primitive); administration.test.ts", evidence: "quarantined, recalled, expired and unstocked lots are refused at recording; nothing is written" }],
  [14, "Last usable stock race", { status: "verified_local", tests: "tests/db/inventory.test.ts (issue for administration); administration.test.ts (exception intake)", evidence: "exactly one concurrent issue wins; actual care that loses the race or lacks stock is preserved through the exception path" }],
  [15, "Physical dose without ledger", { status: "verified_local", tests: "tests/db/administration.test.ts (never invents stock)", evidence: "unknown or recalled lot: care kept, no fake lot or negative stock, reconciliation item opened" }],
  [16, "Correction changes lot", { status: "verified_local", tests: "tests/db/administration.test.ts (corrections keep history)", evidence: "original revision retained, reversal plus new issue, total physical use unchanged; refused when the correct lot cannot supply it" }],
  [17, "Two devices change same identity field"], [18, "Offline out-of-order dependencies"], [19, "Offline user revoked before reconnect"], [20, "Logout with pending operations"],
  [21, "Device storage failure"],
  [22, "Copied QR used anonymously or by wrong clinic", { status: "verified_local", tests: "tests/db/registry.test.ts (QR pass)", evidence: "npm run test:db" }],
  [23, "Certificate revoked/corrected", { status: "verified_local", tests: "tests/db/certificates.test.ts (corrections and replacement)", evidence: "correction of a shown fact marks the certificate under review; old snapshot preserved; replacement links and revokes the old one" }], [24, "Forged paper with copied QR", { status: "in_progress", tests: "tests/db/certificates.test.ts (immutability and privacy)", evidence: "random 256-bit token, hash-only storage, public answer without child data verified_local; authorised content-comparison view not built" }], [25, "SMS accepted but response lost"], [26, "Appointment rescheduled before reminder", { status: "in_progress", tests: "tests/db/visits.test.ts (cancel and reschedule)", evidence: "obsolete queued confirmation cancelled and one new job enqueued verified_local; the worker that sends messages is not built" }],
  [27, "Transfer fails before commit"], [28, "Restore older backup vs client receipts"], [29, "Screen reader signs administration"], [30, "Report counts for combos/outside/voided"],
  [31, "Rule version changes effective cohort", { status: "in_progress", tests: "tests/db/evidence.test.ts (rule version changes); tests/db/schedule.test.ts", evidence: "impact preview, pinned/retained evaluations verified_local; flagging affected bookings needs M05" }],
  [32, "Admin requests data beyond scope", { status: "in_progress", tests: "tests/db/foundation.test.ts (capability scope; staff membership lifecycle)", evidence: "tech-admin denied clinical capability + grant self-approval verified_local; export/privacy-officer parts pending" }],
];
for (const [n, t, o] of T) add({ id: `T${String(n).padStart(2, "0")}`, kind: "T", section: "BP44", title: t, phase: "-", ...o });

// ---- Child requirements (individual constraints; a feature is not done after its happy path) ------------------------
const C: [string, string, string, string, string, Status, string?][] = [
  ["C-M01-01", "BP28.2", "auth.users is authentication identity; profiles, guardians, staff memberships are distinct; phone is not a person identifier", "0001,0003", "foundation.test.ts; registry.test.ts (shared phone)", "verified_local"],
  ["C-M01-02", "BP30", "Profile row created server-side only; users cannot change status/role (column grants)", "0001", "foundation.test.ts (profiles)", "verified_local"],
  ["C-M01-03", "BP14/BP31", "Staff capability = active membership + validity window + active clinic + active profile, re-checked in DB per call", "0001 private.has_capability", "foundation.test.ts (capability scope)", "verified_local"],
  ["C-M01-04", "BP32", "Staff capabilities require an aal2 session (DB-enforced, switchable only by deployment setting)", "0001 private.mfa_ok", "foundation.test.ts (MFA enforcement)", "verified_local"],
  ["C-M01-05", "BP32", "Supabase TOTP enrolment/challenge UI", "src/app/account/security", "tests/e2e/02-first-staff.spec.ts, 03-staff-application.spec.ts", "verified_local", "local Supabase stack; hosted project pending"],
  ["C-M01-06", "BP14/T32", "Two-person grants; clinical grants need a different grant.approve.clinical holder; no self-approval; tech admin lacks clinical capability", "0002", "foundation.test.ts (lifecycle)", "verified_local"],
  ["C-M01-07", "BP34", "Audit append-only (UPDATE/DELETE/TRUNCATE rejected even for owner); actor or system job required", "0001", "foundation.test.ts (audit trail)", "verified_local"],
  ["C-M01-08", "BP31", "Idempotent command receipts: same key+payload replays; different payload = CV409; concurrent same key = one effect", "0001 begin_command", "foundation.test.ts; registry.test.ts", "verified_local"],
  ["C-M01-09", "BP31/BP32", "anon has no table/function access except curated public views/functions; private schema unreachable; SECURITY DEFINER pins search_path", "0001-0005", "foundation.test.ts (function hardening)", "verified_local"],
  ["C-M01-10", "BP30/BP32", "API: same-origin (CSRF) enforcement, required Idempotency-Key, safe error mapping, rate limits, allow-listed RPCs", "src/lib/api, src/lib/security", "tests/unit/security.test.ts; curl probes recorded in verification.md", "verified_local", "rate limiter is per-instance (known limitation)"],
  ["C-M02-01", "BP15.A/T10", "Provisional child: guardian sees identity only; response identical whether or not similar record exists", "0003 create_child_provisional", "registry.test.ts", "verified_local"],
  ["C-M02-02", "BP14/BP32", "Staff search/open only for children enrolled at their clinic; missing vs foreign child indistinguishable; denials audited; query text never logged", "0003", "registry.test.ts (clinic scope)", "verified_local"],
  ["C-M02-03", "T01", "Guardian link request grants nothing and reveals nothing; approval needs guardian.verify at the child's clinic", "0003", "registry.test.ts (linking)", "verified_local"],
  ["C-M02-04", "T10", "Duplicate candidates are staff-only; twins registered separately when confirmed; never auto-merged", "0003", "registry.test.ts", "verified_local"],
  ["C-M02-05", "T11", "Merge: reviewer-only, locked ordering, relationships/enrollments moved, alias resolves, row preserved", "0003 merge_children", "registry.test.ts (merge)", "verified_local", "clinical history/certificate repointing added when those modules exist"],
  ["C-M02-06", "T22", "QR is opaque, hashed at rest, revocable, staff-scoped; every failure is a generic null", "0003", "registry.test.ts (QR pass)", "verified_local"],
  ["C-M02-07", "BP28", "Identity edit uses optimistic version, reason for identity fields, whitelisted fields, before/after audit", "0003 update_child_identity", "registry.test.ts (identity edits)", "verified_local"],
  ["C-M02-08", "BP28.1", "Tenant-consistent composite FKs reject cross-organization references", "0003", "registry.test.ts (tenant integrity)", "verified_local"],
  ["C-M02-09", "BP36/BP38", "UI flows against real DB commands via local shim: guardian adds child; staff searches, opens, confirms identity, verifies guardian, issues QR", "src/app/**", "in-app browser session 2026-09-29 (docs/implementation/verification.md)", "verified_local", "local shim, not Supabase Auth"],
  ["C-M02-10", "BP33", "Privacy notice acknowledgement UI + guardian contact preferences", "0022/0034 acknowledge_clinic_privacy_notice (per clinic); 0003 acknowledge_privacy_notice superseded and revoked from API roles in 0040", "-", "in_progress"],
  ["C-M02-11", "BP15.A", "Camera QR scanning with manual fallback", "-", "-", "not_started"],
  ["C-M02-12", "BP41", "Clearing an optional field via PATCH (empty string is dropped by request normalisation)", "src/lib/validation/schemas.ts", "-", "not_started", "known defect, see known-limitations.md"],
];
const C3: [string, string, string, string, string, Status, string?][] = [
  ["C-M03-01", "BP16", "Engine supports only the typed vocabulary (age offsets, min/max age, per-predecessor intervals, accepted products, windows); anything else is rejected at import", "0007, 0008", "schedule.test.ts (schedule import validation)", "verified_local"],
  ["C-M03-02", "BP16", "Full status model incl. past-recommended (no invented overdue threshold); 13 fixture scenarios pass", "0007 evaluate_rules", "schedule.test.ts (engine fixtures)", "verified_local"],
  ["C-M03-03", "BP16/BP39", "Months are calendar months: 31 Aug + 1 month = 30 Sep; 31 Jan 2024 + 1 month = 29 Feb", "0007 add_age", "schedule.test.ts (F10, F11)", "verified_local"],
  ["C-M03-04", "T08", "Combination product credits each antigen once from a single event; the same antigen is never credited twice by one dose", "0007", "schedule.test.ts (F12); evidence.test.ts", "verified_local"],
  ["C-M03-05", "T07", "Doses outside rule limits are preserved, never auto-credited, and flagged once for staff review", "0007", "evidence.test.ts (Too Early)", "verified_local", "no grace periods implemented: needs clinical policy input"],
  ["C-M03-06", "T09", "Parent/BHW/unverified evidence never earns credit; verification is a new immutable revision attributed to the verifier", "0009", "evidence.test.ts", "verified_local"],
  ["C-M03-07", "BP28.3", "Events, revisions, evaluations and dose credits are immutable (even for the DB owner)", "0006", "evidence.test.ts", "verified_local"],
  ["C-M03-08", "BP16", "Evaluations are deterministic, hashed by inputs, stored as snapshots; new facts add a snapshot; old ones retained", "0007 compute_child_schedule", "evidence.test.ts (determinism)", "verified_local"],
  ["C-M03-09", "BP16/BP38", "Schedule lifecycle: draft, review, approved, active; proposer cannot approve; fixtures must pass; content frozen after draft; one active version; retire stops use immediately", "0006, 0008", "schedule.test.ts; evidence.test.ts (retiring)", "verified_local"],
  ["C-M03-10", "BP16", "Demo schedules can be neither imported nor activated unless demo_mode is on; real schedules must cite a source", "0008", "schedule.test.ts", "verified_local"],
  ["C-M03-11", "BP28.3", "Master data activation needs rules.approve and a different person than the creator; product conversions immutable once used", "0008, 0009", "schedule.test.ts; evidence.test.ts", "verified_local"],
  ["C-M03-12", "BP16", "With no active schedule the system returns an explicit no-schedule state and invents no dates", "0007", "evidence.test.ts", "verified_local"],
  ["C-M03-13", "BP14/BP33", "Guardian schedule view is a limited projection computed on demand (nothing persisted); needs verified full access", "0007 guardian_get_schedule", "evidence.test.ts (history views)", "verified_local"],
  ["C-M03-14", "BP41", "Merged records contribute verified history to the survivor", "0007 child_ids_with_aliases", "evidence.test.ts", "verified_local"],
  ["C-M03-15", "BP36/BP38", "UI: DEMO-labelled schedule with text+icon statuses; guardian-reported dose shows Waiting for clinic check", "src/components/schedule-view.tsx; pages", "in-app browser session 2026-09-30 (verification.md)", "verified_local", "local shim, not Supabase Auth"],
  ["C-M03-16", "BP15.C", "Evidence file upload/preview (Storage, malware scan)", "0006 record_attachments (table only)", "-", "blocked_external", "needs Supabase Storage"],
  ["C-M03-17", "BP16", "Clinical hold placement/resolution command + UI (engine already honours holds)", "-", "-", "not_started"],
  ["C-M03-18", "BP16/F11", "Catch-up planner and reviewed plans", "-", "-", "not_started", "Phase 2 + clinical policy"],
];
const C4: [string, string, string, string, string, Status, string?][] = [
  ["C-M04-01", "BP19", "Ledger is immutable (update/delete/truncate rejected); projection equals ledger; reconcile detects drift and repairs the projection only", "0011", "inventory.test.ts (ledger is the truth)", "verified_local"],
  ["C-M04-02", "BP19", "Physical on-hand, usable, quarantine and expired are distinct numbers; unaccepted deliveries book into quarantine", "0011 usable_on_hand, receive_stock", "inventory.test.ts", "verified_local"],
  ["C-M04-03", "T13", "Quarantined/recalled/expired lots are excluded from usable stock and refused by the issue primitive; recall/release need inventory.approve", "0011", "inventory.test.ts (lot disposition)", "verified_local"],
  ["C-M04-04", "T14", "Concurrent last-unit postings (issue vs issue, issue vs wastage): exactly one wins, no negative stock, no orphan transaction", "0011 post_movement", "inventory.test.ts (issue for administration; wastage)", "verified_local"],
  ["C-M04-05", "T05/T06", "Receipts are idempotent (same key concurrent = one movement); reused key with different quantity is a conflict", "0011", "inventory.test.ts (replays idempotently)", "verified_local"],
  ["C-M04-06", "BP19", "Count differences above threshold need a different approver; approval re-derives the delta from the current balance; proposer and approver both recorded", "0011", "inventory.test.ts (physical count adjustments)", "verified_local"],
  ["C-M04-07", "BP19", "Exact numeric unit conversion; multi-dose products blocked from issue until the vial workflow exists", "0011 doses_to_stock_units, issue_for_administration", "inventory.test.ts", "verified_local"],
  ["C-M04-08", "BP28.4", "Stock is clinic-scoped: staff of another clinic (same org) cannot read/post; no direct table access for API roles", "0011", "inventory.test.ts (who may do what)", "verified_local"],
  ["C-M04-09", "BP19", "Expiry-day interpretation is a policy switch (expiry_last_day_usable) pending cold-chain validation", "0011 settings", "inventory.test.ts (expired lot)", "verified_local", "Requires external validation"],
  ["C-M04-10", "BP19", "Inter-clinic transfers, in-transit custody, temperature logs, vial sessions, forecasting", "-", "-", "not_started", "Phase 2"],
];
const C5: [string, string, string, string, string, Status, string?][] = [
  ["C-M05-01", "T02", "Booking serialises on the session row: concurrent bookings never exceed online capacity (mutation-tested)", "0013 book_appointment", "visits.test.ts", "verified_local"],
  ["C-M05-02", "BP17", "Duplicate booking of a child in a session is blocked; closed/cancelled/finished sessions refuse bookings", "0012 index, 0013", "visits.test.ts", "verified_local"],
  ["C-M05-03", "BP14", "Only a verified full-access guardian or scoped appointment staff can book; provisional guardians cannot", "0013 can_book_for", "visits.test.ts", "verified_local"],
  ["C-M05-04", "BP17", "Reschedule is atomic (failed move leaves the original), links replaces_id, frees the old slot; opposite concurrent moves do not deadlock", "0013 reschedule_appointment", "visits.test.ts", "verified_local"],
  ["C-M05-05", "BP17", "Closing a session cancels no booking: each booking gets a follow-up case and an outbox notice", "0013 cancel_session", "visits.test.ts", "verified_local"],
  ["C-M05-06", "BP17", "Ticket numbers are unique, gapless under concurrency, per clinic per local day, never reused", "0012 allocate_ticket", "visits.test.ts", "verified_local"],
  ["C-M05-07", "BP17", "Walk-ins draw on reserved allocation; overflow needs a recorded reason (audited); booking alone never issues a ticket", "0013 check_in", "visits.test.ts", "verified_local"],
  ["C-M05-08", "BP17", "Queue state machine: legal transitions only, versioned, reasons required, events append-only; encounter starts at service and completes with an outcome; fulfilled != all doses given", "0013 queue_transition", "visits.test.ts", "verified_local"],
  ["C-M05-09", "BP17", "call_next: priority then FIFO, SKIP LOCKED (two stations never get the same patient); priority needs a reason", "0013 call_next", "visits.test.ts", "verified_local"],
  ["C-M05-10", "BP17/BP33", "Public display exposes ticket numbers and stations only; guardians see only their own child's ticket with people ahead", "0013", "visits.test.ts (views and privacy)", "verified_local"],
  ["C-M05-11", "BP22", "Durable outbox with dedupe keys; cancel/reschedule withdraw unsent confirmations (worker not built)", "0012 outbox_jobs", "visits.test.ts", "verified_local", "worker/SMS/in-app delivery arrives in M07/M09"],
  ["C-M05-12", "BP17", "UI: guardian booking and clinic-today queue/walk-in/session pages; waiting-room display", "src/app/**", "in-app browser session 2026-09-30 (verification.md)", "verified_local", "local shim, not Supabase Auth; realtime replaced by 15s/5s refresh"],
  ["C-M05-13", "BP17", "Estimated wait time, closure calendar/holidays, multi-station prefixed offline tickets", "-", "-", "not_started"],
];
const C6: [string, string, string, string, string, Status, string?][] = [
  ["C-M06-01", "BP18", "One transaction: identity, open visit, lot/stock, schedule check, event + signed revision, one stock issue, encounter refs, evaluation, outbox, audit, receipt; any failure saves nothing (incl. injected fault)", "0015 record_administration", "administration.test.ts", "verified_local"],
  ["C-M06-02", "BP18", "Recorder, vaccinator and actual time are distinct; a named vaccinator must hold the capability; time cannot be in the future", "0015", "administration.test.ts", "verified_local"],
  ["C-M06-03", "T07", "Planned administration is refused (with the reason) for unconfirmed identity, unknown birth date, holds, or schedule-limit violations; nothing is written", "0015 check_planned_dose", "administration.test.ts", "verified_local"],
  ["C-M06-04", "BP39", "Similar same-day record needs explicit repeat confirmation; a confirmed repeat must still satisfy the schedule or use the exception path", "0015", "administration.test.ts", "verified_local"],
  ["C-M06-05", "T15", "Exception intake keeps actual care as pending evidence, posts stock only when the lot is known, usable and stocked, opens clinical and stock review, grants no credit; accept/reject is a new revision by a different person", "0015", "administration.test.ts", "verified_local"],
  ["C-M06-06", "T16", "Corrections (details, wrong child, duplicate void) are proposals; a different person approves; new revision keeps the original; stock changes only when physical facts change; duplicates return to stock or become wastage; credits recalculated", "0015", "administration.test.ts", "verified_local"],
  ["C-M06-07", "BP19", "Multi-dose presentations are refused until the vial workflow exists", "0011, 0015", "administration.test.ts", "verified_local"],
  ["C-M06-08", "BP36", "UI: review-before-signing showing the child's name and record number; persistent result; exception and correction forms; review-queue decisions; lot trace", "src/app/clinic/**", "in-app browser session 2026-09-30 (recording); DB tests for the rest", "verified_local", "review-queue decision UI not browser-exercised"],
];
const C12: [string, string, string, string, string, Status, string?][] = [
  ["C-M12-01", "F26", "Record transfer inside one organization needs guardian consent (in the app or recorded in person by staff who verified them), release by a clinical lead of the current clinic and acceptance by the receiving clinic; nothing moves before acceptance; one open transfer per child; cross-organization targets refused", "0023 record_transfers", "record-transfer.test.ts", "verified_local"],
  ["C-M12-02", "F26", "At acceptance access moves with the enrollment (old clinic loses the child, new clinic gets it with the full history, guardian view unchanged), future bookings at the old clinic are cancelled with a message, an open visit blocks the move, concurrent accepts are safe", "0023", "record-transfer.test.ts", "verified_local"],
  ["C-M12-03", "F26", "The receiving clinic sees no child details before release; either clinic or the guardian can stop a transfer before completion; closed transfers stay closed; audit at every step", "0023", "record-transfer.test.ts", "verified_local"],
  ["C-M12-04", "BP36", "UI: guardian request/cancel, staff transfers page (release/accept/decline) and child-page start; axe clean; two-clinic flow completed in the in-app browser", "src/app/**", "in-app browser + axe 2026-09-30", "verified_local"],
  ["C-M12-05", "F26", "Transfer between different organizations or to external systems", "-", "-", "blocked_external", "needs a data-exchange agreement and a partner specification (external-validation.md)"],
  ["C-M12-06", "F27", "Growth monitoring and percentiles", "-", "-", "blocked_external", "needs an approved growth reference and clinical protocol; the system will not invent one"],
];
const C14: [string, string, string, string, string, Status, string?][] = [
  ["C-M14-01", "P34", "Clinic profile (name, address, contact, hours, time zone) only by admin.config with MFA, validated, before/after audited, idempotent; the public directory shows exactly what was typed and nothing when blank", "0024 update_clinic_profile", "config.test.ts", "verified_local"],
  ["C-M14-02", "F19", "Care information: clinic-written, second-person approved, frozen once submitted, one active version per item and language, replaced on newer approval, withdrawable; families see only active wording of their clinic in their language with a marked English fallback; the system ships none", "0024 content_*", "config.test.ts", "verified_local", "content correctness is the clinic's responsibility"],
  ["C-M14-03", "P39", "Audit search: audit.read with MFA only, organization-scoped (never another organization), filters/paging, wildcards not interpreted, every search audited, no edit or delete path", "0024 search_audit", "config.test.ts", "verified_local"],
  ["C-M14-04", "P40", "Operations status shows only recorded restore/backup checks (unknown stays unknown) and live outbox/SMS queue health; checks are append-only, dated (not future) and need an evidence reference", "0024 record_ops_check, get_ops_status", "config.test.ts", "verified_local"],
  ["C-M14-05", "BP36", "UI: settings and operations, care information (staff) and family help page, audit trail; axe clean", "src/app/**", "in-app browser + axe 2026-09-30", "verified_local"],
];
const C13: [string, string, string, string, string, Status, string?][] = [
  ["C-M13-01", "BP31", "Sweep of every command API roles can execute (133 at the time): no internal error for any role with junk arguments; a signed-in user with no role or link receives nothing from any clinic-scoped command; anonymous callers reach only the three deliberately public commands; a mutation run with a planted leaking function and a planted crashing function failed the sweep as intended", "-", "sweep.test.ts", "verified_local"],
  ["C-M13-02", "BP32", "Per-request nonce Content-Security-Policy: production scripts need the request nonce (no unsafe-inline/unsafe-eval), no third-party origins; verified on a production build (nonce on every script, no console violations) and by unit test", "src/proxy.ts", "csp.test.ts; production build check 2026-09-30", "verified_local", "not exercised against Supabase-hosted pages"],
  ["C-M13-03", "BP32", "Application pages and API responses are sent with Cache-Control: private, no-store; cross-origin isolation headers set", "next.config.ts", "curl on a production build 2026-09-30", "verified_local"],
  ["C-M13-04", "BP32", "Dependency audit (npm audit: 0 vulnerabilities) and a secret scan of tracked files (none found) at this commit", "-", "npm audit; git grep 2026-09-30", "verified_local", "repeat before every release"],
  ["C-M13-05", "BP40", "Error and not-found screens reveal no internals and use one screen for missing and forbidden records", "src/app/error.tsx; not-found.tsx", "-", "implemented_unverified", "not exercised in a browser"],
  ["C-M13-06", "BP32", "Independent penetration test, shared (multi-instance) rate limiting and security monitoring/alerting", "-", "-", "not_started", "needs an external tester and a hosting environment"],
];
const C10: [string, string, string, string, string, Status, string?][] = [
  ["C-M11-01", "F10", "Follow-up worklist is derived from the engine's own results for the clinic's approved schedule (property-tested against evaluate_child); with no active schedule it says so and lists nothing; snapshots go stale on schedule activation, new vaccinations and holds, and refresh is bounded", "0022 refresh_followup, list_followup_worklist", "followup.test.ts", "verified_local"],
  ["C-M11-02", "F10", "Only staff who follow families up (bhw.followup or clinical) can list; phone numbers only for bhw.followup and only as recorded; listing is audited; attempts are append-only, idempotent, validated and snooze a child until the next-try date", "0022", "followup.test.ts", "verified_local"],
  ["C-M03-30", "F09", "Clinical holds: placed by clinical staff, released only by a clinical lead with a reason; the engine flags every requirement for review while a hold is active; notes are never shown to guardians", "0022 place/release_clinical_hold", "followup.test.ts", "verified_local"],
  ["C-M02-30", "F04", "Privacy notice: text and version come only from the clinic (admin.config); guardians must accept the current version before adding or linking a child, enforced in the database with the original commands no longer callable; new versions require new acceptance; staff registration is not blocked", "0022 set/get_privacy_notice, acknowledge_clinic_privacy_notice", "followup.test.ts", "verified_local", "notice wording is the privacy owner's (external-validation.md)"],
  ["C-M02-31", "F02", "Camera QR scanning using the browser's BarcodeDetector with typed-code fallback; decoding is local and the stream stops after a scan", "src/app/clinic/[clinicId]/qr-scanner.tsx", "renders and falls back in the in-app browser; no camera available to test a real scan", "implemented_unverified", "real scan needs a camera and a supporting browser"],
  ["C-M02-32", "F02", "Guardian edit-request UI (asks the clinic; nothing changes until staff decide)", "src/app/children/[childId]/edit-request.tsx", "server side: registry.test.ts", "implemented_unverified", "form not exercised in a browser"],
  ["C-M11-03", "BP36", "UI: follow-up list with attempt logging, hold panel, privacy notice publishing and acceptance; axe clean", "src/app/clinic/[clinicId]/followup; holds.tsx; children/privacy-notice.tsx", "in-app browser + axe 2026-09-30", "verified_local"],
];
const C9: [string, string, string, string, string, Status, string?][] = [
  ["C-M09-01", "F13", "Transfers keep stock on the books in an in-transit location (send and receive are separate ledger transactions that each net to zero); only usable, unexpired lots from usable locations can be sent; only the receiving clinic's stock staff can receive", "0019 send/receive_stock_transfer", "transfers.test.ts", "verified_local"],
  ["C-M09-02", "F13", "Short or refused deliveries: missing units stay visibly in transit, a review case opens, a person other than the sender writes off or returns them; unaccepted stock goes to quarantine; cancel restores the source", "0019", "transfers.test.ts", "verified_local"],
  ["C-M09-03", "BP19", "Projection equals ledger for both clinics after every transfer path and the stock report reconciles for both", "0019 report_stock_summary", "transfers.test.ts", "verified_local"],
  ["C-M09-04", "F14", "Temperature readings are always kept, validated (range, time), immutable and judged only against approver-recorded limits that carry a policy reference; readings keep the limits in force when taken; no automatic quarantine", "0019", "transfers.test.ts", "verified_local", "limit values are clinic policy"],
  ["C-M09-05", "F14", "An excursion stays open until a different approver records what was done; open excursions, short transfers and in-transit stock appear in the backlog report", "0019", "transfers.test.ts", "verified_local"],
  ["C-M09-06", "BP36", "UI: transfers (send, receive, cancel, resolve) and cold chain (log, limits, review) pages with sub-navigation; axe scan clean", "src/app/clinic/[clinicId]/inventory/**", "in-app browser + axe 2026-09-30", "verified_local"],
  ["C-M09-07", "F18", "Contact preferences and consent: number must be checked in person before opt-in; changing the number withdraws check and opt-in; consent/withdrawal history is append-only; SMS wording is fixed and carries no child name, vaccine or clinical detail; clinical events never produce SMS", "0020 set_contact_preferences, verify_guardian_contact, notify_guardians", "sms.test.ts", "verified_local"],
  ["C-M09-08", "F18", "SMS pipeline: claim (SKIP LOCKED, opted-in only), send outside any transaction, mark sent/retry/failed with backoff and attempt cap, reclaim stuck messages; idempotent, order-tolerant, signature-verified provider callbacks; STOP reply withdraws consent; provider-neutral adapter contract and sandbox provider", "0020; src/lib/sms/*; api/v1/webhooks/sms", "sms.test.ts; sms-dispatch.test.ts; sms.test.ts (unit)", "verified_local", "sandbox only: nothing is actually sent"],
  ["C-M09-09", "F18", "A real SMS provider adapter with delivery receipts", "-", "-", "blocked_external", "needs a provider account/sandbox and its receipt contract (external-validation.md)"],
  ["C-M09-10", "BP36", "UI: guardian text-message settings (number, language, opt in/out) and staff in-person number check; axe clean", "src/app/messages; clinic child page contacts.tsx", "in-app browser + axe 2026-09-30", "verified_local"],
  ["C-M09-11", "F11", "Catch-up plans are written by clinical staff with a stated reason and policy reference, frozen on submission, approved by a different person with rules.approve, one approved plan per child, items marked done/dropped with a note; the plan never changes the schedule engine, credits doses or books visits; guardians see only the approved plan without clinical reasoning", "0021 catchup_*", "catchup.test.ts", "verified_local", "plans are only as correct as the clinician who writes them; no catch-up rules ship"],
  ["C-M09-12", "F20", "Check-ins are OFF until a clinical lead records the safety notice (no default wording); guardians with full access send a question and see the clinic's own notice; staff (clinical) read and reply; nothing is answered, ranked or triaged by software beyond listing vaccination-related questions first; replies reach only the guardian; history kept", "0021 checkins", "catchup.test.ts", "verified_local", "safety notice wording is the clinic's decision (external-validation.md)"],
  ["C-M09-13", "BP36", "UI: staff catch-up panel, Questions and plans page with policy form, guardian care plan and Ask the clinic; axe clean", "src/app/**", "in-app browser + axe 2026-09-30", "verified_local"],
];
const C8: [string, string, string, string, string, Status, string?][] = [
  ["C-M08-01", "F33", "Reports need report.run (MFA, clinic scope); period validated (max 366 days); every view is audited", "0018", "reports.test.ts", "verified_local"],
  ["C-M08-02", "F33", "Daily activity, vaccinations by product and stock summary are computed from current revisions, queue and ledger; voided events excluded; ledger-vs-projection check exposes corruption; no names or identifiers appear", "0018", "reports.test.ts", "verified_local"],
  ["C-M08-03", "BP27", "CSV export is audited, applies the configurable small-cell rule (suppressed cells and totals withheld, never zero) and neutralises spreadsheet formulas", "0018; src/lib/reports/csv.ts", "reports.test.ts; csv.test.ts", "verified_local", "threshold value needs privacy-owner approval"],
  ["C-M08-04", "BP41", "Paper reconciliation: append-only tallies, latest entry counts, differences shown not edited, no-tally days flagged, clinical staff may enter", "0018", "reports.test.ts", "verified_local"],
  ["C-M08-05", "BP43", "Backup and restore drill: dump, restore into a fresh database, then verify row counts, ledger = projection, certificate hashes and document checksums, guard triggers, RLS and API-role privileges; a tampered certificate makes the drill fail", "scripts/backup-drill.ts", "npm run drill:restore (local PostgreSQL only)", "verified_local", "Supabase backups/PITR and Storage not exercised"],
  ["C-M08-06", "BP35", "Automated accessibility scan (axe-core, WCAG 2.2 A/AA + best practice) of the main guardian, staff, public and report pages: violations found (unlabelled landmark banner, unfocusable scroll region) were fixed and the re-scan is clean; no horizontal scroll at 375 px", "src/app/**", "in-app browser + axe-core 2026-09-30", "implemented_unverified", "keyboard-only walkthrough, screen reader, 200% zoom and colour-blind checks not done; automated tools find only part of the problems"],
  ["C-M08-07", "BP42", "Measured performance on 20,000 synthetic children (search, record open, history, reports, concurrent search) recorded in verification.md", "scripts/perf.ts", "npm run perf", "verified_local", "single local machine; no load balancer, Supabase or network; no agreed targets to compare against"],
  ["C-M08-08", "BP44", "Operational runbook and role training guides; MVP checklist reconciled against the matrix", "docs/operations/*", "-", "implemented_unverified", "training not delivered; UAT with real staff not run"],
];
const C7: [string, string, string, string, string, Status, string?][] = [
  ["C-M07-01", "BP20", "Certificate freezes an immutable snapshot of VERIFIED, ACTIVE revisions only (pending/rejected/voided excluded); clinic doses show the lot, outside doses show their source; content hash stored", "0017 issue_certificate", "certificates.test.ts", "verified_local"],
  ["C-M07-02", "BP20", "Only certificate.issue holders with MFA at the clinic can issue or revoke; idempotent per key; nothing verified means nothing to certify", "0017", "certificates.test.ts", "verified_local"],
  ["C-M07-03", "T23", "Certificates, items and stored documents cannot be updated, deleted or truncated (even by a superuser); a revoked certificate stays revoked", "0017 guards", "certificates.test.ts", "verified_local"],
  ["C-M07-04", "BP20", "Public verification returns status, number, clinic and date only; token is random, only its hash is stored, never in receipts; unknown/malformed/pending tokens look identical", "0017 verify_certificate", "certificates.test.ts", "verified_local"],
  ["C-M07-05", "BP20", "Document is generated after the snapshot, stored privately and only then issued; a failed render leaves it pending and retryable; reprints return the same stored bytes; guardians reach only their own issued certificates; downloads audited", "0017; src/lib/certificates", "certificates.test.ts; certificate-pdf.test.ts", "verified_local"],
  ["C-M07-06", "T23", "A correction that changes a shown fact (date, product, lot, child, void) marks the certificate under review without altering it; replacement links to and revokes the prior certificate; verified by mutation run", "0017 flag_certificates_for_review", "certificates.test.ts", "verified_local"],
  ["C-M07-07", "T11", "Certificates issued for a merged duplicate remain attributable to the surviving child", "0017", "certificates.test.ts", "verified_local"],
  ["C-M07-08", "BP22", "Outbox worker: bounded, SKIP LOCKED, exponential backoff, permanent failure for unknown types, expired locks reclaimed; in-app messages fixed wording, one per guardian per event, only to verified guardians; cancelled bookings withdraw confirmations", "0017 process_outbox; src/lib/worker", "certificates.test.ts", "verified_local"],
  ["C-M07-09", "BP36", "UI: staff certificate panel, guardian certificate list, public check page, message inbox with unread badge", "src/app/**", "in-app browser session 2026-09-30", "verified_local", "keyboard/screen-reader pass not done"],
  ["C-M07-10", "F16", "Certificate format, issuer wording and signatory are approved by the clinic and accepted by receiving institutions", "-", "-", "blocked_external", "needs clinic decision; see external-validation.md"],
];
for (const [id, section, title, impl, tests, status, note] of [...C, ...C3, ...C4, ...C5, ...C6, ...C7, ...C8, ...C9, ...C10, ...C12, ...C13, ...C14]) add({ id, kind: "C", section, title, phase: "1", impl, tests, status, blocker: note });

// ---- Validation / output -------------------------------------------------------------------------------------------
function validate() {
  const errs: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) errs.push(`duplicate id ${r.id}`);
    seen.add(r.id);
    if (!STATUSES.includes(r.status)) errs.push(`${r.id}: bad status ${r.status}`);
    if (r.status === "approved_exclusion") errs.push(`${r.id}: approved_exclusion needs recorded basis/approver (none supplied)`);
    if (r.status === "verified_local") {
      if (!r.tests || r.tests === "-") errs.push(`${r.id}: verified_local requires tests`);
      for (const t of (r.tests ?? "").split(/[;,]/).map((s) => s.trim().split(" ")[0]).filter((s) => /\.(test\.ts)$/.test(s ?? ""))) {
        const candidates = [t, `tests/db/${t}`, `tests/unit/${t}`];
        if (!candidates.some((c) => existsSync(resolve(ROOT, c)))) errs.push(`${r.id}: test file not found: ${t}`);
      }
    }
  }
  for (const [kind, n] of [["BP", 48], ["F", 37], ["D", 4], ["P", 40], ["T", 32]] as const) {
    const got = rows.filter((r) => r.kind === kind).length;
    if (got !== n) errs.push(`expected ${n} ${kind} rows, found ${got}`);
  }
  return errs;
}

const errs = validate();
if (errs.length) {
  console.error(errs.join("\n"));
  process.exit(1);
}
const count = (k: Row["kind"]) => {
  const rs = rows.filter((r) => r.kind === k && !r.info);
  const by = Object.fromEntries(STATUSES.map((s) => [s, rs.filter((r) => r.status === s).length]));
  return `${k}: ${rs.length} total — ` + STATUSES.filter((s) => by[s]).map((s) => `${by[s]} ${s}`).join(", ");
};
const esc = (s?: string) => (s ?? "").replace(/\|/g, "\\|");
const out = [
  "# Requirements Traceability Matrix",
  "",
  "> Generated by `npm run matrix` from `scripts/matrix.ts`. Do not edit by hand. Engineering `status` and the clinical/privacy `Release gate` are tracked separately.",
  "> `verified_local` = passes automated checks in the local disposable environment. It does NOT mean verified against Supabase, staged, or approved for clinical use.",
  "> BP01–BP12, BP45, BP46, BP48 are informational sections: their requirements are traced through the F, P, T and C rows.",
  "",
  "## Summary",
  "",
  ...(["F", "D", "P", "T", "C", "BP"] as const).map((k) => `- ${count(k)}`),
  "",
  "| Requirement ID | Blueprint section | Requirement | Phase/stage | Dependencies | Implementation | Verification/test | Status | Evidence | Blocker / approval owner | Release gate |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) =>
    `| ${r.id} | ${esc(r.section)} | ${esc(r.title)}${r.info ? " *(informational)*" : ""} | ${esc(r.phase)} | ${esc(r.deps)} | ${esc(r.impl)} | ${esc(r.tests)} | ${r.status} | ${esc(r.evidence)} | ${esc(r.blocker)} | ${esc(r.gate)} |`),
  "",
].join("\n");
const artifact = resolve(ROOT, "docs/implementation/requirements-matrix.md");
if (process.argv.includes("--check")) {
  if (!existsSync(artifact) || readFileSync(artifact, "utf8").replaceAll("\r\n", "\n") !== out) {
    console.error(`stale: ${artifact} (run npm run matrix)`);
    process.exit(1);
  }
  console.log(`matrix ok: ${rows.length} rows`);
} else {
  writeFileSync(artifact, out);
  console.log(`wrote requirements-matrix.md (${rows.length} rows)`);
  console.log(["F", "D", "P", "T", "C"].map((k) => count(k as Row["kind"])).join("\n"));
}
