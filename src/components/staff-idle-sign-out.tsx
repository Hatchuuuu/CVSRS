"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createIdleMonitor, type IdleState } from "@/components/idle-monitor";
import { DEFAULT_STAFF_IDLE_MINUTES, parseStaffIdleMinutes } from "@/lib/auth/session-policy";

const ACTIVITY_KEY = "cvsrs:staff-activity";
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "scroll"] as const;

function idleMinutes(): number {
  try {
    return parseStaffIdleMinutes(process.env.NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES);
  } catch {
    return DEFAULT_STAFF_IDLE_MINUTES; // The server refuses to start with an invalid value; never disable the lock by accident.
  }
}

/**
 * Signs a staff member out of a shared clinic computer after NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES (default 15, 0 = off) without
 * input, after a one-minute warning that can be dismissed. Input in any tab of this browser keeps every tab signed in.
 * Mounted by the root layout only for signed-in staff.
 */
export function StaffIdleSignOut() {
  const [minutes] = useState(idleMinutes);
  const [state, setState] = useState<IdleState>({ phase: "active", remainingMs: minutes * 60_000 });
  const monitor = useRef<ReturnType<typeof createIdleMonitor> | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const stay = useRef<HTMLButtonElement>(null);
  const leave = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!minutes) return;
    const m = createIdleMonitor({ idleMs: minutes * 60_000, onChange: setState });
    monitor.current = m;
    let lastShared = 0;
    const share = (at: number) => {
      if (at - lastShared < 5_000) return;
      lastShared = at;
      try { localStorage.setItem(ACTIVITY_KEY, String(at)); } catch { /* storage unavailable: this tab still tracks itself */ }
    };
    const onActivity = () => {
      const at = Date.now();
      if (m.activity(at)) share(at);
    };
    const onStorage = (e: StorageEvent) => {
      const at = Number(e.newValue);
      if (e.key === ACTIVITY_KEY && Number.isFinite(at)) m.activity(Math.min(at, Date.now()), { remote: true });
    };
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, onActivity, { passive: true, capture: true });
    window.addEventListener("storage", onStorage);
    m.start();
    return () => {
      m.stop();
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, onActivity, { capture: true });
      window.removeEventListener("storage", onStorage);
      monitor.current = null;
    };
  }, [minutes]);

  useEffect(() => {
    if (state.phase === "warning" && document.activeElement !== stay.current && document.activeElement !== leave.current) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      stay.current?.focus();
    }
    if (state.phase === "expired") {
      const f = form.current;
      if (f) {
        if (typeof f.requestSubmit === "function") f.requestSubmit();
        else f.submit();
      }
    }
  }, [state.phase]);

  function keepSession() {
    monitor.current?.dismiss();
    try { localStorage.setItem(ACTIVITY_KEY, String(Date.now())); } catch { /* ignore */ }
    returnFocus.current?.focus();
    returnFocus.current = null;
  }

  function onDialogKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      keepSession();
    } else if (e.key === "Tab") {
      // Keep focus inside the dialog: it covers the page.
      e.preventDefault();
      (document.activeElement === stay.current ? leave.current : stay.current)?.focus();
    }
  }

  const seconds = Math.ceil(state.remainingMs / 1_000);
  const announcement = state.phase !== "warning" ? "" : seconds <= 10 ? "Signing out in 10 seconds." : seconds <= 30 ? "Signing out in 30 seconds." : "";

  return (
    <>
      <form ref={form} action="/auth/sign-out" method="post" hidden aria-hidden />
      {state.phase === "warning" ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="idle-signout-title"
            aria-describedby="idle-signout-text"
            onKeyDown={onDialogKey}
            className="w-full max-w-md rounded-card border border-line bg-surface p-5 text-ink shadow-lg"
          >
            <h2 id="idle-signout-title" className="text-lg font-bold">Are you still there?</h2>
            <p id="idle-signout-text" className="mt-2 text-sm">
              This computer has had no activity for a while. To protect patient records, you will be signed out in about one minute.
            </p>
            <p className="tnum mt-3 text-2xl font-bold" aria-hidden>{seconds} s</p>
            <p className="sr-only" aria-live="polite">{announcement}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button ref={stay} type="button" onClick={keepSession} className="min-h-11 rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-strong">
                Stay signed in
              </button>
              <button ref={leave} type="button" onClick={() => form.current?.requestSubmit()} className="min-h-11 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-sunken">
                Sign out now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
