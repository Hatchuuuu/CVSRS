import { describe, expect, it } from "vitest";
import { runWorkerLoop } from "../../src/lib/worker/loop";
import type { WorkerResult } from "../../src/lib/worker/outbox";

const ok: WorkerResult = { done: 1, cancelled: 0, retry: 0, failed: 0 };
const refused = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5432"), { code: "ECONNREFUSED" });

function harness(results: (WorkerResult | Error)[], stopAfter = results.length) {
  const lines: string[] = [];
  const waits: number[] = [];
  const controller = new AbortController();
  let calls = 0;
  return {
    lines,
    waits,
    controller,
    deps: {
      run: async () => {
        const r = results[calls++]!;
        if (calls >= stopAfter) controller.abort();
        if (r instanceof Error) throw r;
        return r;
      },
      sleep: async (ms: number) => { waits.push(ms); },
      log: (line: string) => { lines.push(line); },
      signal: controller.signal,
    },
    calls: () => calls,
  };
}

describe("outbox worker loop", () => {
  it("keeps running after a failed pass, logs it as structured JSON without connection details, and backs off", async () => {
    const h = harness([refused, refused, ok]);
    const code = await runWorkerLoop({ once: false, intervalMs: 10_000, maxBackoffMs: 60_000, ...h.deps });
    expect(code).toBe(0);
    expect(h.calls()).toBe(3);
    const failures = h.lines.map((l) => JSON.parse(l)).filter((e) => e.event === "worker_pass_failed");
    expect(failures).toHaveLength(2);
    expect(failures[0]).toMatchObject({ code: "ECONNREFUSED", consecutiveFailures: 1 });
    expect(failures[1]).toMatchObject({ consecutiveFailures: 2 });
    expect(h.lines.join("\n")).not.toContain("127.0.0.1");
    // Backoff grows after each consecutive failure; a success returns to the normal interval.
    expect(h.waits[0]).toBe(10_000);
    expect(h.waits[1]).toBe(20_000);
    expect(JSON.parse(h.lines.at(-1)!)).toMatchObject({ event: "worker_pass", done: 1 });
  });

  it("caps the backoff", async () => {
    const h = harness([refused, refused, refused, refused, refused, refused, refused, ok]);
    await runWorkerLoop({ once: false, intervalMs: 10_000, maxBackoffMs: 60_000, ...h.deps });
    expect(Math.max(...h.waits)).toBe(60_000);
  });

  it("--once exits 1 on a failed pass (so a scheduler marks the run failed) and 0 on success", async () => {
    expect(await runWorkerLoop({ once: true, intervalMs: 10_000, maxBackoffMs: 60_000, ...harness([refused]).deps })).toBe(1);
    expect(await runWorkerLoop({ once: true, intervalMs: 10_000, maxBackoffMs: 60_000, ...harness([ok]).deps })).toBe(0);
  });

  it("stops between passes when asked to (SIGTERM), without starting another pass", async () => {
    const h = harness([ok, ok, ok], 1);
    expect(await runWorkerLoop({ once: false, intervalMs: 10_000, maxBackoffMs: 60_000, ...h.deps })).toBe(0);
    expect(h.calls()).toBe(1);
  });
});

describe("review follow-ups (I4-11 F4)", () => {
  it("a thrown null or undefined is still a logged, retried failure", async () => {
    for (const thrown of [null, undefined]) {
      const lines: string[] = [];
      const controller = new AbortController();
      let calls = 0;
      const code = await runWorkerLoop({
        once: false, intervalMs: 10, maxBackoffMs: 10, signal: controller.signal, log: (l) => lines.push(l), sleep: async () => undefined,
        run: async () => { calls += 1; if (calls === 1) throw thrown; controller.abort(); return { done: 0, cancelled: 0, retry: 0, failed: 0 }; },
      });
      expect(code).toBe(0);
      expect(JSON.parse(lines[0]!)).toMatchObject({ event: "worker_pass_failed", code: "error" });
    }
  });

  it("abortableSleep resolves early on abort and at once when already aborted", async () => {
    const { abortableSleep } = await import("../../src/lib/worker/loop");
    const c = new AbortController();
    const started = Date.now();
    const p = abortableSleep(60_000, c.signal);
    c.abort();
    await p;
    expect(Date.now() - started).toBeLessThan(1000);
    await abortableSleep(60_000, c.signal);
  });

  it("a connection error emitted while no query runs is handled (node-postgres would otherwise crash the process)", async () => {
    const { EventEmitter } = await import("node:events");
    const vi = (await import("vitest")).vi;
    vi.resetModules();
    const made: InstanceType<typeof EventEmitter>[] = [];
    class FakeClient extends EventEmitter {
      constructor() { super(); made.push(this); }
      async connect() {}
      async query() { return { rows: [{ m: {}, r: { done: 0, cancelled: 0, retry: 0, failed: 0 } }] }; }
      async end() {}
    }
    vi.doMock("pg", () => ({ default: { Client: FakeClient } }));
    try {
      const { runOutboxOnce } = await import("../../src/lib/worker/outbox");
      await runOutboxOnce("postgresql://w@127.0.0.1/x");
      // The server goes away while the client is idle: EventEmitter throws on an 'error' event that has no listener.
      expect(() => made[0]!.emit("error", Object.assign(new Error("Connection terminated unexpectedly"), { code: "57P01" }))).not.toThrow();
    } finally {
      vi.doUnmock("pg");
    }
  });
});
