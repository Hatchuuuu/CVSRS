/** Pure decisions for the Today page (no React, safe to call from server and client code). */

type QueueStatus = "waiting" | "called" | "in_service" | "completed" | "held" | "left" | "cancelled" | "deferred";
type Tone = "info" | "attention" | "success" | "neutral";

export const checkInMessage = (ticket: string, name: string) => `Ticket ${ticket} issued for ${name}.`;

/**
 * The "Call next patient" result stays visible only while it still describes the queue: a called ticket until it is
 * started, finished or removed (still `waiting` means the refresh has not arrived yet), and "Nobody is waiting" only
 * while nobody is.
 */
export function callNextNotice(result: { called: boolean; ticket?: string }, entries: { ticket: string; status: QueueStatus | string }[]): { tone: "success" | "info"; title: string } | null {
  if (result.called) {
    const e = entries.find((x) => x.ticket === result.ticket);
    return e && (e.status === "called" || e.status === "waiting") ? { tone: "success", title: `Now calling ${result.ticket}` } : null;
  }
  return entries.some((e) => e.status === "waiting") ? null : { tone: "info", title: "Nobody is waiting" };
}

/** Bookings that will not happen (cancelled, or moved to another session) are kept out of "Expected today". */
const NOT_EXPECTED = new Set(["cancelled", "rescheduled"]);
export function splitAppointments<T extends { status: string }>(list: T[]): { expected: T[]; cancelled: T[] } {
  return { expected: list.filter((a) => !NOT_EXPECTED.has(a.status)), cancelled: list.filter((a) => NOT_EXPECTED.has(a.status)) };
}

const APPOINTMENT_STATUS: Record<string, { tone: Tone; label: string }> = {
  confirmed: { tone: "info", label: "Booked" },
  checked_in: { tone: "attention", label: "Arrived" },
  fulfilled: { tone: "success", label: "Seen" },
  no_show: { tone: "neutral", label: "Did not come" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  rescheduled: { tone: "neutral", label: "Moved to another time" },
};

export function appointmentStatusLabel(status: string): { tone: Tone; label: string } {
  const known = APPOINTMENT_STATUS[status];
  if (known) return known;
  const words = status.replace(/_/g, " ").trim();
  return { tone: "neutral", label: words ? words.charAt(0).toUpperCase() + words.slice(1) : "Unknown" };
}

/** Visit outcomes for "Finish visit". The empty value forces an explicit choice (nothing is pre-selected). */
export const VISIT_OUTCOMES = [
  ["vaccinated", "Vaccinated"],
  ["deferred", "Deferred"],
  ["referred", "Referred"],
  ["no_service", "No service given"],
] as const;
export const finishTransition = (outcome: string) => (outcome === "deferred" || outcome === "referred" ? "deferred" : "completed");
