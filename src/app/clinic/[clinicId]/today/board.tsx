"use client";
import { personName } from "@/lib/person-name";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button, EmptyState, Notice, ResultRegion, SelectField, StatusChip, TextField } from "@/components/ui";
import { callApi, useMutation, type MutationState } from "@/lib/client/api";
import { formatDate } from "@/lib/format";
import { callNextNotice, checkInMessage, finishTransition, VISIT_OUTCOMES } from "./queue-logic";

export interface QueueEntry {
  queueEntryId: string;
  ticket: string;
  status: "waiting" | "called" | "in_service" | "completed" | "held" | "left" | "cancelled" | "deferred";
  station: string | null;
  priority: "routine" | "priority";
  priorityReason: string | null;
  walkIn: boolean;
  childId: string;
  childName: string;
  recordNo: string;
  queuedAt: string;
  version: number;
}

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok?: ReactNode }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : (state.error.code === "conflict" ? "Already changed" : "Not saved")}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" && ok ? <Notice tone="success" role="status" title="Done">{ok}</Notice> : null}
    </ResultRegion>
  );
}

/** The label is formatted on the server in the clinic's timezone, after all worklist reads completed. */
export function AutoRefresh({ confirmedLabel }: { confirmedLabel: string }) {
  const router = useRouter();
  useEffect(() => {
    const editing = () => {
      const active = document.activeElement;
      return Boolean(active && (active.tagName === "INPUT" || active.tagName === "SELECT" || active.tagName === "TEXTAREA" || active.hasAttribute("contenteditable")));
    };
    // A tab in the background makes no requests; coming back to it refreshes at once (audit F18).
    const t = setInterval(() => {
      if (document.hidden || editing()) return;
      router.refresh();
    }, 15_000);
    const onVisible = () => {
      if (!document.hidden && !editing()) router.refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
  // Not a live region: re-announcing the time every 15 seconds would talk over screen-reader users (audit F18).
  return <p className="tnum rounded-full border border-line bg-surface px-3 py-1 text-sm text-ink-soft">Data loaded {confirmedLabel}</p>;
}

export function CreateSessionForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/sessions`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const n = (k: string) => Number(f.get(k));
    const r = await run({ serviceDate: String(f.get("date")), startTime: String(f.get("start")), endTime: String(f.get("end")), totalCapacity: n("total"), onlineCapacity: n("online"), walkinCapacity: n("walkin") });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit}>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <TextField id="cs-date" name="date" type="date" label="Date" required error={fe.serviceDate} />
        <TextField id="cs-start" name="start" type="time" label="Starts" required error={fe.startTime} />
        <TextField id="cs-end" name="end" type="time" label="Ends" required error={fe.endTime} />
        <TextField id="cs-total" name="total" type="number" min="0" label="Total places" defaultValue="20" required error={fe.totalCapacity} />
        <TextField id="cs-online" name="online" type="number" min="0" label="Places families can book" defaultValue="12" required />
        <TextField id="cs-walk" name="walkin" type="number" min="0" label="Places kept for walk-ins" defaultValue="8" required hint="Booked plus walk-in places cannot exceed the total." />
      </div>
      <Outcome state={state} ok="Session created." />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        Create session
      </Button>
    </form>
  );
}

const CheckInAnnounce = createContext<((message: string) => void) | null>(null);

/**
 * Holds the check-in result above the "Expected today" list. A checked-in row stops rendering its button after the
 * refresh, so the ticket number is kept here (outside the row) and focus moves to it.
 */
export function CheckInRegion({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ text: string; n: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (notice) ref.current?.focus();
  }, [notice]);
  return (
    <CheckInAnnounce.Provider value={(text) => setNotice((prev) => ({ text, n: (prev?.n ?? 0) + 1 }))}>
      <div ref={ref} tabIndex={-1} className="outline-none">
        <ResultRegion>{notice ? <Notice tone="success" role="status" title={notice.text} /> : null}</ResultRegion>
      </div>
      {children}
    </CheckInAnnounce.Provider>
  );
}

export function AppointmentRow({ clinicId, childId, appointmentId, name }: { clinicId: string; childId: string; appointmentId: string; name: string }) {
  const router = useRouter();
  const announce = useContext(CheckInAnnounce);
  const { state, run } = useMutation<{ ticket: string }>(`/api/v1/clinics/${clinicId}/queue/check-in`);
  return (
    <div className="mt-2">
      <Outcome state={state} ok={!announce && state.phase === "success" ? checkInMessage(state.data.ticket, name) : undefined} />
      <Button
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run({ childId, appointmentId });
          if (r?.ok) {
            announce?.(checkInMessage(r.data.ticket, name));
            router.refresh();
          }
        }}
        aria-label={`Check in ${name}`}
      >
        Check in and give a ticket
      </Button>
    </div>
  );
}

interface Hit {
  childId: string;
  displayName: string;
  localRecordNo: string;
  dob: string | null;
}

export function WalkInPanel({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const searchSequence = useRef(0);
  const [overflow, setOverflow] = useState("");
  const { state, run } = useMutation<{ ticket: string }>(`/api/v1/clinics/${clinicId}/queue/check-in`);

  async function search(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = String(new FormData(e.currentTarget).get("q") ?? "").trim();
    const sequence = ++searchSequence.current;
    setHits(null);
    setSearchError(null);
    if (q.length < 2) return setSearchError("Enter at least two letters.");
    setSearching(true);
    const res = await callApi<Hit[]>(`/api/v1/clinics/${clinicId}/children?${new URLSearchParams({ q })}`);
    if (sequence !== searchSequence.current) return;
    setSearching(false);
    if (res.ok) setHits(res.data);
    else setSearchError(res.message);
  }
  const needsOverflow = state.phase === "error" && /allocation|overflow/i.test(state.error.message);
  return (
    <div>
      <form onSubmit={search} role="search" className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <TextField id="wi-q" name="q" label="Find the child" autoComplete="off" onChange={() => { searchSequence.current++; setHits(null); setSearchError(null); setSearching(false); }} />
        </div>
        <div className="mb-4">
          <Button type="submit" variant="secondary" disabled={searching}>
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </form>
      {searchError ? <Notice tone="danger" role="alert">{searchError}</Notice> : null}
      {hits && hits.length === 0 ? <EmptyState title="Not found at this clinic">Register the child from the clinic workspace first.</EmptyState> : null}
      {hits && hits.length > 0 ? (
        <ul className="mb-3 divide-y divide-line rounded-control border border-line">
          {hits.map((h) => (
            <li key={h.childId} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="min-w-0 break-words">
                <span className="block font-bold">{personName(h.displayName)}</span>
                <span className="text-sm text-ink-soft">
                  {h.localRecordNo} · {formatDate(h.dob, { fallback: "DOB not recorded" })}
                </span>
              </span>
              <Button
                disabled={state.phase === "pending"}
                aria-label={`Add ${personName(h.displayName)} to the queue`}
                onClick={async () => {
                  const r = await run({ childId: h.childId, overflowReason: overflow.trim() || undefined });
                  if (r?.ok) {
                    setHits(null);
                    setOverflow("");
                    router.refresh();
                  }
                }}
              >
                Add to queue
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {needsOverflow ? (
        <TextField id="wi-overflow" label="Walk-in places are used up. Reason to continue anyway" value={overflow} onChange={(e) => setOverflow(e.target.value)} hint="Recorded in the audit trail. Only continue if the clinic can really see this child." />
      ) : null}
      <Outcome state={state} ok={state.phase === "success" ? `Ticket ${state.data.ticket} issued.` : undefined} />
    </div>
  );
}

const LABEL: Record<string, { tone: "info" | "attention" | "success" | "neutral" | "review"; text: string }> = {
  waiting: { tone: "info", text: "Waiting" },
  called: { tone: "attention", text: "Called" },
  in_service: { tone: "review", text: "In service" },
  completed: { tone: "success", text: "Finished" },
  deferred: { tone: "neutral", text: "Deferred" },
  held: { tone: "attention", text: "On hold" },
  left: { tone: "neutral", text: "Left" },
  cancelled: { tone: "neutral", text: "Cancelled" },
};

/** `canOpenRecord`: the viewer holds child.search, so the clinic record page will open for them. */
export function QueueBoard({ clinicId, entries, canOpenRecord = false }: { clinicId: string; entries: QueueEntry[]; canOpenRecord?: boolean }) {
  const router = useRouter();
  const [station, setStation] = useState("Station 1");
  const next = useMutation<{ called: boolean; ticket?: string }>(`/api/v1/clinics/${clinicId}/queue/call-next`);
  const active = entries.filter((e) => ["waiting", "called", "in_service", "held"].includes(e.status));
  const done = entries.filter((e) => !["waiting", "called", "in_service", "held"].includes(e.status));
  // A stale "Now calling" banner would contradict the list, so it is shown only while it is still true.
  const nextNotice = next.state.phase === "success" ? callNextNotice(next.state.data, entries) : null;
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-40 max-w-full">
          <TextField id="q-station" label="Your station" value={station} onChange={(e) => setStation(e.target.value)} />
        </div>
        <div className="mb-4">
          <Button
            disabled={next.state.phase === "pending" || !station.trim()}
            onClick={async () => {
              const r = await next.run({ station: station.trim() });
              if (r?.ok) router.refresh();
            }}
          >
            Call next patient
          </Button>
        </div>
      </div>
      <ResultRegion>
        {nextNotice ? <Notice tone={nextNotice.tone} role="status" title={nextNotice.title} /> : null}
        {next.state.phase === "error" ? <Notice tone={next.state.error.unknown ? "attention" : "danger"} role="alert" title={next.state.error.unknown ? "Not confirmed yet" : undefined}>{next.state.error.message}</Notice> : null}
      </ResultRegion>
      {active.length === 0 ? (
        <EmptyState title="The queue is empty">Check in a booked family or add a walk-in.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface overflow-hidden shadow-xs" aria-label="Active queue">
          {active.map((e) => (
            <QueueRow key={e.queueEntryId} clinicId={clinicId} e={e} station={station} canOpenRecord={canOpenRecord} />
          ))}
        </ul>
      )}
      {done.length > 0 ? (
        <details className="mt-4">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">Finished or left today ({done.length})</summary>
          <ul className="divide-y divide-line">
            {done.map((e) => (
              <li key={e.queueEntryId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 break-words">
                  <strong>{e.ticket}</strong> {personName(e.childName)}
                </span>
                <StatusChip tone={LABEL[e.status]?.tone ?? "neutral"}>{LABEL[e.status]?.text ?? e.status}</StatusChip>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function QueueRow({ clinicId, e, station, canOpenRecord }: { clinicId: string; e: QueueEntry; station: string; canOpenRecord: boolean }) {
  const router = useRouter();
  const move = useMutation<{ status: string }>(`/api/v1/clinics/${clinicId}/queue/${e.queueEntryId}/transition`);
  const prio = useMutation(`/api/v1/clinics/${clinicId}/queue/${e.queueEntryId}/priority`);
  const [reason, setReason] = useState("");
  // No default: a hurried click must not record "vaccinated" for a visit where no dose was given.
  const [outcome, setOutcome] = useState("");
  const go = async (to: string, extra: Record<string, unknown> = {}) => {
    const r = await move.run({ to, expectedVersion: e.version, ...extra });
    if (r?.ok) {
      setReason("");
      router.refresh();
    }
  };
  const l = LABEL[e.status] ?? { tone: "neutral" as const, text: e.status };
  const needsReason = ["waiting", "called", "held"].includes(e.status);
  const busy = move.state.phase === "pending";
  return (
    <li className={`p-4 transition-colors duration-150 even:bg-sunken/25 ${e.status === "called" ? "bg-attention-bg/60" : e.status === "in_service" ? "bg-review-bg/50" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 items-start gap-4">
          <span className={`tnum rounded-xl px-3 py-1.5 text-xl font-black leading-tight shadow-xs ${e.status === "called" ? "bg-attention text-on-primary" : e.status === "in_service" ? "bg-primary text-on-primary" : "bg-surface border border-line text-ink"}`}>{e.ticket}</span>
          <span className="min-w-0">
            {canOpenRecord ? (
              <Link href={`/clinic/${clinicId}/children/${e.childId}`} className="flex min-h-11 items-center break-words text-lg font-bold leading-snug text-primary">
                {personName(e.childName)}
              </Link>
            ) : (
              <span className="block break-words text-lg font-bold leading-snug">{personName(e.childName)}</span>
            )}
            <span className="tnum block text-sm text-ink-soft">
              {e.recordNo}
              {e.walkIn ? " · walk-in" : " · booked"}
              {e.station ? ` · ${e.station}` : ""}
            </span>
            {e.priority === "priority" ? <span className="mt-1 block text-sm font-semibold text-attention">Priority: {e.priorityReason}</span> : null}
          </span>
        </div>
        <StatusChip tone={l.tone}>{l.text}</StatusChip>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {e.status === "waiting" ? (
          <Button variant="secondary" disabled={busy} onClick={() => go("called", { station })}>
            Call
          </Button>
        ) : null}
        {e.status === "held" ? (
          <Button variant="secondary" disabled={busy} onClick={() => go("waiting")}>
            Return to line
          </Button>
        ) : null}
        {e.status === "called" ? (
          <>
            <Button disabled={busy} onClick={() => go("in_service", { station })}>
              Start service
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => go("called", { station })}>
              Call again
            </Button>
          </>
        ) : null}
        {e.status === "in_service" ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(ev) => {
              ev.preventDefault();
              if (outcome) void go(finishTransition(outcome), { outcome });
            }}
          >
            <div className="w-44 max-w-full">
              <SelectField id={`out-${e.queueEntryId}`} label="Visit outcome" value={outcome} onChange={(ev) => setOutcome(ev.target.value)} required>
                <option value="" disabled>
                  Choose outcome…
                </option>
                {VISIT_OUTCOMES.map(([value, text]) => (
                  <option key={value} value={value}>
                    {text}
                  </option>
                ))}
              </SelectField>
            </div>
            <div className="mb-4">
              <Button type="submit" disabled={busy}>
                Finish visit
              </Button>
            </div>
          </form>
        ) : null}
      </div>

      {needsReason ? (
        <details className="mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold text-primary">More actions</summary>
          <div className="rounded-control border border-line bg-canvas p-3">
            <TextField id={`why-${e.queueEntryId}`} label="Reason" hint="Required to hold, mark as left, cancel or prioritise. Recorded in the audit trail." value={reason} onChange={(ev) => setReason(ev.target.value)} />
            <div className="flex flex-wrap gap-2">
              {e.status === "called" ? (
                <Button variant="secondary" disabled={busy} onClick={() => go("held", { reason })}>
                  Put on hold
                </Button>
              ) : null}
              {e.status === "waiting" && e.priority === "routine" ? (
                <Button
                  variant="secondary"
                  disabled={prio.state.phase === "pending"}
                  onClick={async () => {
                    const r = await prio.run({ priority: "priority", reason });
                    if (r?.ok) {
                      setReason("");
                      router.refresh();
                    }
                  }}
                >
                  Prioritise
                </Button>
              ) : null}
              <Button variant="secondary" disabled={busy} onClick={() => go("left", { reason })}>
                Mark as left
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => go("cancelled", { reason })}>
                Cancel ticket
              </Button>
            </div>
          </div>
        </details>
      ) : null}
      <Outcome state={move.state} />
      <Outcome state={prio.state} />
    </li>
  );
}
