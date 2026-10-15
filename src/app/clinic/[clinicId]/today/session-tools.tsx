"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Notice, ResultRegion, StatusChip, TextField } from "@/components/ui";
import { useConfirmStep } from "@/components/confirm-step";
import { callApi, useMutation, type MutationState } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

export interface SessionRow {
  sessionId: string;
  serviceDate: string;
  status: string;
  totalCapacity: number;
  onlineCapacity: number;
  walkinCapacity: number;
  booked: number;
  version: number;
}

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok?: ReactNode }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : state.error.code === "conflict" ? "Already changed" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" && ok ? <Notice tone="success" role="status" title="Done">{ok}</Notice> : null}
    </ResultRegion>
  );
}

interface RosterEntry {
  appointmentId: string;
  status: string;
  channel: string;
  childId: string;
  childName: string;
  recordNo: string;
}

const ROSTER_STATUS: Record<string, string> = { confirmed: "Booked", checked_in: "Arrived", fulfilled: "Seen", no_show: "Did not come" };

/** Loaded only when someone opens it: each read is audited. */
function Roster({ clinicId, sessionId, recordHref }: { clinicId: string; sessionId: string; recordHref: (childId: string) => string | null }) {
  const [rows, setRows] = useState<RosterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    if (loading || rows) return;
    setLoading(true);
    setError(null);
    const r = await callApi<RosterEntry[]>(`/api/v1/clinics/${clinicId}/sessions/${sessionId}/roster`);
    setLoading(false);
    if (r.ok) setRows(r.data);
    else setError(r.message);
  }
  return (
    <details onToggle={(e) => (e.currentTarget.open ? void load() : undefined)}>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary-strong">Who is booked</summary>
      <div className="pb-2">
        {loading ? <p className="text-sm text-ink-soft" role="status">Loading…</p> : null}
        {error ? (
          <Notice tone="danger" role="alert" title="The list could not be loaded">
            {error}{" "}
            <button type="button" className="font-semibold underline" onClick={() => { setRows(null); void load(); }}>Try again</button>
          </Notice>
        ) : null}
        {rows && rows.length === 0 ? <p className="text-sm text-ink-soft">No families are booked.</p> : null}
        {rows && rows.length > 0 ? (
          <ul className="divide-y divide-line rounded-control border border-line">
            {rows.map((r) => {
              const href = recordHref(r.childId);
              return (
                <li key={r.appointmentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 break-words">
                    {href ? <Link href={href} className="inline-flex min-h-11 items-center font-semibold text-primary">{r.childName}</Link> : <span className="font-semibold">{r.childName}</span>}
                    <span className="tnum text-ink-soft"> · {r.recordNo} · {r.channel === "online" ? "booked online" : "booked by staff"}</span>
                  </span>
                  <StatusChip tone={r.status === "no_show" ? "attention" : r.status === "fulfilled" ? "success" : "info"}>{ROSTER_STATUS[r.status] ?? r.status}</StatusChip>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </details>
  );
}

function CapacityForm({ clinicId, s }: { clinicId: string; s: SessionRow }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/sessions/${s.sessionId}/capacity`);
  const id = (k: string) => `cap-${k}-${s.sessionId}`;
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const r = await run({ expectedVersion: s.version, totalCapacity: n("total"), onlineCapacity: n("online"), walkinCapacity: n("walkin") });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <details>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-primary-strong">Change places</summary>
      <form onSubmit={submit} className="pb-2">
        <div className="grid gap-x-4 sm:grid-cols-3">
          <TextField id={id("total")} name="total" type="number" min="0" label="Total places" defaultValue={String(s.totalCapacity)} required error={fe.totalCapacity} />
          <TextField id={id("online")} name="online" type="number" min={String(s.booked)} label="Places families can book" defaultValue={String(s.onlineCapacity)} required hint={`At least ${s.booked}: families already booked.`} />
          <TextField id={id("walkin")} name="walkin" type="number" min="0" label="Places kept for walk-ins" defaultValue={String(s.walkinCapacity)} required />
        </div>
        <Outcome state={state} ok="Places updated." />
        <Button type="submit" variant="secondary" pending={state.phase === "pending"}>Save places</Button>
      </form>
    </details>
  );
}

function CancelSession({ clinicId, s }: { clinicId: string; s: SessionRow }) {
  const router = useRouter();
  const { state, run } = useMutation<{ affectedBookings: number }>(`/api/v1/clinics/${clinicId}/sessions/${s.sessionId}/cancel`);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pending = state.phase === "pending";
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(confirming, pending);
  const id = `cancel-reason-${s.sessionId}`;
  const families = s.booked === 1 ? "1 family" : `${s.booked} families`;
  return (
    <details>
      <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold text-danger">Cancel session</summary>
      <div className="pb-2">
        <TextField id={id} label="Reason (families and the audit trail see it)" value={reason} onChange={(e) => { setReason(e.target.value); setConfirming(false); }} required minLength={3} maxLength={500} />
        <Outcome state={state} />
        {confirming ? (
          <div {...groupProps} aria-label="Confirm cancelling the session" className="flex flex-wrap items-center gap-3">
            <p {...textProps} className="w-full text-sm text-ink">
              {s.booked > 0 ? `${families} booked for ${formatDate(s.serviceDate)} will be told the visit will not take place, and each booking becomes follow-up work to rebook.` : "No family is booked. The session will close for booking."}
            </p>
            <Button variant="danger" pending={pending} onClick={async () => {
              const r = await run({ reason: reason.trim() });
              if (r?.ok) router.refresh();
              else setConfirming(true);
            }}>Yes, cancel the session</Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)} {...cancelProps}>Keep the session</Button>
          </div>
        ) : (
          <Button ref={triggerRef} variant="danger" disabled={reason.trim().length < 3} onClick={() => setConfirming(true)}>Cancel session…</Button>
        )}
      </div>
    </details>
  );
}

/** Per-session staff tools on Today: who is booked, change places, cancel. Closed and cancelled sessions only show the roster. */
export function SessionTools({ clinicId, s, canManage, recordHrefBase }: { clinicId: string; s: SessionRow; canManage: boolean; recordHrefBase: string | null }) {
  const recordHref = (childId: string) => (recordHrefBase ? `${recordHrefBase}/${childId}` : null);
  const editable = canManage && s.status === "open";
  return (
    <div className="mt-2 grid w-full gap-1 border-t border-line pt-2">
      <Roster clinicId={clinicId} sessionId={s.sessionId} recordHref={recordHref} />
      {editable ? <CapacityForm clinicId={clinicId} s={s} /> : null}
      {editable ? <CancelSession clinicId={clinicId} s={s} /> : null}
    </div>
  );
}

export interface BacklogDay {
  serviceDate: string;
  openTickets: number;
  openVisits: number;
  unconfirmedBookings: number;
  openSessions: number;
}
export interface ClosedDay {
  closedAt: string;
  automatic: boolean;
  summary: { date: string; ticketsLeft: number; visitsCompleted: number; visitsUnserved: number; noShows: number; bookingsCancelled: number; sessionsClosed: number };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function CloseDayButton({ clinicId, day }: { clinicId: string; day: BacklogDay }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/service-days/close`);
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-2">
      <span className="text-sm">
        <strong className="tnum">{formatDate(day.serviceDate)}</strong>
        {": "}
        {[
          day.openTickets ? plural(day.openTickets, "ticket still in the queue", "tickets still in the queue") : null,
          day.openVisits ? plural(day.openVisits, "visit never finished", "visits never finished") : null,
          day.unconfirmedBookings ? plural(day.unconfirmedBookings, "booking with no arrival", "bookings with no arrival") : null,
          day.openSessions ? plural(day.openSessions, "session still open", "sessions still open") : null,
        ].filter(Boolean).join(", ")}
      </span>
      <Button variant="secondary" pending={state.phase === "pending"} onClick={async () => {
        const r = await run({ serviceDate: day.serviceDate });
        if (r?.ok) router.refresh();
      }}>Close this day</Button>
      <div className="w-full"><Outcome state={state} /></div>
    </li>
  );
}

/**
 * Earlier days that were never finished. The worker closes them automatically; staff can close them at once.
 * Closing ends waiting tickets as "left", ends a visit with a recorded vaccination as vaccinated and any other unfinished
 * visit as unserved, marks bookings with no arrival as no-shows and closes the sessions.
 */
export function DayBacklog({ clinicId, open, recentlyClosed, canClose }: { clinicId: string; open: BacklogDay[]; recentlyClosed: ClosedDay[]; canClose: boolean }) {
  if (open.length === 0 && recentlyClosed.length === 0) return null;
  return (
    <section aria-labelledby="backlog-h" className="mb-8">
      {open.length > 0 ? (
        <Notice tone="attention" title="Earlier days were not finished">
          <p id="backlog-h">Close each day so unfinished visits end, missed bookings count as no-shows and the child&apos;s record can move or merge again. The system also closes them automatically.</p>
          {canClose ? <ul className="mt-2 divide-y divide-attention/30">{open.map((d) => <CloseDayButton key={d.serviceDate} clinicId={clinicId} day={d} />)}</ul> : null}
        </Notice>
      ) : (
        <h2 id="backlog-h" className="sr-only">Recently closed days</h2>
      )}
      {recentlyClosed.length > 0 ? (
        <details className="rounded-control border border-line bg-surface px-4">
          <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold">Recently closed days ({recentlyClosed.length})</summary>
          <ul className="divide-y divide-line pb-2">
            {recentlyClosed.map((c) => (
              <li key={c.closedAt + c.summary.date} className="py-2 text-sm">
                <strong className="tnum">{formatDate(c.summary.date)}</strong> · closed {c.automatic ? "automatically" : "by staff"}:{" "}
                {plural(c.summary.ticketsLeft, "ticket left", "tickets left")}, {plural(c.summary.visitsUnserved, "visit unserved", "visits unserved")},{" "}
                {plural(c.summary.visitsCompleted, "visit completed", "visits completed")}, {plural(c.summary.noShows, "no-show", "no-shows")}
                {c.summary.bookingsCancelled ? `, ${plural(c.summary.bookingsCancelled, "booking cancelled", "bookings cancelled")}` : ""}.
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
