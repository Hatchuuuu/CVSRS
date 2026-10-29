"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from "react";
import { Button, EmptyState, Notice, ResultRegion, SelectField, StatusChip, TextField } from "@/components/ui";
import { useMutation, type ApiFailure, type MutationState } from "@/lib/client/api";
import { formatClinicTime, formatDate } from "@/lib/format";

export interface OpenSession {
  sessionId: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  hasRoom: boolean;
}
export interface MyAppointment {
  appointmentId: string;
  status: string;
  childId: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  sessionId: string;
  clinicTimezone: string;
}

/** Every booking state in plain words for families (no raw database values). */
const VISIT_STATUS: Record<string, { tone: "info" | "attention" | "success" | "neutral"; label: string }> = {
  confirmed: { tone: "info", label: "Booked" },
  checked_in: { tone: "attention", label: "Arrived" },
  fulfilled: { tone: "success", label: "Visit done" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  no_show: { tone: "neutral", label: "Missed" },
  rescheduled: { tone: "neutral", label: "Moved to another time" },
  other: { tone: "neutral", label: "Not taking place" },
};

/** "Thu, 8 Oct 2026": a calendar date, day first like `formatDate`, with its weekday. */
const fmtDay = (d: string) => `${new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}, ${formatDate(d)}`;
const sessionText = (s: OpenSession, tz: string | null) => `${fmtDay(s.serviceDate)}, ${formatClinicTime(s.startsAt, tz || "Asia/Manila")}`;

/**
 * The latest visit change for a child (booked, moved, cancelled, or a booking error). It lives outside the
 * appointment rows because a cancelled or moved row unmounts on `router.refresh()`; BookVisit stays mounted and
 * shows it, so the confirmation survives the refresh and a newer success replaces an older error.
 */
export interface VisitNotice {
  id: number;
  tone: "success" | "danger" | "attention";
  title: string;
  message?: string;
}
const notices = new Map<string, VisitNotice>();
const listeners = new Set<() => void>();
let nextNoticeId = 1;
const emit = () => listeners.forEach((listener) => listener());

export function announceVisitChange(childId: string, notice: Omit<VisitNotice, "id">) {
  notices.set(childId, { ...notice, id: nextNoticeId++ });
  emit();
}
export function getVisitNotice(childId: string): VisitNotice | null {
  return notices.get(childId) ?? null;
}
export function clearVisitNotice(childId: string) {
  if (notices.delete(childId)) emit();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Plain family wording for errors; the known double-booking conflict never shows raw database text. It is recognised by the stable
 * reason the server attaches (database hint cvsrs:duplicate_session_booking), never by the wording of the message.
 */
export function familyVisitError(error: ApiFailure): Omit<VisitNotice, "id"> {
  if (error.unknown) return { tone: "attention", title: "Not confirmed yet", message: error.message };
  if (error.code === "conflict" && error.reason === "duplicate_session_booking") {
    return {
      tone: "danger",
      title: "That time could not be booked",
      message: "Your child already has a visit booked at this time. Choose a different time, or change the visit you already booked.",
    };
  }
  return { tone: "danger", title: error.code === "conflict" ? "That could not be booked" : "Not saved", message: error.message };
}

function VisitNoticeView({ childId }: { childId: string }) {
  const notice = useSyncExternalStore(subscribe, () => getVisitNotice(childId), () => null);
  const ref = useRef<HTMLDivElement>(null);
  // Move focus to each new outcome so keyboard and screen-reader users keep their place after the refresh.
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  // A notice belongs to this visit to the page; leaving the page clears it.
  useEffect(() => () => clearVisitNotice(childId), [childId]);
  return (
    <ResultRegion>
      {notice ? (
        <div ref={ref} tabIndex={-1} className="rounded-card focus-visible:outline-offset-2">
          <Notice tone={notice.tone} role={notice.tone === "success" ? "status" : "alert"} title={notice.title}>
            {notice.message}
          </Notice>
        </div>
      ) : null}
    </ResultRegion>
  );
}

function Outcome<T>({ state }: { state: MutationState<T> }) {
  if (state.phase !== "error") return null;
  const e = familyVisitError(state.error);
  return (
    <ResultRegion>
      <Notice tone={e.tone} role="alert" title={e.title}>
        {e.message}
      </Notice>
    </ResultRegion>
  );
}

export function BookVisit({ childId, sessions, clinicTimezone }: { childId: string; sessions: OpenSession[]; clinicTimezone: string | null }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const { state, run, reset } = useMutation(`/api/v1/appointments`);
  const open = sessions.filter((s) => s.hasRoom);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const sessionId = String(f.get("sessionId") ?? "");
    if (!sessionId) return;
    const r = await run({ childId, sessionId, reason: String(f.get("reason") ?? "").trim() || undefined });
    if (!r) return;
    reset();
    if (r.ok) {
      const s = sessions.find((x) => x.sessionId === sessionId);
      form.reset();
      announceVisitChange(childId, {
        tone: "success",
        title: s ? `Visit booked for ${sessionText(s, clinicTimezone)}` : "Visit booked",
        message: "Arrive on the day and the clinic will give you a queue number.",
      });
      router.refresh();
    } else {
      announceVisitChange(childId, familyVisitError(r));
    }
  }
  return (
    <>
      <VisitNoticeView childId={childId} />
      {sessions.length === 0 ? (
        <EmptyState title="No visit times are open right now">Please check again later or call the clinic.</EmptyState>
      ) : (
        <form onSubmit={submit}>
          <fieldset className="mb-4" disabled={!hydrated}>
            <legend className="mb-1 font-semibold">Choose a time</legend>
            {open.length === 0 ? <p className="text-ink-soft">All listed times are full. Please check again later or ask the clinic about walking in.</p> : null}
            {open.map((s) => (
              <label key={s.sessionId} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="sessionId" value={s.sessionId} className="size-5" required />
                {fmtDay(s.serviceDate)}, {formatClinicTime(s.startsAt, clinicTimezone || "Asia/Manila")}–{formatClinicTime(s.endsAt, clinicTimezone || "Asia/Manila")}
              </label>
            ))}
          </fieldset>
          <TextField id="bv-reason" name="reason" label="Anything the clinic should know? (optional)" />
          <p className="mb-3 text-sm text-ink-soft">Booking reserves a place. It does not mean your child is ready for a vaccine: clinic staff check that on the day.</p>
          <Button type="submit" disabled={!hydrated || state.phase === "pending" || open.length === 0}>
            {state.phase === "pending" ? "Booking…" : "Book this time"}
          </Button>
        </form>
      )}
    </>
  );
}

export function AppointmentItem({ a, sessions, currentClinicTimezone }: { a: MyAppointment; sessions: OpenSession[]; currentClinicTimezone: string | null }) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [refreshing, startRefresh] = useTransition();
  const cancel = useMutation(`/api/v1/appointments/${a.appointmentId}/cancel`);
  const move = useMutation(`/api/v1/appointments/${a.appointmentId}/reschedule`);
  const [mode, setMode] = useState<"none" | "move" | "cancel">("none");
  const busy = !hydrated || refreshing || cancel.state.phase === "pending" || move.state.phase === "pending";
  const options = sessions.filter((s) => s.hasRoom && s.sessionId !== a.sessionId);
  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {fmtDay(a.serviceDate)}, {formatClinicTime(a.startsAt, a.clinicTimezone || currentClinicTimezone || "Asia/Manila")}–{formatClinicTime(a.endsAt, a.clinicTimezone || currentClinicTimezone || "Asia/Manila")}
        </span>
        <StatusChip tone={(VISIT_STATUS[a.status] ?? VISIT_STATUS.other!).tone}>{(VISIT_STATUS[a.status] ?? VISIT_STATUS.other!).label}</StatusChip>
      </div>
      {a.status === "confirmed" ? (
        <div className="mt-2">
          <div className="flex flex-wrap gap-3">
            <Button variant="quiet" disabled={busy} onClick={() => setMode(mode === "move" ? "none" : "move")} aria-expanded={mode === "move"}>
              Change time
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => setMode(mode === "cancel" ? "none" : "cancel")} aria-expanded={mode === "cancel"}>
              Cancel visit
            </Button>
          </div>
          {mode === "cancel" ? (
            <div className="mt-2 rounded-control border border-danger bg-danger-bg p-3">
              <p className="mb-3 text-sm font-semibold text-danger">Cancel this booked time for {fmtDay(a.serviceDate)}?</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    const r = await cancel.run({});
                    if (!r?.ok) return;
                    announceVisitChange(a.childId, { tone: "success", title: `Visit cancelled for ${fmtDay(a.serviceDate)}` });
                    startRefresh(() => router.refresh());
                  }}
                >
                  {cancel.state.phase === "pending" ? "Cancelling…" : "Yes, cancel visit"}
                </Button>
                <Button variant="secondary" disabled={busy} onClick={() => setMode("none")}>Keep visit</Button>
              </div>
            </div>
          ) : null}
          {mode === "move" ? (
            <form
              className="mt-2 rounded-control border border-line p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const newSessionId = String(new FormData(e.currentTarget).get("newSessionId"));
                const r = await move.run({ newSessionId });
                if (!r?.ok) return;
                const s = sessions.find((x) => x.sessionId === newSessionId);
                announceVisitChange(a.childId, { tone: "success", title: s ? `Visit moved to ${sessionText(s, currentClinicTimezone)}` : "Visit moved" });
                startRefresh(() => router.refresh());
              }}
            >
              <SelectField id={`mv-${a.appointmentId}`} name="newSessionId" label="New time" required>
                {options.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {sessionText(s, currentClinicTimezone)}
                  </option>
                ))}
              </SelectField>
              <p className="mb-2 text-sm text-ink-soft">If the new time is full, your current booking stays as it is.</p>
              <Button type="submit" disabled={busy || options.length === 0}>
                Move my visit
              </Button>
            </form>
          ) : null}
          <Outcome state={cancel.state} />
          <Outcome state={move.state} />
        </div>
      ) : null}
    </li>
  );
}
