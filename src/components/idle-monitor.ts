/** Idle timing for the staff idle sign-out. Pure and timer-injectable so it can be tested without a browser. */

export type IdlePhase = "active" | "warning" | "expired";
export interface IdleState {
  phase: IdlePhase;
  remainingMs: number;
}

/** The warning is shown for the final minute of the idle period. */
export const IDLE_WARNING_MS = 60_000;

/** Wall-clock based, so a computer that slept past the deadline expires on the next tick. */
export function idlePhase(now: number, lastActivity: number, idleMs: number, warningMs = IDLE_WARNING_MS): IdleState {
  const remainingMs = Math.max(0, lastActivity + idleMs - now);
  if (remainingMs === 0) return { phase: "expired", remainingMs: 0 };
  return { phase: remainingMs <= warningMs ? "warning" : "active", remainingMs };
}

export interface IdleMonitorOptions {
  idleMs: number;
  warningMs?: number;
  tickMs?: number;
  now?: () => number;
  /** Called on every phase change and on every tick of the warning (for the countdown). */
  onChange: (state: IdleState) => void;
}

export function createIdleMonitor({ idleMs, warningMs = IDLE_WARNING_MS, tickMs = 1_000, now = Date.now, onChange }: IdleMonitorOptions) {
  let last = now();
  let phase: IdlePhase = "active";
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };
  const evaluate = () => {
    if (phase === "expired") return;
    const state = idlePhase(now(), last, idleMs, warningMs);
    if (state.phase !== phase || state.phase === "warning") {
      phase = state.phase;
      onChange(state);
    }
    if (phase === "expired") stop();
  };
  const reset = (at: number) => {
    last = Math.max(last, at);
    if (phase !== "active") {
      phase = "active";
      onChange({ phase: "active", remainingMs: idleMs });
    }
  };

  return {
    start() {
      stop();
      timer = setInterval(evaluate, tickMs);
    },
    stop,
    /**
     * User input. Local input is ignored once the warning shows, so the person has to choose (stay or sign out) explicitly.
     * `remote` is input in another tab of this browser: it always counts, so an active tab is never signed out by an idle one.
     * Returns whether the input restarted the idle period.
     */
    activity(at: number = now(), opts: { remote?: boolean } = {}): boolean {
      if (phase === "expired" || (phase === "warning" && !opts.remote)) return false;
      reset(at);
      return true;
    },
    /** "Stay signed in". */
    dismiss() {
      if (phase === "expired") return;
      last = now();
      phase = "active";
      onChange({ phase: "active", remainingMs: idleMs });
    },
  };
}
