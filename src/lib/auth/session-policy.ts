/**
 * Session lifetime settings shared by the server (cookie Max-Age, configuration checks) and the browser (staff idle sign-out).
 * No server-only imports: the browser bundle uses the idle setting.
 */

/** Default Max-Age of the Supabase session cookies: one 12-hour work shift. */
export const DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;
export const MIN_SESSION_COOKIE_MAX_AGE_SECONDS = 5 * 60;
export const MAX_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/** Default minutes without input before a signed-in staff member is signed out. 0 disables. */
export const DEFAULT_STAFF_IDLE_MINUTES = 15;
export const MIN_STAFF_IDLE_MINUTES = 2;
export const MAX_STAFF_IDLE_MINUTES = 12 * 60;

function wholeNumber(raw: string, name: string): number {
  if (!/^\d{1,9}$/.test(raw)) throw new RangeError(`${name} must be a whole number`);
  return Number(raw);
}

/** CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS: blank means the default; otherwise 300–2,592,000 seconds. */
export function parseSessionCookieMaxAge(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_SESSION_COOKIE_MAX_AGE_SECONDS;
  const seconds = wholeNumber(value, "CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS");
  if (seconds < MIN_SESSION_COOKIE_MAX_AGE_SECONDS || seconds > MAX_SESSION_COOKIE_MAX_AGE_SECONDS) {
    throw new RangeError(`CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS must be between ${MIN_SESSION_COOKIE_MAX_AGE_SECONDS} and ${MAX_SESSION_COOKIE_MAX_AGE_SECONDS}`);
  }
  return seconds;
}

/** NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES: blank means the default; 0 disables; otherwise 2–720 minutes. */
export function parseStaffIdleMinutes(raw: string | undefined): number {
  const value = raw?.trim();
  if (!value) return DEFAULT_STAFF_IDLE_MINUTES;
  const minutes = wholeNumber(value, "NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES");
  if (minutes !== 0 && (minutes < MIN_STAFF_IDLE_MINUTES || minutes > MAX_STAFF_IDLE_MINUTES)) {
    throw new RangeError(`NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES must be 0 (off) or between ${MIN_STAFF_IDLE_MINUTES} and ${MAX_STAFF_IDLE_MINUTES}`);
  }
  return minutes;
}
