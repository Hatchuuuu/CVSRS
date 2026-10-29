import { readdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./local-stack";

// API modules observed in passing phase reports; unknown specs retain the complete warmup.
// shortcut: these lists cover current journeys; refresh them when an existing spec adds API routes.
const API_WARMUP_PHASES: { files: string[]; routes: string[] }[] = [
  {
    "files": [
      "01-accounts.spec.ts",
      "02-first-staff.spec.ts",
      "03-staff-application.spec.ts",
      "04-first-visit.spec.ts",
      "05-accessibility.spec.ts",
      "06-visits.spec.ts"
    ],
    "routes": [
      "/api/v1/appointments",
      "/api/v1/appointments/[appointmentId]/cancel",
      "/api/v1/appointments/[appointmentId]/reschedule",
      "/api/v1/certificates/[certificateId]/download",
      "/api/v1/children",
      "/api/v1/children/[childId]/history",
      "/api/v1/children/[childId]/schedule",
      "/api/v1/clinics/[clinicId]/audit",
      "/api/v1/clinics/[clinicId]/children",
      "/api/v1/clinics/[clinicId]/children/[childId]/appointments",
      "/api/v1/clinics/[clinicId]/children/[childId]/certificates",
      "/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity",
      "/api/v1/clinics/[clinicId]/clinical-master/antigens",
      "/api/v1/clinics/[clinicId]/clinical-master/products",
      "/api/v1/clinics/[clinicId]/clinical-master/status",
      "/api/v1/clinics/[clinicId]/encounters/[encounterId]/administrations",
      "/api/v1/clinics/[clinicId]/privacy-notice",
      "/api/v1/clinics/[clinicId]/privacy-notice/acknowledge",
      "/api/v1/clinics/[clinicId]/queue",
      "/api/v1/clinics/[clinicId]/queue/[entryId]/transition",
      "/api/v1/clinics/[clinicId]/queue/check-in",
      "/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify",
      "/api/v1/clinics/[clinicId]/schedules",
      "/api/v1/clinics/[clinicId]/schedules/[versionId]/activate",
      "/api/v1/clinics/[clinicId]/schedules/[versionId]/approve",
      "/api/v1/clinics/[clinicId]/schedules/[versionId]/submit",
      "/api/v1/clinics/[clinicId]/sessions",
      "/api/v1/clinics/[clinicId]/sessions/[sessionId]/cancel",
      "/api/v1/clinics/[clinicId]/sessions/[sessionId]/capacity",
      "/api/v1/clinics/[clinicId]/sessions/[sessionId]/roster",
      "/api/v1/clinics/[clinicId]/staff",
      "/api/v1/clinics/[clinicId]/staff-applications/[applicationId]/accept",
      "/api/v1/clinics/[clinicId]/staff/[membershipId]/approve",
      "/api/v1/clinics/[clinicId]/stock",
      "/api/v1/clinics/[clinicId]/stock/locations",
      "/api/v1/clinics/[clinicId]/stock/lots",
      "/api/v1/clinics/[clinicId]/stock/receipts",
      "/api/v1/me/messages",
      "/api/v1/verify/[token]",
      "/auth/callback",
      "/auth/sign-in",
      "/auth/sign-out",
      "/auth/sign-up"
    ]
  },
  {
    "files": [
      "07-records.spec.ts",
      "08-stock.spec.ts",
      "09-administration.spec.ts",
      "10-responsive.spec.ts",
      "11-password-change.spec.ts",
      "12-full-flow.spec.ts"
    ],
    "routes": [
      "/api/v1/appointments",
      "/api/v1/certificates/[certificateId]/download",
      "/api/v1/children",
      "/api/v1/children/[childId]/edit-requests",
      "/api/v1/children/[childId]/history",
      "/api/v1/children/[childId]/outside-doses",
      "/api/v1/clinics/[clinicId]/administrations/[eventId]/corrections",
      "/api/v1/clinics/[clinicId]/appointments",
      "/api/v1/clinics/[clinicId]/certificates/[certificateId]/revoke",
      "/api/v1/clinics/[clinicId]/children",
      "/api/v1/clinics/[clinicId]/children/[childId]",
      "/api/v1/clinics/[clinicId]/children/[childId]/certificates",
      "/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity",
      "/api/v1/clinics/[clinicId]/children/[childId]/followup-attempts",
      "/api/v1/clinics/[clinicId]/content",
      "/api/v1/clinics/[clinicId]/content/[versionId]/review",
      "/api/v1/clinics/[clinicId]/content/[versionId]/submit",
      "/api/v1/clinics/[clinicId]/corrections/[caseId]/approve",
      "/api/v1/clinics/[clinicId]/encounters/[encounterId]/administrations",
      "/api/v1/clinics/[clinicId]/evidence/[eventId]/verify",
      "/api/v1/clinics/[clinicId]/followup/refresh",
      "/api/v1/clinics/[clinicId]/privacy-notice",
      "/api/v1/clinics/[clinicId]/privacy-notice/acknowledge",
      "/api/v1/clinics/[clinicId]/profile",
      "/api/v1/clinics/[clinicId]/queue/[entryId]/transition",
      "/api/v1/clinics/[clinicId]/queue/check-in",
      "/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify",
      "/api/v1/clinics/[clinicId]/reports/[name]/export",
      "/api/v1/clinics/[clinicId]/review-cases",
      "/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve",
      "/api/v1/clinics/[clinicId]/review-cases/[caseId]/resolve-link",
      "/api/v1/clinics/[clinicId]/sessions",
      "/api/v1/clinics/[clinicId]/staff",
      "/api/v1/clinics/[clinicId]/staff/[membershipId]/approve",
      "/api/v1/clinics/[clinicId]/staff/[membershipId]/revoke",
      "/api/v1/clinics/[clinicId]/stock",
      "/api/v1/clinics/[clinicId]/stock/adjustments",
      "/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/approve",
      "/api/v1/clinics/[clinicId]/stock/adjustments/[caseId]/reject",
      "/api/v1/clinics/[clinicId]/stock/locations",
      "/api/v1/clinics/[clinicId]/stock/lots/[lotId]/disposition",
      "/api/v1/clinics/[clinicId]/stock/lots/[lotId]/ledger",
      "/api/v1/clinics/[clinicId]/stock/receipts",
      "/api/v1/clinics/[clinicId]/stock/reconcile",
      "/api/v1/clinics/[clinicId]/stock/temperature",
      "/api/v1/clinics/[clinicId]/stock/temperature/[readingId]/review",
      "/api/v1/clinics/[clinicId]/stock/temperature/limits",
      "/api/v1/clinics/[clinicId]/stock/wastage",
      "/api/v1/guardian-links",
      "/api/v1/me/messages",
      "/api/v1/verify/[token]",
      "/auth/callback",
      "/auth/sign-in",
      "/auth/sign-out",
      "/auth/sign-up"
    ]
  },
  {
    "files": [
      "13-interaction-accessibility.spec.ts",
      "14-motion-preferences.spec.ts",
      "15-auth-hydration.spec.ts",
      "16-card-intake-admin.spec.ts",
      "17-staff-location.spec.ts",
      "19-vaccination-care.spec.ts"
    ],
    "routes": [
      "/api/v1/children",
      "/api/v1/children/[childId]/card-submissions",
      "/api/v1/clinics/[clinicId]/card-submissions/[submissionId]",
      "/api/v1/clinics/[clinicId]/children",
      "/api/v1/clinics/[clinicId]/children/[childId]",
      "/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity",
      "/api/v1/clinics/[clinicId]/children/[childId]/notes",
      "/api/v1/clinics/[clinicId]/children/[childId]/record-status",
      "/api/v1/clinics/[clinicId]/encounters/[encounterId]/administrations",
      "/api/v1/clinics/[clinicId]/privacy-notice",
      "/api/v1/clinics/[clinicId]/queue/[entryId]/transition",
      "/api/v1/clinics/[clinicId]/queue/check-in",
      "/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify",
      "/api/v1/clinics/[clinicId]/sessions",
      "/api/v1/clinics/[clinicId]/staff-accounts",
      "/api/v1/clinics/[clinicId]/staff/[membershipId]/location",
      "/auth/sign-in"
    ]
  },
  {
    "files": [
      "20-sign-in-mascot.spec.ts",
      "22-child-registration-address.spec.ts",
      "23-dashboard-ui.spec.ts",
      "24-application-quality.spec.ts",
      "25-filter-recovery.spec.ts",
      "26-family-spacing.spec.ts"
    ],
    "routes": [
      "/api/v1/children",
      "/api/v1/clinics/[clinicId]/privacy-notice",
      "/api/v1/me/profile",
      "/auth/sign-in"
    ]
  },
  {
    "files": [
      "27-family-destinations.spec.ts",
      "28-staff-record-layout.spec.ts",
      "29-portal-separation.spec.ts",
      "30-developer-console.spec.ts",
      "31-parent-portal-flows.spec.ts",
      "32-clinic-workflows.spec.ts"
    ],
    "routes": [
      "/api/v1/appointments",
      "/api/v1/appointments/[appointmentId]/cancel",
      "/api/v1/appointments/[appointmentId]/reschedule",
      "/api/v1/children",
      "/api/v1/clinics/[clinicId]/children/[childId]",
      "/api/v1/clinics/[clinicId]/children/[childId]/confirm-identity",
      "/api/v1/clinics/[clinicId]/children/[childId]/notes",
      "/api/v1/clinics/[clinicId]/children/[childId]/qr",
      "/api/v1/clinics/[clinicId]/privacy-notice",
      "/api/v1/clinics/[clinicId]/privacy-notice/acknowledge",
      "/api/v1/clinics/[clinicId]/profile",
      "/api/v1/clinics/[clinicId]/qr/resolve",
      "/api/v1/clinics/[clinicId]/relationships/[relationshipId]/verify",
      "/api/v1/clinics/[clinicId]/sessions",
      "/api/v1/clinics/[clinicId]/staff",
      "/api/v1/clinics/[clinicId]/staff-accounts",
      "/api/v1/clinics/[clinicId]/staff/[membershipId]/approve",
      "/api/v1/me/contact-preferences",
      "/api/v1/me/profile",
      "/auth/sign-in",
      "/auth/sign-up"
    ]
  },
  {
    "files": [
      "33-portal-zoom.spec.ts",
      "34-multi-portal-history.spec.ts",
      "35-report-timezone-boundary.spec.ts",
      "36-account-form-readiness.spec.ts"
    ],
    "routes": [
      "/api/v1/clinics/[clinicId]/paper-tallies",
      "/api/v1/clinics/[clinicId]/privacy-notice",
      "/api/v1/clinics/[clinicId]/reports/[name]",
      "/api/v1/clinics/[clinicId]/reports/[name]/export",
      "/api/v1/clinics/[clinicId]/staff",
      "/api/v1/me/profile",
      "/auth/sign-in",
      "/auth/sign-up"
    ]
  }
];

/** Compile modules before a bounded phase so first-use rebuilds do not overlap mutations/navigation. No successful writes. */
export async function warmE2eApp(baseUrl: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch, specFiles?: readonly string[]): Promise<void> {
  for (const path of ["/", "/sign-up", "/sign-in", "/children", "/evactrackstafflogin", "/account/security", "/auth/sign-up", "/auth/sign-in", "/e2e-unavailable-page"]) {
    const post = path.startsWith("/auth/");
    const response = await fetcher(`${baseUrl}${path}`, {
      credentials: "omit",
      signal: AbortSignal.timeout(120_000),
      ...(post ? { method: "POST", headers: { origin: baseUrl, "content-type": "application/json" }, body: "{}" } : {}),
    });
    if (response.status !== (post ? 400 : path === "/e2e-unavailable-page" ? 404 : 200)) throw new Error(`E2E route warmup failed: ${path} (${response.status})`);
    await response.arrayBuffer();
  }
  const modules = readdirSync(join(ROOT, "src/app"), { recursive: true, encoding: "utf8" }).map(path => path.replaceAll("\\", "/"));
  // Automatic OPTIONS compiles each route without running an application command.
  const routes = modules.filter(path => path.endsWith("/route.ts"))
    .map(path => `/${path.slice(0, -"/route.ts".length).replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000")}`).sort();
  const specs = specFiles?.map(file => file.replaceAll("\\", "/").replace(/^tests\/e2e\//, ""));
  const known = specs?.length && specs.every(file => API_WARMUP_PHASES.some(phase => phase.files.includes(file)));
  const selected = known ? new Set(API_WARMUP_PHASES.filter(phase => specs!.some(file => phase.files.includes(file))).flatMap(phase => phase.routes)
    .map(path => path.replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000"))) : null;
  for (const path of routes.filter(path => !selected || selected.has(path))) {
    const response = await fetcher(`${baseUrl}${path}`, { method: "OPTIONS", credentials: "omit", signal: AbortSignal.timeout(120_000) });
    if (response.status !== 204) throw new Error(`E2E API warmup failed: ${path} (${response.status})`);
    await response.arrayBuffer();
  }
  const pages = modules.filter(path => path.endsWith("/page.tsx") || path === "page.tsx")
    .map(path => `/${path.replace(/(?:\/)?page\.tsx$/, "").replace(/\[[^\]]+\]/g, "00000000-0000-4000-8000-000000000000")}`).sort();
  for (const path of pages) {
    const response = await fetcher(`${baseUrl}${path}`, { method: "GET", credentials: "omit", redirect: "manual", signal: AbortSignal.timeout(120_000) });
    if (![200, 303, 307, 308, 401, 403, 404].includes(response.status)) throw new Error(`E2E page warmup failed: ${path} (${response.status})`);
    await response.arrayBuffer();
  }
}
