import { beforeEach, describe, expect, it, vi } from "vitest";

// Real @supabase/ssr and auth-js; only the network and the Next cookie jar are simulated (promoted from the SEC-02 reproduction).
const state = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  sets: [] as { name: string; value: string; options?: Record<string, unknown> }[],
  remove: vi.fn(),
  config: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...state.jar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string, options?: Record<string, unknown>) => {
    state.sets.push({ name, value, options });
    if (options?.maxAge === 0 || value === "") state.jar.delete(name); else state.jar.set(name, value);
  },
  delete: (name: string) => { state.remove(name); state.jar.delete(name); },
}) }));
vi.mock("@/lib/env", () => ({ getConfig: state.config }));
vi.mock("@/lib/security/origin", () => ({ isSameOrigin: (req: Request) => req.headers.get("origin") === "http://127.0.0.1:3000" }));
import { POST } from "@/app/auth/sign-out/route";
import { SIGN_OUT_TIMEOUT_MS } from "@/lib/auth/cookies";

const ORIGIN = "http://127.0.0.1:3000";
const signOut = () => POST(new Request("http://localhost:3000/auth/sign-out", { method: "POST", headers: { origin: ORIGIN } }));
const supabase = { mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "sb_publishable_xxxxxxxxxxxxxxxxxxxx" };

function seedSession(expired: boolean) {
  const session = {
    access_token: `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600), sub: "u" })).toString("base64url")}.sig`,
    refresh_token: "refresh-token-value", token_type: "bearer", expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600),
    user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  };
  const encoded = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  // A large session is split into numbered chunks by @supabase/ssr; a PKCE verifier may also remain from a pending link.
  state.jar.set("sb-project-auth-token.0", encoded.slice(0, 40));
  state.jar.set("sb-project-auth-token.1", encoded.slice(40));
  state.jar.set("sb-project-auth-token-code-verifier", "verifier");
  state.jar.set("theme", "dark");
}
const expiredAuthCookies = () => state.sets.filter((s) => s.name.startsWith("sb-") && s.options?.maxAge === 0).map((s) => s.name);

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  state.jar.clear();
  state.sets.length = 0;
  state.config.mockReturnValue(supabase);
});

describe("sign-out boundaries", () => {
  it("on a copy whose configuration is broken, still clears this device's auth cookies and says revocation is unconfirmed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    state.config.mockImplementation(() => { throw new Error("Service is not configured"); });
    seedSession(false);
    const response = await signOut();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/auth/signed-out");
    expect([...state.jar.keys()]).toEqual(["theme"]);
  });
  it("never signs out a session on a foreign-origin request", async () => {
    const response = await POST(new Request("http://localhost:3000/auth/sign-out", { method: "POST", headers: { origin: "https://foreign.example" } }));
    expect(response.status).toBe(403);
    expect(state.remove).not.toHaveBeenCalled();
  });
});

describe("Supabase sign-out", () => {
  it("with Auth unreachable and an expired access token, clears every auth cookie within the timeout and reports incomplete revocation", async () => {
    state.config.mockReturnValue(supabase);
    seedSession(true);
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const started = Date.now();
    const response = await signOut();
    expect(Date.now() - started).toBeLessThan(SIGN_OUT_TIMEOUT_MS + 1_000);
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/auth/signed-out");
    expect(new Set(expiredAuthCookies())).toEqual(new Set(["sb-project-auth-token.0", "sb-project-auth-token.1", "sb-project-auth-token-code-verifier"]));
    expect([...state.jar.keys()]).toEqual(["theme"]);
    for (const s of state.sets) expect(s.options).toMatchObject({ path: "/", sameSite: "lax", maxAge: 0 });
  }, 15_000);

  it("does not wait for an Auth request that never answers", async () => {
    state.config.mockReturnValue(supabase);
    seedSession(false);
    vi.stubGlobal("fetch", (_input: unknown, init?: RequestInit) => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
    const started = Date.now();
    const response = await signOut();
    expect(Date.now() - started).toBeLessThan(SIGN_OUT_TIMEOUT_MS + 1_000);
    expect(response.headers.get("location")).toBe("/auth/signed-out");
    expect([...state.jar.keys()]).toEqual(["theme"]);
  }, 15_000);

  it("returns to the landing page when Auth confirms the sessions were ended", async () => {
    state.config.mockReturnValue(supabase);
    seedSession(false);
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => { calls.push(String(input)); return new Response(null, { status: 204 }); });
    const response = await signOut();
    expect(calls.some((url) => url.includes("/auth/v1/logout"))).toBe(true);
    expect(response.headers.get("location")).toBe("/");
    expect([...state.jar.keys()]).toEqual(["theme"]);
  });

  it("still clears auth cookies and reports incomplete revocation when configuration cannot be read", async () => {
    state.config.mockImplementation(() => { throw new Error("not configured"); });
    seedSession(false);
    const response = await signOut();
    expect(response.headers.get("location")).toBe("/auth/signed-out");
    expect([...state.jar.keys()]).toEqual(["theme"]);
  });
});
