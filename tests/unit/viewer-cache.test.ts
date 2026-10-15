import { describe, expect, it, vi } from "vitest";

// React's `cache` only memoizes inside a server-component request. Here a single memo stands in for one request scope,
// so the test proves getViewer is wrapped (one Auth lookup and one get_my_context per request) without a React server.
const calls = vi.hoisted(() => ({ client: 0, session: 0, context: 0 }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      let memo: { value: R } | undefined;
      return (...args: A) => (memo ??= { value: fn(...args) }).value;
    },
  };
});
vi.mock("@/lib/env", () => ({ getConfig: () => ({ mode: "supabase" }), ConfigError: class extends Error {} }));
vi.mock("@/lib/db", () => ({
  getRpcClient: async () => {
    calls.client++;
    return {
      session: async () => (calls.session++, { userId: "user" }),
      rpc: async () => (calls.context++, { status: "active", mfa: true, memberships: [{ clinicId: "clinic", status: "active", validUntil: null, capabilities: [] }] }),
    };
  },
}));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { getViewer, requireClinicStaff, requireViewer } from "@/lib/server/viewer";

describe("viewer lookup per request", () => {
  it("does one Auth lookup and one context read however many layouts and pages ask", async () => {
    // Root layout, clinic layout and page each ask for the viewer during one request.
    const [a, b] = await Promise.all([getViewer(), requireViewer()]);
    await requireClinicStaff("clinic");
    expect(a).toBe(b);
    expect(calls).toEqual({ client: 1, session: 1, context: 1 });
  });
});
