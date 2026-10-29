# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Guardians of young children** (parents, grandparents, caregivers) in Philippine barangays, often on a phone, sometimes with limited data or literacy confidence. Job: see their child's vaccination history and upcoming due dates, book an available clinic session, and keep the paper Immunization Card and the digital record in step.
- **Community clinic staff** (clinical lead, nurse, assistant, inventory clerk, barangay health worker, technical administrator). Job: register and verify families, run sessions and the arrival queue, record vaccinations, manage stock and cold chain, issue certificates.
- **Third parties checking a certificate** (schools, other clinics) via the QR code's public authenticity page.

## Product Purpose

eVacTrack (codebase name CVSRS, Children's Vaccination Scheduling and Records System) connects a family to the community clinic that keeps their child's immunization record. Success: a guardian can find their child's clinic-reviewed record and next due vaccine without a trip to the health center, and staff spend less time reconciling paper cards.

## Positioning

Records are entered and reviewed by the child's own clinic, and guardian access is verified by that clinic before clinical history is shown. Schedules come from the clinic's own approved schedule, not a generic calculator.

## Operating Context

- Families sign up online or register in person; the clinic verifies the guardian relationship.
- Families bring the paper Immunization Card to visits; staff check differences against the digital record.
- Public, unauthenticated surfaces: landing page, sign-in, sign-up, password recovery, live waiting-room queue display per clinic (`/display/[clinicId]`), certificate authenticity check (`/verify/[token]`, reached from a QR code), and the legal documents (`/terms`, `/privacy`, `/accessibility`).
- Parents Portal: My Children, Vaccination records, Appointments, Care information (clinic-published, second-person reviewed), Messages and Settings / Account. Registration and clinic-record linking open as dedicated tasks from My Children.
- Clinics Portal: capability-based daily work, records/review and management groups under `/clinic/[clinicId]`. Clinical leads retain independent clinical approvals; BHWs retain their permitted registration and follow-up scope.
- Developer Console: `/developer` and assigned-clinic technical workspaces for active technical administrators, with staff provisioning/access, clinic settings, operations evidence and a sanitized technical audit. This is not a global database-owner role; clinical authority and independent approvals remain separate.

## Capabilities and Constraints

Confirmed: registration and guardian verification, online booking when a clinic opens sessions, arrival queue, vaccination recording with corrections, certificates with QR authenticity check, in-app messages, clinic-published care information, record transfer, schedule engine driven by the clinic's approved schedule, staff two-step sign-in.

Constraints: CSP allows only self-hosted fonts and images. Light theme is forced app-wide. The system-wide Terms of Use, Privacy Policy (with its cookie table) and Accessibility statement live at `/terms`, `/privacy` and `/accessibility` (added 2026-10-08); each clinic's own privacy notice is still published inside the app and takes precedence for that clinic's records. Sign-up requires agreeing to the current `LEGAL_VERSION` (`src/lib/legal.ts`), checked on the server and stored as `terms_version` in Auth user metadata. The legal text names no contact address or Data Protection Officer: requests go to the health center, the controller.

## Brand Commitments

- Name: eVacTrack. Royal-blue civic look inspired by (never copying) the eGovPH portal; no eGovPH branding, no government-affiliation claim.
- Attribution: a NORSU BSInfoTech project, credited in the footer and in the hero badge ("A NORSU BSInfoTech student project"), which the user later placed there.
- Landing page typography: Atkinson Hyperlegible Next; signed-in pages keep Plus Jakarta Sans (user decision, 2026-10-02).

## Evidence on Hand

- Photography: `public/images/family-portal.webp` (mother, child and nurse reading a record, white seamless), `public/images/community-care.webp` (same scene in a clinic waiting area).
- Clinic directory from `list_public_clinics` (name, address, contact, hours); may be empty or demo data.
- Absent, must not be fabricated: usage statistics, ratings, testimonials, certifications, compliance standards, encryption claims, government endorsement, real clinic names or phone numbers.

## Product Principles

1. The clinic is the source of truth; the portal shows what the clinic has reviewed.
2. Never promise more than the system does: no unsupported security, medical, legal or government claims.
3. Paper and walk-in paths stay first-class; the portal adds access, it does not gate care.
4. Plain language for a guardian on a phone in a barangay health center.

## Accessibility & Inclusion

Families vary in vision, literacy and device quality. Minimum 44px targets, 16px+ body text, visible focus, reduced-motion respected, status never by color alone.
