# Family Vaccination Card and Staff Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add family manual/photo vaccination-card submissions, clinic review, role-appropriate patient search and notes, and administrator-created local staff accounts.

**Architecture:** Family-entered/OCR data is stored as a pending submission and never writes clinical history directly. Browser-only OCR produces editable candidates; PostgreSQL RPCs enforce clinic tenancy, role capabilities, independent approval, MFA, idempotency, and audit history. The admin console provisions confirmed local Auth identities through a server-only route, then uses the existing membership approval model.

**Tech Stack:** Next.js 16.3.8 App Router, React 19, TypeScript, Supabase Auth/PostgREST/PostgreSQL, Zod, Tesseract.js browser OCR, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-14-family-card-staff-workspace-design.md`

## Execution reconciliation — 15 October 2026

The task lists below preserve the original planning checklist; their proposed filenames and implementation details are superseded by these actual outcomes. Unchecked original lines do not imply that speculative duplicate pages, password retrieval or service credentials should be implemented.

- [x] Database card submissions/review/withdrawal and append-only staff notes: migrations 0050–0057, real-role tests in `tests/db/card-workflows.test.ts` and `tests/db/admin-staff-creation.test.ts`.
- [x] Family manual card form and status history embedded in the existing child page (`vaccination-card.tsx`), avoiding a duplicate page.
- [x] Bundled local OCR assets, separate camera/upload controls, editable multi-row extraction, explicit review, cancellation and timeout. All extracted fields are unverified; no calibrated confidence or handwriting guarantee.
- [x] Extend existing Find/register and child review surfaces, preserving capability separation and BHW intake/follow-up access.
- [x] Role-scoped notes with immutable author/role/time, optional vaccination-event link and guarded family visibility.
- [x] Admin-created accounts through public local Auth signup plus private reservation/finalization RPCs; no service key or retained password. Retry resumes rather than deletes an identity. Existing independent membership approval and MFA remain authoritative.
- [x] Preserve cards and notes across child merges; route actionable cards on transfer; serialize submission/review against merge/transfer child locks.
- [x] Add real OCR/admin browser tests in `tests/e2e/16-card-intake-admin.spec.ts`, and update affected existing role-navigation expectations.
- [x] Update the README and operational walkthrough. Final verification evidence and limitations are recorded separately in `docs/audit/2026-10-15-card-staff-local-readiness.md`; the earlier full-system audit remains historical.

Not implemented: duplicate patient/card-review dashboards, retained image previews/storage, password resend/retrieval, arbitrary new privilege roles, or automatic approval. These are unnecessary for the approved local workflows or would weaken existing security boundaries. Real camera/handwritten card acceptance requires human verification.

## Global Constraints

- Registration remains immediately confirmed; never add confirmation or verification email.
- OCR and image preprocessing stay in the browser; card images are not persisted or sent to an external service.
- Family submissions remain pending until authorized clinic review; no OCR value directly creates clinical history.
- Preserve MFA, RLS, clinic tenancy, capability checks, independent clinical approval, stock validation, immutable administration records, idempotency, and audit logs.
- Use existing operational tokens/components, responsive layouts, 44px targets, associated errors, keyboard operation, and reduced-motion behavior.
- Do not expose existing passwords, temporary passwords after initial creation, MFA secrets, hidden patients, or other clinics' records.

---

### Task 1: Pending card submissions and scoped staff notes

**Files:**
- Create: `supabase/migrations/0050_card_submissions_and_notes.sql`
- Modify: `supabase/install/verify.sql`
- Modify: `src/lib/db/port.ts`
- Create: `tests/db/card-submissions-notes.test.ts`

**Interfaces:**
- Produces RPCs `submit_card_record(uuid, uuid, jsonb)`, `withdraw_card_submission(uuid, uuid)`, `guardian_list_card_submissions(uuid)`, `staff_list_card_submissions(uuid, uuid)`, `review_card_submission(uuid, uuid, text, text, integer)`, `add_child_note(uuid, uuid, uuid, text, text)`, and `list_child_notes(uuid, uuid)`.
- Submission payload rows use `{ vaccineName, doseLabel, dateGiven, lotNumber, clinicName, notes, source, confidence }` and statuses `pending`, `changes_requested`, `approved`, `rejected`, `withdrawn`.

- [ ] Write role-switching database tests proving guardian ownership, pending-only family writes, clinic isolation, BHW note access, clinical approval, immutable decisions, and audit entries.
- [ ] Run `node node_modules/vitest/vitest.mjs run tests/db/card-submissions-notes.test.ts` and confirm it fails because the tables/RPCs do not exist.
- [ ] Add `card_submissions`, `card_submission_rows`, and `child_staff_notes` tables with RLS enabled and no direct authenticated writes; implement SECURITY DEFINER RPCs with empty search paths, stable row locks, bounded text/row counts, operation receipts, capabilities, MFA, and audit calls.
- [ ] Add all new RPC names to `RPC_ALLOWLIST`, regenerate install SQL, and add verification checks for tables, policies, grants, and functions.
- [ ] Rerun the focused database test and `npm run db:install-sql -- --check`; expect both to pass.

### Task 2: Family manual card workflow

**Files:**
- Create: `src/app/children/[childId]/card/page.tsx`
- Create: `src/app/children/[childId]/card/card-form.tsx`
- Create: `src/app/api/v1/children/[childId]/card-submissions/route.ts`
- Create: `src/lib/validation/card-submission.ts`
- Modify: `src/app/children/[childId]/page.tsx`
- Create: `tests/unit/card-submission-ui.test.ts`

**Interfaces:**
- Consumes `submit_card_record` and `guardian_list_card_submissions`.
- Produces `CardSubmissionInput` Zod schema and a family form with one to 20 rows.

- [ ] Write unit tests for row add/remove, required vaccine/date, ISO date bounds, length limits, duplicate warning, pending status, validation associations, and no clinical-approved language.
- [ ] Run the focused test and confirm the route/components are missing.
- [ ] Implement the schema, bounded POST/GET route using existing API error/idempotency helpers, server page, manual editable rows, confirmation checkbox, and status history.
- [ ] Link “Vaccination card” from the existing child record without changing other navigation.
- [ ] Run focused unit tests, route boundary tests, typecheck, and lint; expect clean results.

### Task 3: Browser-only photo OCR and review

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/lib/card-ocr/types.ts`
- Create: `src/lib/card-ocr/parse.ts`
- Create: `src/lib/card-ocr/browser-worker.ts`
- Create: `src/app/children/[childId]/card/card-scanner.tsx`
- Modify: `src/app/children/[childId]/card/card-form.tsx`
- Create: `tests/unit/card-ocr.test.ts`
- Create: `tests/unit/card-scanner.test.ts`

**Interfaces:**
- Produces `scanVaccinationCard(file, { signal, onProgress }): Promise<CardOcrResult>` and pure `parseCardText(text): CardCandidate[]`.
- Card images are held in object URLs/client memory and revoked on replacement/unmount; only candidate text enters the form.

- [ ] Write parser fixtures covering common card columns, uncertain/missing dates, duplicate rows, and unrecognized text; write component tests for image type/8 MiB limit, cancellation, retry, local-only behavior, and manual fallback.
- [ ] Run focused tests and confirm missing modules fail.
- [ ] Install the pinned compatible `tesseract.js` package; implement lazy browser worker loading, termination, cancellation, preprocessing via canvas, progress status, and field candidates with confidence.
- [ ] Add camera capture (`accept="image/*" capture="environment"`), upload, preview, scan, edit-review, and explicit paper-card confirmation; never upload the image.
- [ ] Run focused tests, production dependency audit, typecheck, lint, and build.

### Task 4: Staff patient search and card review

**Files:**
- Create: `src/app/clinic/[clinicId]/patients/page.tsx`
- Create: `src/app/clinic/[clinicId]/patients/search-form.tsx`
- Create: `src/app/clinic/[clinicId]/card-reviews/page.tsx`
- Create: `src/app/clinic/[clinicId]/card-reviews/review-form.tsx`
- Create: `src/app/api/v1/clinics/[clinicId]/patients/route.ts`
- Create: `src/app/api/v1/clinics/[clinicId]/card-submissions/[submissionId]/route.ts`
- Modify: `src/app/clinic/[clinicId]/staff-nav.tsx`
- Create: `tests/unit/staff-patient-card-review.test.ts`

**Interfaces:**
- Consumes existing `staff_search_children`, `staff_get_child`, and Task 1 review RPCs.
- Produces clinic-scoped search UI and review actions `changes_requested`, `approved`, and `rejected` with required reason for non-approval.

- [ ] Write tests for name/record/contact search, fixed minimum query length, indistinguishable empty results, role-capability navigation, review version conflicts, and accessible decision forms.
- [ ] Run focused tests and confirm missing routes/pages fail.
- [ ] Implement bounded same-origin routes, patient search page, pending-review list, row-by-row comparison, decision confirmation, and direct links to the existing child record.
- [ ] Ensure BHW/assistant see intake data but cannot approve or record clinical doses; inventory/technical administration receive no clinical patient navigation.
- [ ] Run focused unit/API tests, typecheck, and lint.

### Task 5: Role-scoped child notes

**Files:**
- Create: `src/app/clinic/[clinicId]/children/[childId]/notes.tsx`
- Create: `src/app/api/v1/clinics/[clinicId]/children/[childId]/notes/route.ts`
- Modify: `src/app/clinic/[clinicId]/children/[childId]/page.tsx`
- Modify: `src/app/children/[childId]/page.tsx`
- Create: `tests/unit/child-notes.test.ts`

**Interfaces:**
- Consumes Task 1 `add_child_note`/`list_child_notes`.
- Notes use categories `post_vaccination`, `follow_up`, `intake`, and `operational`, with optional existing visit/event link.

- [ ] Write tests proving nurse/lead can add clinical observations, BHW can add follow-up notes, assistant is limited to operational/intake notes, family sees family-visible notes only, and author/role/time are rendered.
- [ ] Run focused tests and confirm missing components/routes fail.
- [ ] Implement bounded note validation, role-aware category choices, server route, staff form/history, and family read-only section using existing Notice/Section/Mutation patterns.
- [ ] Use copy that labels entries as staff observations and does not imply diagnosis or universal medical advice.
- [ ] Run focused unit/API/database tests, typecheck, and lint.

### Task 6: Administrator-created staff accounts

**Files:**
- Create: `src/app/api/v1/clinics/[clinicId]/staff-accounts/route.ts`
- Create: `src/app/clinic/[clinicId]/admin/create-staff-account.tsx`
- Modify: `src/app/clinic/[clinicId]/admin/page.tsx`
- Create: `src/lib/auth/admin-create-staff.ts`
- Modify: `src/lib/staff-roles.ts`
- Create: `tests/unit/admin-create-staff.test.ts`
- Create: `tests/db/admin-created-membership.test.ts`

**Interfaces:**
- POST input `{ fullName, email, temporaryPassword, role, barangayId? }` uses the existing role vocabulary; nurse and midwife map to `clinical_staff` with a display title, not new authorization roles.
- Server-only Auth administration creates an immediately confirmed user, then calls the existing membership request command; the response returns email, supplied one-time password once, membership status, and MFA-required next step.

- [ ] Write tests for every role label, password policy, service credential isolation, duplicate identity/live membership, self-approval prevention, clinical pending approval, non-clinical approval path, rollback/compensation if membership creation fails, and no later password/MFA-secret reads.
- [ ] Run focused tests and confirm missing modules/routes fail.
- [ ] Implement a server-only Auth admin helper using the existing local service credential boundary, strict origin/capability checks, confirmed account creation, profile bootstrap verification, membership request, safe compensation for a newly created unused identity on transaction failure, and audit-safe errors.
- [ ] Build the admin form and one-time credential result with copy/print controls, role descriptions, approval status, MFA next step, and no credential persistence in page state after navigation.
- [ ] Extend the admin console staff list with search, status, role, suspend/revoke links using existing membership actions.
- [ ] Run focused unit/database/API tests, typecheck, lint, and verify signup still sends no confirmation mail.

### Task 7: End-to-end workflows and local readiness

**Files:**
- Create: `tests/e2e/16-card-intake-staff-review.spec.ts`
- Create: `tests/e2e/17-admin-staff-accounts.spec.ts`
- Modify: `tests/e2e/support.ts`
- Modify: `docs/operations/classroom-walkthrough.md`
- Modify: `README.md`

**Interfaces:**
- Exercises all public/family/staff/admin surfaces through browser-visible workflows and real local Supabase roles.

- [ ] Add a family E2E: immediate signup, child selection, manual card submission, mocked local OCR candidate review, pending status, staff request-changes, family correction, clinical approval, and family-visible result.
- [ ] Add staff role E2E: admin creates BHW/nurse/midwife/assistant accounts; independent approval where required; MFA gate; each role sees only its search/note/clinical actions; revoked access fails on next request.
- [ ] Add browser assertions for keyboard use, 320/768/1440 overflow, error association, reduced motion, local-only image handling, and absence of card-image network requests.
- [ ] Update the local walkthrough and README with account creation, OCR limitations, paper-card review, staff role matrix, and exact start/test commands.
- [ ] Run focused E2E files on the isolated stack, then `npm run check`, `npm run test:db`, `npm run build`, `npm run matrix:check`, `npm run db:install-sql -- --check`, and the complete E2E suite.

### Task 8: Final security and change review

**Files:**
- Modify: `docs/audit/2026-10-14-system-stabilization.md`

**Interfaces:**
- Consumes final test output and produces an evidence-based readiness statement.

- [ ] Review every new RPC/route for tenant isolation, MFA, capability, size limits, idempotency, audit events, empty search-path, secret handling, and non-enumerating errors.
- [ ] Review every new UI for family/staff separation, role labels, pending-versus-approved wording, accessible errors, responsive layout, camera cleanup, and manual fallback.
- [ ] Record exact test counts, known OCR/card-layout limits, real-camera and clinical-acceptance requirements, and any unresolved dependency advisory without claiming zero defects.
- [ ] Run `git diff --check` and a final targeted regression pass; only mark the local scope ready when all required checks pass.
