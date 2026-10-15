"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import { announceOutcome, OutcomeNoticeView } from "@/components/outcome-notice";
import { Button, EmptyState, Notice, ResultRegion, SelectField, StatusChip, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";
import { formatClinicTime, formatDate } from "@/lib/format";

/** A child's booking at this clinic, as list_child_appointments returns it. */
export interface ChildAppointment {
  appointmentId: string;
  status: string;
  channel: string;
  sessionId: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  sessionStatus: string;
  reason: string | null;
}
/** An upcoming clinic session, as list_sessions returns it. */
export interface BookableSession {
  sessionId: string;
  serviceDate: string;
  startsAt: string;
  endsAt: string;
  status: string;
  remainingOnline: number;
}

/** Sessions that can still take a booking: open and not yet over. */
export function bookableSessions(sessions: BookableSession[], now: number = Date.now()): BookableSession[] {
  return sessions.filter((s) => s.status === "open" && Date.parse(s.endsAt) > now);
}

const STATUS: Record<string, { tone: "info" | "attention" | "success" | "neutral" | "danger"; label: string }> = {
  confirmed: { tone: "info", label: "Booked" },
  checked_in: { tone: "attention", label: "Arrived" },
  fulfilled: { tone: "success", label: "Visit done" },
  no_show: { tone: "danger", label: "Did not come" },
  cancelled: { tone: "neutral", label: "Cancelled" },
  rescheduled: { tone: "neutral", label: "Moved to another time" },
};

const visitsKey = (childId: string) => `staff-visits:${childId}`;

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok?: string }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : state.error.code === "conflict" ? "Could not be changed" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" && ok ? <Notice tone="success" role="status" title={ok} /> : null}
    </ResultRegion>
  );
}

function Row({ childId, a, sessions, tz, canManage }: { childId: string; a: ChildAppointment; sessions: BookableSession[]; tz: string; canManage: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const cancel = useMutation(`/api/v1/appointments/${a.appointmentId}/cancel`);
  const move = useMutation(`/api/v1/appointments/${a.appointmentId}/reschedule`);
  const [mode, setMode] = useState<"none" | "move" | "cancel">("none");
  const busy = refreshing || cancel.state.phase === "pending" || move.state.phase === "pending";
  const options = sessions.filter((s) => s.sessionId !== a.sessionId && s.remainingOnline > 0);
  const st = STATUS[a.status] ?? { tone: "neutral" as const, label: a.status };
  const when = `${formatDate(a.serviceDate)}, ${formatClinicTime(a.startsAt, tz)}–${formatClinicTime(a.endsAt, tz)}`;
  const editable = canManage && a.status === "confirmed" && a.sessionStatus === "open";
  return (
    <li className="p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="tnum block font-bold">{when}</span>
          <span className="text-sm text-ink-soft">
            {a.channel === "online" ? "Booked by the family" : "Booked by staff"}
            {a.reason ? ` · ${a.reason}` : ""}
          </span>
        </span>
        <StatusChip tone={st.tone}>{st.label}</StatusChip>
      </div>
      {editable ? (
        <div className="mt-2">
          <div className="flex flex-wrap gap-3">
            <Button variant="quiet" disabled={busy} onClick={() => setMode(mode === "move" ? "none" : "move")} aria-expanded={mode === "move"}>Change time</Button>
            <Button variant="danger" disabled={busy} onClick={() => setMode(mode === "cancel" ? "none" : "cancel")} aria-expanded={mode === "cancel"}>Cancel visit</Button>
          </div>
          {mode === "cancel" ? (
            <form
              className="mt-2 rounded-control border border-danger bg-danger-bg p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
                const r = await cancel.run({ reason: reason || undefined });
                if (r?.ok) {
                  // Announced above the list: a cancelled visit loses these controls on refresh.
                  announceOutcome(visitsKey(childId), { title: `Visit on ${formatDate(a.serviceDate)} cancelled`, message: "The family has been told." });
                  startRefresh(() => router.refresh());
                }
              }}
            >
              <TextField id={`cx-${a.appointmentId}`} name="reason" label="Reason (optional, kept with the booking)" maxLength={300} />
              <p className="mb-3 text-sm font-semibold text-danger">The family is told the visit on {formatDate(a.serviceDate)} is cancelled.</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="danger" pending={cancel.state.phase === "pending"} disabled={busy}>Yes, cancel the visit</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setMode("none")}>Keep the visit</Button>
              </div>
            </form>
          ) : null}
          {mode === "move" ? (
            <form
              className="mt-2 rounded-control border border-line p-3"
              onSubmit={async (e) => {
                e.preventDefault();
                const newSessionId = String(new FormData(e.currentTarget).get("newSessionId"));
                const r = await move.run({ newSessionId });
                if (r?.ok) {
                  const to = options.find((s) => s.sessionId === newSessionId);
                  announceOutcome(visitsKey(childId), { title: to ? `Visit moved to ${formatDate(to.serviceDate)}, ${formatClinicTime(to.startsAt, tz)}` : "Visit moved", message: "The family has been told about the new time." });
                  startRefresh(() => router.refresh());
                }
              }}
            >
              {options.length === 0 ? (
                <p className="mb-2 text-sm text-ink-soft">No other session in the next two weeks has a bookable place. Create a session on Today first.</p>
              ) : (
                <SelectField id={`mv-${a.appointmentId}`} name="newSessionId" label="New time" required>
                  {options.map((s) => (
                    <option key={s.sessionId} value={s.sessionId}>
                      {formatDate(s.serviceDate)}, {formatClinicTime(s.startsAt, tz)} ({s.remainingOnline} left)
                    </option>
                  ))}
                </SelectField>
              )}
              <p className="mb-2 text-sm text-ink-soft">If the new time fills up first, the current booking stays as it is. The family is told about the new time.</p>
              <Button type="submit" pending={move.state.phase === "pending"} disabled={busy || options.length === 0}>Move the visit</Button>
            </form>
          ) : null}
          <Outcome state={cancel.state} />
          <Outcome state={move.state} />
        </div>
      ) : null}
    </li>
  );
}

function BookForFamily({ childId, childName, sessions, tz }: { childId: string; childName: string; sessions: BookableSession[]; tz: string }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const { state, run } = useMutation<{ appointmentId: string }>("/api/v1/appointments");
  const open = sessions.filter((s) => s.remainingOnline > 0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const r = await run({ childId, sessionId: String(f.get("sessionId")), reason: String(f.get("reason") ?? "").trim() || undefined });
    if (r?.ok) {
      form.reset();
      startRefresh(() => router.refresh());
    }
  }
  if (sessions.length === 0) {
    return <EmptyState title="No sessions in the next two weeks">Create a session on Today, then book the visit here.</EmptyState>;
  }
  return (
    <form onSubmit={submit} className="rounded-control border border-line bg-surface p-4">
      <h3 className="mb-3 font-bold">Book a visit for {childName}</h3>
      {open.length === 0 ? <p className="mb-3 text-sm text-ink-soft">Every session in the next two weeks is full. Change its places on Today, or check the child in as a walk-in.</p> : (
        <SelectField id={`bk-${childId}`} name="sessionId" label="Session" required>
          {open.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {formatDate(s.serviceDate)}, {formatClinicTime(s.startsAt, tz)}–{formatClinicTime(s.endsAt, tz)} ({s.remainingOnline} left)
            </option>
          ))}
        </SelectField>
      )}
      <TextField id={`bk-reason-${childId}`} name="reason" label="Note (optional), for example “booked by phone”" maxLength={300} />
      <p className="mb-3 text-sm text-ink-soft">Uses a bookable place. The family is told about the booking in the app.</p>
      <Outcome state={state} ok="Visit booked. The family has been told." />
      <Button type="submit" pending={state.phase === "pending" || refreshing} disabled={open.length === 0}>Book this visit</Button>
    </form>
  );
}

/**
 * Staff view of a child's bookings at this clinic, for families who phone in, walk up to the desk or have no smartphone.
 * Booking, moving and cancelling use the same commands as the family app; the database records them as "booked by staff".
 */
export function StaffVisits({ childId, childName, appointments, sessions, clinicTimezone, canManage, recordActive }: {
  childId: string;
  childName: string;
  appointments: ChildAppointment[];
  sessions: BookableSession[];
  clinicTimezone: string;
  canManage: boolean;
  recordActive: boolean;
}) {
  const upcoming = appointments.filter((a) => a.status === "confirmed" || a.status === "checked_in");
  const past = appointments.filter((a) => !upcoming.includes(a));
  const bookable = bookableSessions(sessions);
  return (
    <div className="space-y-5">
      <OutcomeNoticeView noticeKey={visitsKey(childId)} />
      {upcoming.length === 0 ? (
        <p className="text-ink-soft">No upcoming visit is booked.</p>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface">
          {upcoming.map((a) => <Row key={a.appointmentId} childId={childId} a={a} sessions={bookable} tz={clinicTimezone} canManage={canManage} />)}
        </ul>
      )}
      {canManage ? (
        recordActive ? (
          <BookForFamily childId={childId} childName={childName} sessions={bookable} tz={clinicTimezone} />
        ) : (
          <Notice tone="attention" title="This record cannot be booked">Only a provisional or active record can be booked. An inactive record must be made active first.</Notice>
        )
      ) : null}
      {past.length > 0 ? (
        <details className="rounded-control border border-line bg-surface">
          <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold">Earlier and cancelled visits ({past.length})</summary>
          <ul className="divide-y divide-line border-t border-line">
            {past.map((a) => <Row key={a.appointmentId} childId={childId} a={a} sessions={bookable} tz={clinicTimezone} canManage={false} />)}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
