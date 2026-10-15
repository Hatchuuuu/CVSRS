import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  probe: vi.fn<(signal: AbortSignal) => Promise<{ error: null | { code: string } }>>(),
}));
vi.mock("@/lib/env", () => ({ getConfig: () => ({ supabaseUrl: "https://db.example.test", supabaseKey: "public" }) }));
vi.mock("@/lib/security/rate-limit", () => ({ assertRateLimitStoreConfigured: () => undefined }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: () => {
      const request = {
        abortSignal: (signal: AbortSignal) => state.probe(signal),
        then: (resolve: (result: { error: null | { code: string } }) => unknown) => state.probe(new AbortController().signal).then(resolve),
      };
      return request;
    },
  }),
}));

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); state.probe.mockReset(); });
afterEach(() => { vi.useRealTimers(); });

it("coalesces concurrent cold and expired readiness requests into one database round trip", async () => {
  let finish!: (result: { error: null }) => void;
  state.probe.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { GET } = await import("@/app/api/v1/health/ready/route");
  const requests = Array.from({ length: 20 }, () => GET());
  await Promise.resolve();
  expect(state.probe).toHaveBeenCalledTimes(1);
  finish({ error: null });
  expect((await Promise.all(requests)).every((response) => response.status === 200)).toBe(true);
  await GET();
  expect(state.probe).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(5001);
  const next = Array.from({ length: 20 }, () => GET());
  await Promise.resolve();
  expect(state.probe).toHaveBeenCalledTimes(2);
  finish({ error: null });
  expect((await Promise.all(next)).every((response) => response.status === 200)).toBe(true);
});

it("aborts a stalled database probe and shares the unavailable result", async () => {
  let signal!: AbortSignal;
  state.probe.mockImplementation((s) => { signal = s; return new Promise(() => undefined); });
  const { GET } = await import("@/app/api/v1/health/ready/route");
  const responses = [GET(), GET()];
  await vi.advanceTimersByTimeAsync(2000);
  expect((await Promise.all(responses)).map((response) => response.status)).toEqual([503, 503]);
  expect(signal.aborted).toBe(true);
  expect((await GET()).status).toBe(503);
  expect(state.probe).toHaveBeenCalledTimes(1);
});
