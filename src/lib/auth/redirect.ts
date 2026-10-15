/** Where each kind of account starts: families at their children, staff at the clinic workspace (which picks their clinic). */
export const FAMILY_HOME = "/children";
export const STAFF_HOME = "/clinic";

const destinations = new Set([FAMILY_HOME, STAFF_HOME, "/account/security", "/account/reset-password"]);

/** Top-level clinic workspace sections (src/app/clinic/[clinicId]/<segment>). */
const CLINIC_SECTIONS = new Set([
  "access", "admin", "audit", "children", "clinical", "content", "followup", "inventory", "outage-forms", "questions", "reports", "review", "settings", "today", "transfers",
]);
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** `/clinic/<uuid>`, `/clinic/<uuid>/<section>` or `/clinic/<uuid>/<section>/<uuid>`: lower-case, nothing else (no query, encoding, `//`, `\`). */
const CLINIC_PATH = new RegExp(`^/clinic/${UUID}(?:/([a-z-]{1,32})(?:/${UUID})?)?$`);

/** Query parameter that carries the return path to /account/security (e.g. after the clinic workspace asked for two-step sign-in). */
export const RETURN_PARAM = "next";

/** A same-origin clinic workspace path, or null. Used as the return target after two-step sign-in. */
export function clinicReturnPath(next: string | null | undefined): string | null {
  if (typeof next !== "string" || next.length > 120) return null;
  const match = CLINIC_PATH.exec(next);
  if (!match) return null;
  return match[1] === undefined || CLINIC_SECTIONS.has(match[1]) ? next : null;
}

export function authDestination(next: string | null): string {
  if (next && destinations.has(next)) return next;
  return clinicReturnPath(next) ?? FAMILY_HOME;
}

/** The start page after signing in or creating an account: the staff workspace when asked for, otherwise the family home. */
export function entryDestination(next: string | null | undefined): typeof FAMILY_HOME | typeof STAFF_HOME {
  return next === STAFF_HOME ? STAFF_HOME : FAMILY_HOME;
}

export function authCallbackResult(error: string | null, next: string | null): string {
  return error ? "/sign-in?auth=link-error" : authDestination(next);
}

/** /account/security with a validated return path; the plain page when the path is not an allowed clinic path. */
export function securityPageFor(returnPath: string | null | undefined): string {
  const safe = clinicReturnPath(returnPath);
  return safe ? `/account/security?${RETURN_PARAM}=${encodeURIComponent(safe)}` : "/account/security";
}
