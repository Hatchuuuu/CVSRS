import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => [value, () => undefined],
  useCallback: (callback: unknown) => callback,
}));
import { useMutation } from "@/lib/client/api";

const response = (status: number) => Response.json(status === 200 ? { data: { saved: true } } : {
  error: { code: status === 500 ? "internal" : "unauthenticated", message: status === 401 ? "Sign in to continue." : "Try again." }, requestId: `r${status}`,
}, { status });
afterEach(() => vi.unstubAllGlobals());

describe("mutation retry operation keys", () => {
  it("keeps an unresolved save's key through a later authentication rejection and rotates only after confirmation", async () => {
    const requests: string[] = [];
    const statuses = [500, 401, 200, 200];
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => {
      requests.push(new Headers(init.headers).get("idempotency-key")!);
      return response(statuses.shift()!);
    }));
    const mutation = useMutation("/api/v1/children");
    const results = [];
    for (let attempt = 0; attempt < 4; attempt++) results.push(await mutation.run({ displayName: "Synthetic Child" }));
    expect(results[1]).toMatchObject({
      ok: false, status: 401, code: "unauthenticated", requestId: "r401", unknown: true,
      message: expect.stringContaining("An earlier attempt is still unconfirmed."),
    });
    expect(results[1]).toMatchObject({ message: expect.stringContaining("Sign in to continue.") });
    expect(requests[1]).toBe(requests[0]);
    expect(requests[2]).toBe(requests[0]);
    expect(requests[3]).not.toBe(requests[0]);
  });

  it("resetting form feedback never discards an unresolved save's operation key", async () => {
    const requests: string[] = [];
    const statuses = [500, 401, 200];
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => {
      requests.push(new Headers(init.headers).get("idempotency-key")!);
      return response(statuses.shift()!);
    }));
    const mutation = useMutation("/api/v1/children");
    await mutation.run({});
    mutation.reset();
    await mutation.run({});
    await mutation.run({});
    expect(new Set(requests).size).toBe(1);
  });

  it("still rotates a rejected first attempt when no earlier save is unresolved", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_path: string, init: RequestInit) => {
      requests.push(new Headers(init.headers).get("idempotency-key")!);
      return response(requests.length === 1 ? 401 : 200);
    }));
    const mutation = useMutation("/api/v1/children");
    await mutation.run({});
    await mutation.run({});
    expect(requests[1]).not.toBe(requests[0]);
  });
});
