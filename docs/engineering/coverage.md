# Route and workflow coverage

Generated 2026-10-04 from the source tree (supersedes the 2026-10-02 hand-kept inventory). Every page (`page.tsx`, 36) and API route (`route.ts`, 145) is listed with the database commands it calls and the tests that reference it:

- **unit**: a unit test imports the handler/page or names its URL;
- **DB**: a database test calls the same command(s) under real role switches (authorization, validation, transitions);
- **browser**: an end-to-end journey (real Supabase Auth on the local stack) names the URL.

Status vocabulary: `PASS (browser, real Auth)`, `PASS (unit + DB)`, `PASS (DB command only)` (the business rule and its authorization are tested; this HTTP route itself was not called by a test), `NOT CHECKED`. The browser count is conservative: routes reached through form submissions inside the journeys (for example booking, check-in, vaccination recording, stock receipt, certificate issue) are exercised but only credited when a test names their URL.

## Totals

| Status | Routes |
|---|---|
| PASS (browser, real Auth) | 28 |
| PASS (unit + DB) | 27 |
| PASS (DB command only) | 125 |
| NOT CHECKED | 1 (`POST …/certificates/[certificateId]/retry`: retry of a failed certificate render; the render path itself is covered by certificate issue in journey 04) |

## Role boundaries proven in the browser (tests/e2e)

| Boundary | Evidence |
|---|---|
| Signed-out visitor → family/clinic pages redirect to sign-in; `/api/v1/me` 401 | 01, HTTP smoke |
| Staff without the second step (aal1) → clinic pages send to two-step setup; clinic API refuses | 02 |
| Person who accepted an application cannot approve it (no control; API 403/409) | 03 |
| Nurse → Staff access page shows "unavailable" with no staff data; audit API 403 | 03 |
| Family → clinic Today page and clinic APIs refused (403/404) | 04 |
| Second family → first family's child page, history, schedule and certificate 404 | 04 |
| Public certificate check works signed out; a bogus token is "not found" | 04 |

## Workflows (B.4 of the capstone audit)

| # | Workflow | DB | Browser on real Auth |
|---|---|---|---|
| W1 | Family sign-up + email confirmation | registry tests | PASS (01) |
| W2 | Sign-in / sign-out / wrong password | — | PASS (01) |
| W3 | Password recovery | — | PASS (01) |
| W4 | Staff MFA (TOTP) and aal2 gating | foundation tests | PASS (02, 03) |
| W5 | Staff application → accept → second approval | staff-applications tests | PASS (03) |
| W6 | Add child / guardian verification | registry tests | PASS (04) |
| W7 | Book a visit | visits tests | PASS (04, family booking); staff move/cancel DB only |
| W8 | Arrival queue (check in, call, start, finish) | visits tests | PASS (04) |
| W9 | Record vaccination from a received lot | administration tests | PASS (04); corrections DB only |
| W10 | Stock: location, lot, receipt; balance after use | inventory, transfers tests | PASS (04); transfers/wastage/cold chain DB only |
| W11 | Certificate issue → PDF → public verify | certificates tests | PASS (04) |
| W12 | Reports and CSV export | reports tests | page scanned (05); export DB only |
| W13 | Messages via outbox worker | sms-dispatch tests | worker runs in the journeys; message content not asserted |
| W14 | Record transfer between clinics | record-transfer tests | DB only |
| W15 | Schedule import → approve → activate | schedule tests | PASS (04, fictional test fixture) |
| W16 | Audit search, settings, care content | config tests | pages scanned (05); actions DB only |
| W17 | Follow-up worklist | followup tests | page scanned (05) |
| — | Accessibility (axe WCAG A/AA, no horizontal scroll) | — | PASS: 7 public + 21 signed-in screens at 375 and 1280 px (05 and the public scan) |

## Route inventory

| Kind | Route | Methods | DB commands | Unit tests | DB tests | Browser tests | Status |
|---|---|---|---|---|---|---|---|
| page | `/account/forgot-password` | GET | — | — | — | 01-accounts.spec.ts | PASS (browser, real Auth) |
| page | `/account` | GET | — | operational-gaps.test.ts | — | 01-accounts.spec.ts, 02-first-staff.spec.ts, 03-staff-application.spec.ts, 05-accessibility.spec.ts | PASS (browser, real Auth) |
| page | `/account/reset-password` | GET | — | inventory-controls.test.ts, auth-callback.test.ts, auth-entry.test.ts, auth-redirect.test.ts | — | — | PASS (unit + DB) |
| page | `/account/security` | GET | — | auth-redirect.test.ts, mfa-return-path.test.ts, staff-entry.test.ts, viewer-access.test.ts | — | 05-accessibility.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/appointments/[appointmentId]/cancel` | POST | cancel_appointment | — | certificates.test.ts, operational-gaps.test.ts, reports.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/appointments/[appointmentId]/reschedule` | POST | reschedule_appointment | — | visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/appointments` | GET,POST | my_appointments, book_appointment | — | sweep.test.ts, visits.test.ts, certificates.test.ts, operational-gaps.test.ts, record-transfer.test.ts, reports.test.ts, sms-dispatch.test.ts, sms.test.ts | — | PASS (DB command only) |
| API | `/api/v1/certificates/[certificateId]/download` | GET | get_certificate_pdf | download-export-limits.test.ts | certificates.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/children/[childId]/catchup-plan` | GET | guardian_get_catchup_plan | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/certificates` | GET | guardian_list_certificates | — | certificates.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/checkins` | GET,POST | my_checkins, create_checkin | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/edit-requests` | POST | request_child_edit | — | operational-gaps.test.ts, registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/history` | GET | guardian_child_history | — | evidence.test.ts, integrity-0034.test.ts, record-transfer.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/children/[childId]/outside-doses` | POST | report_outside_dose | — | evidence.test.ts, operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/qr` | POST,DELETE | issue_qr_pass, revoke_qr_pass | — | registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/queue-status` | GET | guardian_queue_status | — | visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/record-transfers/[transferId]/cancel` | POST | cancel_record_transfer_guardian | — | record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/record-transfers` | GET,POST | my_record_transfers, request_record_transfer_guardian | — | record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/children/[childId]/schedule` | GET | guardian_get_schedule | — | evidence.test.ts, followup.test.ts, operational-gaps.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/children` | GET,POST | my_children, create_child_provisional | security.test.ts | registry.test.ts, sweep.test.ts, administration.test.ts, catchup.test.ts, certificates.test.ts, config.test.ts, evidence.test.ts, followup.test.ts, integrity-0034.test.ts, operational-gaps.test.ts, record-transfer.test.ts, reports.test.ts, sms-dispatch.test.ts, sms.test.ts, visits.test.ts | — | PASS (unit + DB) |
| API | `/api/v1/clinics/[clinicId]/administrations/[eventId]/corrections` | POST | request_correction | — | administration.test.ts, certificates.test.ts, reports.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/administrations/[eventId]/exception-decision` | POST | resolve_administration_exception | — | administration.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/appointments` | GET | list_appointments | — | visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/audit` | GET | search_audit | — | config.test.ts, integrity-0034.test.ts | 03-staff-application.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/available-sessions` | GET | guardian_list_sessions | — | sweep.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/catchup-items/[itemId]/status` | POST | set_catchup_item_status | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/catchup-plans/[planId]/cancel` | POST | cancel_catchup_plan | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/catchup-plans/[planId]/review` | POST | review_catchup_plan | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/catchup-plans/[planId]/submit` | POST | submit_catchup_plan | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/catchup-reviews` | GET | list_catchup_reviews | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/certificates/[certificateId]/retry` | POST | — | — | — | — | NOT CHECKED |
| API | `/api/v1/clinics/[clinicId]/certificates/[certificateId]/revoke` | POST | revoke_certificate | — | certificates.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/checkin-policy` | GET,POST | get_checkin_policy, set_checkin_policy | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/checkins/[checkinId]/answer` | POST | answer_checkin | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/checkins` | GET | list_checkins | — | catchup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/administration-exceptions` | POST | record_administration_exception | — | administration.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/appointments` | GET | list_child_appointments | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/catchup-plans` | GET,POST | list_catchup_plans, save_catchup_draft | — | catchup.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/certificates` | GET,POST | list_child_certificates, issue_certificate | — | certificates.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity` | POST | confirm_child_identity | — | catchup.test.ts, certificates.test.ts, config.test.ts, evidence.test.ts, followup.test.ts, operational-gaps.test.ts, record-transfer.test.ts, registry.test.ts, reports.test.ts, sms-dispatch.test.ts, sms.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/followup-attempts` | POST | log_followup_attempt | — | followup.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/history` | GET | list_child_history | — | administration.test.ts, evidence.test.ts, integrity-0034.test.ts, record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/holds` | GET,POST | list_clinical_holds, place_clinical_hold | — | followup.test.ts, integrity-0034.test.ts, administration.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/outside-doses` | POST | record_outside_dose_staff | — | certificates.test.ts, evidence.test.ts, followup.test.ts, integrity-0034.test.ts, record-transfer.test.ts, reports.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/qr` | POST,DELETE | issue_qr_pass, revoke_qr_pass | — | registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/record-status` | POST | set_child_record_status | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/record-transfer` | POST | initiate_record_transfer_out | — | integrity-0034.test.ts, record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]` | GET,PATCH | staff_get_child, update_child_identity | — | record-transfer.test.ts, registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children/[childId]/schedule` | GET | evaluate_child | — | administration.test.ts, catchup.test.ts, evidence.test.ts, followup.test.ts, integrity-0034.test.ts, schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/children` | GET,POST | staff_search_children, register_child_staff | — | registry.test.ts, administration.test.ts, certificates.test.ts, evidence.test.ts, followup.test.ts, integrity-0034.test.ts, operational-gaps.test.ts, reports.test.ts, schedule.test.ts, visits.test.ts | 02-first-staff.spec.ts, 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/clinical-master/antigens` | POST | create_antigen | — | evidence.test.ts, schedule.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/clinical-master/products` | POST | create_vaccine_product | — | administration.test.ts, evidence.test.ts, inventory.test.ts, schedule.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/clinical-master` | GET | list_clinical_master | — | schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/clinical-master/status` | POST | set_master_status | — | administration.test.ts, inventory.test.ts, schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/content/[versionId]/retire` | POST | retire_content | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/content/[versionId]/review` | POST | review_content | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/content/[versionId]/submit` | POST | submit_content | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/content` | GET,POST | list_content, save_content_draft | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/corrections/[caseId]/approve` | POST | approve_correction | — | administration.test.ts, certificates.test.ts, reports.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/corrections/[caseId]/reject` | POST | reject_correction | — | administration.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/encounters/[encounterId]/administrations` | POST | record_administration | — | administration.test.ts, certificates.test.ts, integrity-0034.test.ts, reports.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/evidence/[eventId]/verify` | POST | verify_outside_dose | — | evidence.test.ts, operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/followup/refresh` | POST | refresh_followup | — | followup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/followup` | GET | list_followup_worklist | — | followup.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/guardians/[guardianId]/contact-invalid` | POST | mark_guardian_contact_invalid | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/guardians/[guardianId]/verify-contact` | POST | verify_guardian_contact | — | followup.test.ts, sms-dispatch.test.ts, sms.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/holds/[holdId]/release` | POST | release_clinical_hold | — | followup.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/merges` | POST | merge_children | — | certificates.test.ts, evidence.test.ts, integrity-0034.test.ts, registry.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/ops` | GET,POST | get_ops_status, record_ops_check | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/paper-tallies` | POST | record_paper_tally | — | reports.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/privacy-notice/acknowledge` | POST | acknowledge_clinic_privacy_notice | — | followup.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/privacy-notice` | GET,POST | get_privacy_notice, set_privacy_notice | — | followup.test.ts, integrity-0034.test.ts, sweep.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/profile` | GET,POST | get_clinic_profile, update_clinic_profile | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/qr/resolve` | POST | resolve_qr | — | registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/queue/[entryId]/priority` | POST | set_queue_priority | — | visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/queue/[entryId]/transition` | POST | queue_transition | — | administration.test.ts, certificates.test.ts, operational-gaps.test.ts, record-transfer.test.ts, reports.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/queue/call-next` | POST | call_next | rate-limit-isolation.test.ts | visits.test.ts | — | PASS (unit + DB) |
| API | `/api/v1/clinics/[clinicId]/queue/check-in` | POST | check_in | — | administration.test.ts, certificates.test.ts, operational-gaps.test.ts, record-transfer.test.ts, reports.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/queue/display` | GET | public_queue_display | rate-limit-isolation.test.ts | foundation.test.ts, sweep.test.ts, visits.test.ts | — | PASS (unit + DB) |
| API | `/api/v1/clinics/[clinicId]/queue` | GET | list_queue | — | visits.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/record-transfers/[transferId]/accept` | POST | accept_record_transfer | — | record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/record-transfers/[transferId]/decline` | POST | decline_record_transfer | — | record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/record-transfers/[transferId]/release` | POST | approve_record_transfer_release | — | record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/record-transfers` | GET | list_record_transfers | — | record-transfer.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/relationships/[relationshipId]/status` | POST | set_relationship_status | — | operational-gaps.test.ts, registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify` | POST | verify_relationship | — | catchup.test.ts, certificates.test.ts, config.test.ts, evidence.test.ts, followup.test.ts, operational-gaps.test.ts, record-transfer.test.ts, registry.test.ts, reports.test.ts, sms-dispatch.test.ts, sms.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/reports/[name]/export` | GET | — | download-export-limits.test.ts, staff-ui-actions.test.ts | — | — | PASS (unit + DB) |
| API | `/api/v1/clinics/[clinicId]/reports/[name]` | GET | — | download-export-limits.test.ts, shared-rate-limit.test.ts | — | — | PASS (unit + DB) |
| API | `/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve-link` | POST | resolve_link_case | — | operational-gaps.test.ts, registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve` | POST | resolve_review_case | — | operational-gaps.test.ts, registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/review-cases` | GET | list_review_cases | — | registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/activate` | POST | activate_schedule | — | schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/approve` | POST | approve_schedule | — | operational-gaps.test.ts, schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/discard` | POST | discard_schedule_draft | — | operational-gaps.test.ts, schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/impact` | GET | preview_schedule_impact | — | evidence.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/retire` | POST | retire_schedule | — | evidence.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/return` | POST | return_schedule_to_draft | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]` | GET | get_schedule_version | — | schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules/[versionId]/submit` | POST | submit_schedule_for_review | — | operational-gaps.test.ts, schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/schedules` | POST | import_schedule_draft | — | operational-gaps.test.ts, schedule.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/service-days/close` | POST | close_service_day | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/sessions/[sessionId]/cancel` | POST | cancel_session | — | visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/sessions/[sessionId]/capacity` | POST | update_session_capacity | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/sessions/[sessionId]/roster` | GET | list_session_roster | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/sessions` | GET,POST | list_sessions, create_session | — | operational-gaps.test.ts, administration.test.ts, certificates.test.ts, record-transfer.test.ts, reports.test.ts, sms-dispatch.test.ts, sms.test.ts, visits.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/accept` | POST | accept_staff_application | — | staff-applications.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/reject` | POST | reject_staff_application | — | staff-applications.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/staff-applications` | GET | list_staff_applications | — | staff-applications.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/staff/[membershipId]/approve` | POST | approve_staff_membership | — | foundation.test.ts, staff-applications.test.ts | 03-staff-application.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/staff/[membershipId]/revoke` | POST | revoke_staff_membership | — | foundation.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/staff` | GET,POST | list_staff_memberships, find_profile_for_grant, request_staff_membership | — | foundation.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/approve` | POST | approve_stock_adjustment | — | integrity-0034.test.ts, inventory.test.ts, operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/reject` | POST | reject_stock_adjustment | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/adjustments` | POST | propose_stock_adjustment | — | inventory.test.ts, operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/locations/[locationId]/close` | POST | close_stock_location | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/locations` | POST | create_stock_location | — | administration.test.ts, certificates.test.ts, integrity-0034.test.ts, inventory.test.ts, operational-gaps.test.ts, pending-inventory.test.ts, reports.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/lots/[lotId]/disposition` | POST | set_lot_disposition | — | administration.test.ts, inventory.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/lots/[lotId]/ledger` | GET | list_lot_ledger | — | inventory.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/lots/[lotId]/trace` | GET | trace_lot_use | — | administration.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/lots` | POST | register_lot | — | administration.test.ts, certificates.test.ts, integrity-0034.test.ts, inventory.test.ts, operational-gaps.test.ts, pending-inventory.test.ts, reports.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/receipts` | POST | receive_stock | — | administration.test.ts, certificates.test.ts, integrity-0034.test.ts, inventory.test.ts, operational-gaps.test.ts, reports.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/reconcile` | POST | reconcile_stock | — | inventory.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock` | GET | list_stock | — | inventory.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/clinics/[clinicId]/stock/temperature/[readingId]/review` | POST | review_temperature_excursion | — | pending-inventory.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/temperature/limits` | POST | set_cold_chain_limits | — | transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/temperature` | GET,POST | list_temperature, record_temperature | — | pending-inventory.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/cancel` | POST | cancel_stock_transfer | — | transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/receive` | POST | receive_stock_transfer | — | integrity-0034.test.ts, transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/transfers/[transferId]/resolve` | POST | resolve_transfer_shortfall | — | transfers.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/transfers` | GET,POST | list_stock_transfers, send_stock_transfer | — | pending-inventory.test.ts, transfers.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics/[clinicId]/stock/wastage` | POST | record_wastage | — | inventory.test.ts, reports.test.ts | — | PASS (DB command only) |
| API | `/api/v1/clinics` | GET | list_public_clinics | config-errors.test.ts | config.test.ts, foundation.test.ts, sweep.test.ts | — | PASS (unit + DB) |
| API | `/api/v1/guardian-links` | POST | request_guardian_link | — | followup.test.ts, operational-gaps.test.ts, registry.test.ts | — | PASS (DB command only) |
| API | `/api/v1/health/ready` | GET | list_public_clinics | health-ready.test.ts | config.test.ts, foundation.test.ts, sweep.test.ts | — | PASS (unit + DB) |
| API | `/api/v1/health` | GET | — | api-boundaries.test.ts | — | — | PASS (unit + DB) |
| API | `/api/v1/me/care-content` | GET | guardian_care_content | — | config.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me/contact-preferences` | GET,POST | get_contact_preferences, set_contact_preferences | — | sms.test.ts, sweep.test.ts, config.test.ts, followup.test.ts, sms-dispatch.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me/messages/read` | POST | mark_messages_read | — | certificates.test.ts, sweep.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me/messages` | GET | my_messages | — | catchup.test.ts, certificates.test.ts, record-transfer.test.ts, staff-applications.test.ts, sweep.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me/profile` | POST | update_my_profile | — | operational-gaps.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me` | GET | get_my_context | — | config.test.ts, foundation.test.ts, operational-gaps.test.ts, staff-applications.test.ts, sweep.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me/staff-applications/[applicationId]/withdraw` | POST | withdraw_staff_application | — | staff-applications.test.ts | — | PASS (DB command only) |
| API | `/api/v1/me/staff-applications` | GET,POST | my_staff_applications, submit_staff_application | — | staff-applications.test.ts, sweep.test.ts | — | PASS (DB command only) |
| API | `/api/v1/verify/[token]` | GET | verify_certificate | shared-rate-limit.test.ts | certificates.test.ts, foundation.test.ts, sweep.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| API | `/api/v1/webhooks/sms` | POST | — | rate-limit-isolation.test.ts, webhook-route.test.ts | — | — | PASS (unit + DB) |
| API | `/auth/callback` | GET | — | auth-callback.test.ts, auth-entry.test.ts, local-stack.test.ts | — | — | PASS (unit + DB) |
| API | `/auth/sign-in` | POST | — | auth-cookies.test.ts, auth-entry.test.ts, rate-limit-isolation.test.ts | — | — | PASS (unit + DB) |
| API | `/auth/sign-out` | POST | — | sign-out.test.ts | — | — | PASS (unit + DB) |
| API | `/auth/sign-up` | POST | list_public_clinics | auth-entry.test.ts, auth-password-policy.test.ts | config.test.ts, foundation.test.ts, sweep.test.ts | — | PASS (unit + DB) |
| page | `/auth/signed-out` | GET | — | sign-out.test.ts | — | — | PASS (unit + DB) |
| page | `/children/[childId]` | GET | my_children, guardian_get_schedule, guardian_child_history, guardian_list_sessions, my_appointments, guardian_queue_status, guardian_list_certificates, guardian_get_catchup_plan, my_checkins, my_record_transfers | clinic-time-display.test.ts, family-page-failures.test.ts, auth-redirect.test.ts, clinic-record-failures.test.ts, clinic-search.test.ts, family-controls.test.ts, operational-gaps.test.ts, shell-motion.test.ts, shell-visits.test.ts, staff-ui-actions.test.ts, staff-ui-confirm-focus.test.ts, staff-ui-dates.test.ts, staff-ui-record-links.test.ts, staff-ui-review-cases.test.ts, ui-page-failures.test.ts, viewer-page-loading.test.ts | registry.test.ts, sweep.test.ts, evidence.test.ts, followup.test.ts, operational-gaps.test.ts, integrity-0034.test.ts, record-transfer.test.ts, visits.test.ts, certificates.test.ts, catchup.test.ts | 01-accounts.spec.ts, 02-first-staff.spec.ts, 04-first-visit.spec.ts, 05-accessibility.spec.ts | PASS (browser, real Auth) |
| page | `/children` | GET | my_children, list_public_clinics, get_pending_privacy_notices | ui-page-failures.test.ts, viewer-page-loading.test.ts, auth-callback.test.ts, auth-entry.test.ts, auth-redirect.test.ts, local-stack.test.ts, security.test.ts, shell-layout.test.ts, staff-entry.test.ts | registry.test.ts, sweep.test.ts, config.test.ts, foundation.test.ts, followup.test.ts, integrity-0034.test.ts | 01-accounts.spec.ts, 02-first-staff.spec.ts, 04-first-visit.spec.ts, 05-accessibility.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/access` | GET | list_staff_memberships | staff-ui-record-links.test.ts | foundation.test.ts | 03-staff-application.spec.ts, 04-first-visit.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/admin` | GET | list_staff_applications, list_staff_memberships | admin-console.test.ts | staff-applications.test.ts, foundation.test.ts | 03-staff-application.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/audit` | GET | search_audit | — | config.test.ts, integrity-0034.test.ts | — | PASS (DB command only) |
| page | `/clinic/[clinicId]/children/[childId]` | GET | staff_get_child, get_open_encounter | clinic-record-failures.test.ts, viewer-page-loading.test.ts, auth-redirect.test.ts, clinic-search.test.ts, clinic-time-display.test.ts, operational-gaps.test.ts, staff-ui-actions.test.ts, staff-ui-confirm-focus.test.ts, staff-ui-dates.test.ts, staff-ui-record-links.test.ts, staff-ui-review-cases.test.ts | record-transfer.test.ts, registry.test.ts, administration.test.ts, operational-gaps.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/clinical` | GET | list_clinical_master, get_privacy_notice | viewer-page-loading.test.ts | schedule.test.ts, followup.test.ts, integrity-0034.test.ts, sweep.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/clinical/schedules/[versionId]` | GET | get_schedule_version, preview_schedule_impact | viewer-page-loading.test.ts, staff-ui-actions.test.ts, staff-ui-confirm-focus.test.ts | schedule.test.ts, evidence.test.ts | — | PASS (unit + DB) |
| page | `/clinic/[clinicId]/content` | GET | list_content | — | config.test.ts | — | PASS (DB command only) |
| page | `/clinic/[clinicId]/followup` | GET | list_followup_worklist | staff-ui-record-links.test.ts | followup.test.ts | — | PASS (unit + DB) |
| page | `/clinic/[clinicId]/inventory/cold-chain` | GET | list_temperature, list_stock | inventory-controls.test.ts | pending-inventory.test.ts, transfers.test.ts, inventory.test.ts | — | PASS (unit + DB) |
| page | `/clinic/[clinicId]/inventory` | GET | list_stock, list_active_products | inventory-controls.test.ts, staff-ui-review-cases.test.ts | inventory.test.ts, evidence.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/inventory/transfers` | GET | list_stock_transfers, list_stock | staff-ui-dates.test.ts, inventory-controls.test.ts, staff-ui-review-cases.test.ts | pending-inventory.test.ts, transfers.test.ts, inventory.test.ts | — | PASS (unit + DB) |
| page | `/clinic/[clinicId]/outage-forms` | GET | — | auth-redirect.test.ts | — | — | PASS (unit + DB) |
| page | `/clinic/[clinicId]` | GET | — | admin-console.test.ts, auth-redirect.test.ts, clinic-record-failures.test.ts, clinic-search.test.ts, clinic-time-display.test.ts, inventory-controls.test.ts, operational-gaps.test.ts, outage-layout.test.ts, shell-controls.test.ts, shell-motion.test.ts, staff-entry.test.ts, staff-ui-actions.test.ts, staff-ui-confirm-focus.test.ts, staff-ui-dates.test.ts, staff-ui-record-links.test.ts, staff-ui-review-cases.test.ts, staff-ui-today.test.ts, ui-page-failures.test.ts, viewer-page-loading.test.ts | — | 02-first-staff.spec.ts, 03-staff-application.spec.ts, 04-first-visit.spec.ts, 05-accessibility.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/questions` | GET | get_checkin_policy, list_checkins, list_catchup_reviews | — | catchup.test.ts | — | PASS (DB command only) |
| page | `/clinic/[clinicId]/reports` | GET | report_backlog, list_active_products | staff-ui-dates.test.ts | catchup.test.ts, integrity-0034.test.ts, reports.test.ts, transfers.test.ts, evidence.test.ts | — | PASS (unit + DB) |
| page | `/clinic/[clinicId]/review` | GET | list_review_cases | — | registry.test.ts | — | PASS (DB command only) |
| page | `/clinic/[clinicId]/settings` | GET | get_clinic_profile, get_ops_status | — | config.test.ts | — | PASS (DB command only) |
| page | `/clinic/[clinicId]/today` | GET | list_sessions, list_appointments, list_queue, service_day_backlog | staff-ui-record-links.test.ts, staff-ui-today.test.ts, ui-page-failures.test.ts, auth-redirect.test.ts, shell-controls.test.ts, staff-entry.test.ts | operational-gaps.test.ts, visits.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
| page | `/clinic/[clinicId]/transfers` | GET | list_record_transfers | inventory-controls.test.ts | record-transfer.test.ts | — | PASS (unit + DB) |
| page | `/clinic` | GET | my_staff_applications, list_public_clinics | staff-entry.test.ts, auth-entry.test.ts, auth-redirect.test.ts, security.test.ts, viewer-access.test.ts | staff-applications.test.ts, sweep.test.ts, config.test.ts, foundation.test.ts | — | PASS (unit + DB) |
| page | `/display/[clinicId]` | GET | public_queue_display | clinic-time-display.test.ts, rate-limit-isolation.test.ts | foundation.test.ts, sweep.test.ts, visits.test.ts | — | PASS (unit + DB) |
| page | `/evactrackstafflogin/create-account` | GET | list_public_clinics | staff-entry.test.ts, admin-console.test.ts | config.test.ts, foundation.test.ts, sweep.test.ts | 03-staff-application.spec.ts | PASS (browser, real Auth) |
| page | `/evactrackstafflogin` | GET | — | staff-entry.test.ts, auth-entry.test.ts | — | 03-staff-application.spec.ts | PASS (browser, real Auth) |
| page | `/help` | GET | guardian_care_content | — | config.test.ts | 05-accessibility.spec.ts | PASS (browser, real Auth) |
| page | `/messages` | GET | my_messages, get_contact_preferences, my_children | clinic-time-display.test.ts, ui-page-failures.test.ts, validation-messages.test.ts | catchup.test.ts, certificates.test.ts, record-transfer.test.ts, staff-applications.test.ts, sweep.test.ts, sms.test.ts, registry.test.ts | 05-accessibility.spec.ts | PASS (browser, real Auth) |
| page | `/` | GET | list_public_clinics | ui-page-failures.test.ts | config.test.ts, foundation.test.ts, sweep.test.ts | — | PASS (unit + DB) |
| page | `/sign-in` | GET | — | staff-entry.test.ts, auth-callback.test.ts, auth-cookies.test.ts, auth-entry.test.ts, auth-redirect.test.ts, rate-limit-isolation.test.ts, shared-rate-limit.test.ts | — | — | PASS (unit + DB) |
| page | `/sign-up` | GET | — | staff-entry.test.ts, auth-entry.test.ts, auth-password-policy.test.ts | — | — | PASS (unit + DB) |
| page | `/verify/[token]` | GET | verify_certificate | shared-rate-limit.test.ts | certificates.test.ts, foundation.test.ts, sweep.test.ts | 04-first-visit.spec.ts | PASS (browser, real Auth) |
