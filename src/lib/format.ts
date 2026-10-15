/** Dates are calendar dates (no timezone shifting): "2026-09-29" is always 29 Sep 2026. Month names avoid numeric ambiguity (BP35). */
export function formatDate(d: string | null | undefined, opts: { fallback?: string } = {}): string {
  if (!d) return opts.fallback ?? "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  if (!y || !m || !day) return opts.fallback ?? "—";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[m - 1]} ${y}`;
}

/** A timestamp is displayed in the clinic's IANA timezone, never in the browser/server default. */
export function formatClinicTime(iso: string, clinicTimezone: string): string {
  return new Date(iso).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit", timeZone: clinicTimezone });
}

/** "8 Oct 2026, 11:11 AM": the day-first date every other screen uses (en-PH alone would print "Oct 8, 2026"). */
export function formatClinicDateTime(iso: string, clinicTimezone: string): string {
  if (Number.isNaN(new Date(iso).getTime())) return "—";
  return `${formatClinicDate(iso, clinicTimezone)}, ${formatClinicTime(iso, clinicTimezone)}`;
}

/** The clinic calendar day of an instant, in the same "2 Oct 2026" form as `formatDate` (an event at 23:30Z is the next day in Manila). */
export function formatClinicDate(iso: string, clinicTimezone: string): string {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return "—";
  return formatDate(clinicToday(clinicTimezone, instant));
}

export function clinicToday(clinicTimezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: clinicTimezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** The start or inclusive end of a clinic calendar day as an instant. */
export function clinicDateBoundary(date: string, clinicTimezone: string, end = false): Date {
  const [year = 0, month = 0, day = 0] = date.split("-").map(Number);
  const target = Date.UTC(year, month - 1, day + (end ? 1 : 0));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: clinicTimezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let instant = target;
  for (let i = 0; i < 3; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
    const wall = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
    instant += target - wall;
  }
  return new Date(instant - (end ? 1 : 0));
}

const wallClock = (clinicTimezone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: clinicTimezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });

/** Milliseconds the clinic's wall clock is ahead of UTC at an instant (Intl only, so it follows the zone's DST rules). */
function clinicOffset(formatter: Intl.DateTimeFormat, instant: number): number {
  const parts = formatter.formatToParts(new Date(instant));
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  const wall = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"), value("second"));
  return wall - Math.floor(instant / 1000) * 1000;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

/**
 * A `datetime-local` value ("2026-10-01T07:00") read as wall time in the clinic's zone, as an ISO instant.
 * The device zone is never used. A wall time skipped by a DST change moves forward past the gap, and a repeated
 * one takes the earlier instant (Temporal's "compatible" rule). Returns null for anything that is not a real date and time.
 */
export function clinicLocalToInstant(localDateTime: string, clinicTimezone: string): string | null {
  const m = LOCAL_DATE_TIME.exec(localDateTime.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = [1, 2, 3, 4, 5, 6].map((i) => Number(m[i] ?? 0)) as [number, number, number, number, number, number];
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  const formatter = wallClock(clinicTimezone);
  const day1 = 86_400_000;
  const before = clinicOffset(formatter, wall - day1);
  const after = clinicOffset(formatter, wall + day1);
  // A wall time is valid for an offset when that offset is really in force at the resulting instant.
  const valid = [...new Set([before, after])].map((offset) => wall - offset).filter((instant) => clinicOffset(formatter, instant) === wall - instant);
  const instant = valid.length > 0 ? Math.min(...valid) : wall - before;
  return new Date(instant).toISOString();
}

/** An instant as the clinic's wall time in `datetime-local` form ("2026-10-01T07:00"), for a form default or `max`. */
export function instantToClinicLocal(iso: string | Date, clinicTimezone: string): string {
  const instant = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(instant.getTime())) return "";
  const parts = wallClock(clinicTimezone).formatToParts(instant);
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
