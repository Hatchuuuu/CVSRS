"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { callApi } from "@/lib/client/api";

export interface DisplayData {
  asOf: string;
  nowCalling: { ticket: string; station: string | null }[];
  waiting: string[];
}

const noSubscription = () => () => {};

export function DisplayBoard({ clinicId, initial }: { clinicId: string; initial: DisplayData }) {
  // The screen sits in the clinic, so its own clock zone is the clinic's. The server render has no such zone, so the
  // time appears only after hydration (no server/client text mismatch).
  const mounted = useSyncExternalStore(noSubscription, () => true, () => false);
  const [data, setData] = useState(initial);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  useEffect(() => {
    const t = setInterval(async () => {
      // A slow response must not overlap the next poll or replace newer numbers with older ones.
      if (inFlight.current) return;
      inFlight.current = true;
      const res = await callApi<DisplayData>(`/api/v1/clinics/${clinicId}/queue/display`, { timeoutMs: 4_500 });
      inFlight.current = false;
      if (res.ok) {
        setData((prev) => (Date.parse(res.data.asOf) >= Date.parse(prev.asOf) ? res.data : prev));
        setStale(false);
      } else setStale(true);
    }, 5000);
    return () => clearInterval(t);
  }, [clinicId]);
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-6 text-3xl font-bold">Now calling</h1>
      <div aria-live="polite" aria-atomic="true">
      {data.nowCalling.length === 0 ? (
        <p className="mb-8 text-2xl text-ink-soft">No one is being called right now.</p>
      ) : (
        <ul className="mb-8 grid gap-4 sm:grid-cols-2">
          {data.nowCalling.map((c) => (
            <li key={c.ticket} className="rounded-card border-2 border-primary bg-surface p-6">
              <p className="text-5xl font-bold">{c.ticket}</p>
              <p className="mt-2 text-2xl">{c.station ?? "Please go to the desk"}</p>
            </li>
          ))}
        </ul>
      )}
      </div>
      <h2 className="mb-3 text-2xl font-bold">Waiting</h2>
      {data.waiting.length === 0 ? (
        <p className="text-xl text-ink-soft">No one is waiting.</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {data.waiting.map((t) => (
            <li key={t} className="rounded-control border border-line bg-surface px-4 py-2 text-2xl font-semibold">
              {t}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-8 text-sm text-ink-soft">
        Numbers only.
        {mounted ? ` Updated ${new Date(data.asOf).toLocaleTimeString("en-PH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
      </p>
      <p className="text-sm text-ink-soft" role="status">{stale ? "Connection problem: this screen may be out of date; ask at the desk." : ""}</p>
    </div>
  );
}
