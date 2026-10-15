import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIdleMonitor, idlePhase, type IdleState } from "@/components/idle-monitor";

const MINUTE = 60_000;

describe("idle phase", () => {
  it("is active until the final minute, then warns, then expires", () => {
    expect(idlePhase(0, 0, 15 * MINUTE)).toEqual({ phase: "active", remainingMs: 15 * MINUTE });
    expect(idlePhase(14 * MINUTE - 1, 0, 15 * MINUTE).phase).toBe("active");
    expect(idlePhase(14 * MINUTE, 0, 15 * MINUTE)).toEqual({ phase: "warning", remainingMs: MINUTE });
    expect(idlePhase(15 * MINUTE, 0, 15 * MINUTE)).toEqual({ phase: "expired", remainingMs: 0 });
  });
});

describe("idle monitor timer behaviour", () => {
  let changes: IdleState[];
  let monitor: ReturnType<typeof createIdleMonitor>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    changes = [];
    monitor = createIdleMonitor({ idleMs: 15 * MINUTE, onChange: (s) => changes.push(s) });
    monitor.start();
  });
  afterEach(() => { monitor.stop(); vi.useRealTimers(); });

  it("shows a 60-second warning after 14 idle minutes and signs out at 15", () => {
    vi.advanceTimersByTime(14 * MINUTE - 1_000);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(1_000);
    expect(changes.at(-1)).toEqual({ phase: "warning", remainingMs: MINUTE });
    vi.advanceTimersByTime(30_000);
    expect(changes.at(-1)).toEqual({ phase: "warning", remainingMs: 30_000 });
    vi.advanceTimersByTime(30_000);
    expect(changes.at(-1)).toEqual({ phase: "expired", remainingMs: 0 });
    const count = changes.length;
    vi.advanceTimersByTime(10 * MINUTE);
    expect(changes.length).toBe(count); // expires exactly once
  });

  it("user input before the warning restarts the idle period", () => {
    vi.advanceTimersByTime(10 * MINUTE);
    expect(monitor.activity()).toBe(true);
    vi.advanceTimersByTime(13 * MINUTE);
    expect(changes).toEqual([]);
    vi.advanceTimersByTime(MINUTE);
    expect(changes.at(-1)?.phase).toBe("warning");
  });

  it("requires an explicit choice once the warning shows; dismissing keeps the person signed in", () => {
    vi.advanceTimersByTime(14 * MINUTE);
    expect(monitor.activity()).toBe(false);
    vi.advanceTimersByTime(30_000);
    monitor.dismiss();
    expect(changes.at(-1)).toEqual({ phase: "active", remainingMs: 15 * MINUTE });
    vi.advanceTimersByTime(14 * MINUTE - 1_000);
    expect(changes.at(-1)?.phase).toBe("active");
  });

  it("activity in another tab of the same browser restarts the period even during the warning", () => {
    vi.advanceTimersByTime(14 * MINUTE + 10_000);
    expect(changes.at(-1)?.phase).toBe("warning");
    expect(monitor.activity(Date.now(), { remote: true })).toBe(true);
    expect(changes.at(-1)?.phase).toBe("active");
    vi.advanceTimersByTime(MINUTE);
    expect(changes.at(-1)?.phase).toBe("active");
  });

  it("expires immediately after the computer wakes from sleep past the deadline", () => {
    vi.setSystemTime(20 * MINUTE); // timers did not run while asleep
    vi.advanceTimersByTime(1_000);
    expect(changes.at(-1)?.phase).toBe("expired");
  });

  it("cannot be revived after expiry", () => {
    vi.advanceTimersByTime(15 * MINUTE);
    monitor.dismiss();
    expect(monitor.activity(Date.now(), { remote: true })).toBe(false);
    expect(changes.at(-1)?.phase).toBe("expired");
  });
});
