import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  stalledQuery: 0,
  queryCount: 0,
  closed: false,
  options: {} as { statement_timeout?: number; query_timeout?: number },
}));
vi.mock("pg", async () => {
  const { EventEmitter } = await import("node:events");
  return { default: { Client: class extends EventEmitter {
    constructor(options: typeof state.options) { super(); state.options = options; }
    async connect() {}
    query(sql: string) {
      state.queryCount++;
      if (state.queryCount === state.stalledQuery) {
        // Model pg's read deadline: it rejects but leaves the active statement on the socket until end().
        return new Promise((_, reject) => {
          if (state.options.query_timeout) setTimeout(() => reject(new Error("Query read timeout")), state.options.query_timeout);
        });
      }
      return Promise.resolve({ rows: [{
        ...(sql.includes("run_daily_maintenance") ? { m: {} } : {}),
        r: { done: 0, cancelled: 0, retry: 0, failed: 0 }, applied: true,
      }] });
    }
    async end() { state.closed = true; }
  } } };
});

import { runOutboxOnce } from "@/lib/worker/outbox";
import { POST as webhook } from "@/app/api/v1/webhooks/sms/route";
import { resetRateLimits } from "@/lib/security/rate-limit";

afterEach(() => {
  vi.useRealTimers(); vi.unstubAllEnvs(); resetRateLimits();
  state.stalledQuery = 0; state.queryCount = 0; state.closed = false; state.options = {};
});

describe("database statement deadlines", () => {
  it.each([1, 2])("closes a worker connection after stalled query %s without starting further statements", async (stalledQuery) => {
    vi.useFakeTimers();
    vi.stubEnv("SMS_PROVIDER", "none");
    state.stalledQuery = stalledQuery;
    let result: unknown;
    let settled = false;
    const pass = runOutboxOnce("postgresql://worker@localhost/x").then(
      () => { settled = true; },
      (error) => { result = error; settled = true; },
    );
    await vi.advanceTimersByTimeAsync(35_000);
    expect(settled).toBe(true);
    expect(result).toBeInstanceOf(Error);
    expect(state.closed).toBe(true);
    expect(state.queryCount).toBe(stalledQuery);
    expect(state.options.statement_timeout).toBeGreaterThan(0);
    expect(state.options.statement_timeout!).toBeLessThan(state.options.query_timeout!);
    await pass;
  });

  it("closes a stalled webhook statement before returning a failure to the provider", async () => {
    vi.useFakeTimers();
    vi.stubEnv("SMS_WEBHOOK_SECRET", "secret");
    vi.stubEnv("CVSRS_SMS_WEBHOOK_DB_URL", "postgresql://webhook@localhost/x");
    state.stalledQuery = 1;
    const body = JSON.stringify({ eventId: "event-1", providerMessageId: "message-1", status: "delivered" });
    const signature = createHmac("sha256", "secret").update(body).digest("hex");
    let response: Response | undefined;
    const request = webhook(new Request("https://app.example/api/v1/webhooks/sms", {
      method: "POST", body, headers: { "x-signature": signature },
    })).then((r) => { response = r; });
    await vi.advanceTimersByTimeAsync(7500);
    expect(response?.status).toBe(500);
    expect(state.closed).toBe(true);
    expect(state.queryCount).toBe(1);
    expect(state.options.statement_timeout).toBeGreaterThan(0);
    expect(state.options.statement_timeout!).toBeLessThan(state.options.query_timeout!);
    await request;
  });
});
