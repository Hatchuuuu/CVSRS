import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Real @supabase/ssr sign-in path (promoted from the SEC-03 cookie-flags reproduction); only the network and cookie jar are simulated.
const sets = vi.hoisted(() => [] as { name: string; value: string; options?: Record<string, unknown> }[]);
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: (name: string, value: string, options?: Record<string, unknown>) => sets.push({ name, value, options }) }) }));
import { POST as signIn } from "@/app/auth/sign-in/route";
import { isSupabaseAuthCookie, serverSessionCookiePolicy, sessionCookieOptions } from "@/lib/auth/cookies";
import { parseSessionCookieMaxAge, parseStaffIdleMinutes } from "@/lib/auth/session-policy";
import { ConfigError, getConfig } from "@/lib/env";
import { resetRateLimits } from "@/lib/security/rate-limit";

beforeEach(() => { sets.length = 0; resetRateLimits(); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetRateLimits(); });

describe("session cookie policy", () => {
  it("overrides the SDK's 400-day default with the configured lifetime and production attributes", () => {
    const options = sessionCookieOptions({ path: "/", sameSite: "lax", httpOnly: false, maxAge: 400 * 24 * 60 * 60 }, { secure: true, maxAgeSeconds: 43_200 });
    expect(options).toEqual({ path: "/", sameSite: "lax", secure: true, httpOnly: false, maxAge: 43_200 });
  });
  it("keeps removals as removals and drops any domain so cookies stay host-only", () => {
    expect(sessionCookieOptions({ maxAge: 0, domain: ".example.org" }, { secure: false, maxAgeSeconds: 43_200 })).toEqual({ path: "/", sameSite: "lax", secure: false, httpOnly: false, maxAge: 0 });
  });
  it("writes browser-session cookies when no lifetime is given (browser-side refreshes)", () => {
    expect(sessionCookieOptions({ maxAge: 34_560_000 }, { secure: true, maxAgeSeconds: null })).not.toHaveProperty("maxAge");
  });
  it("defaults to twelve hours and validates the configured range", () => {
    expect(parseSessionCookieMaxAge(undefined)).toBe(43_200);
    expect(parseSessionCookieMaxAge("")).toBe(43_200);
    expect(parseSessionCookieMaxAge("28800")).toBe(28_800);
    for (const bad of ["60", "2592001", "12h", "-1", "1.5"]) expect(() => parseSessionCookieMaxAge(bad)).toThrow(RangeError);
    expect(serverSessionCookiePolicy({ NODE_ENV: "production" })).toEqual({ secure: true, maxAgeSeconds: 43_200 });
    expect(serverSessionCookiePolicy({ NODE_ENV: "development" }).secure).toBe(false);
  });
  it("validates the staff idle period (0 disables)", () => {
    expect(parseStaffIdleMinutes(undefined)).toBe(15);
    expect(parseStaffIdleMinutes("0")).toBe(0);
    expect(parseStaffIdleMinutes("30")).toBe(30);
    for (const bad of ["1", "721", "abc", "-5"]) expect(() => parseStaffIdleMinutes(bad)).toThrow(RangeError);
  });
  it("rejects invalid session settings as configuration errors", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
    vi.stubEnv("CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS", "forever");
    expect(() => getConfig()).toThrow(ConfigError);
    vi.stubEnv("CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS", "");
    vi.stubEnv("NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES", "never");
    expect(() => getConfig()).toThrow(ConfigError);
  });
  it("recognizes every Supabase auth cookie and nothing else", () => {
    for (const name of ["sb-project-auth-token", "sb-project-auth-token.0", "sb-project-auth-token.12", "sb-project-auth-token-code-verifier"]) expect(isSupabaseAuthCookie(name)).toBe(true);
    for (const name of ["theme", "cvsrs_dev_user", "sb-project-other", "xsb-project-auth-token"]) expect(isSupabaseAuthCookie(name)).toBe(false);
  });
});

describe("production sign-in Set-Cookie", () => {
  it("is Secure, SameSite=Lax, Path=/ and bounded by the configured Max-Age", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_PUBLIC_URL", "https://app.example");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip");
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "https://redis.example");
    vi.stubEnv("CVSRS_RATE_LIMIT_TOKEN", "store-token");
    vi.stubEnv("CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS", "28800");
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const jwt = `e30.${Buffer.from(JSON.stringify({ exp, sub: "u", aal: "aal1" })).toString("base64url")}.sig`;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => String(input).startsWith("https://redis.example")
      ? Response.json({ result: [1, 60_000] })
      : Response.json({ access_token: jwt, refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: exp,
        user: { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }));
    const res = await signIn(new Request("https://app.example/auth/sign-in", {
      method: "POST", headers: { origin: "https://app.example", "content-type": "application/json", "x-client-ip": "198.51.100.7" },
      body: JSON.stringify({ email: "staff@clinic.example", password: "correct horse battery" }),
    }));
    expect(res.status).toBe(200);
    expect(sets.length).toBeGreaterThan(0);
    for (const s of sets) {
      const header = (() => { const r = NextResponse.next(); r.cookies.set(s.name, s.value, s.options); return r.headers.get("set-cookie") ?? ""; })();
      expect(header).toMatch(/;\s*Secure/i);
      expect(header).toMatch(/;\s*SameSite=Lax/i);
      expect(header).toMatch(/;\s*Path=\/(;|$)/i);
      expect(header).toMatch(/;\s*Max-Age=28800/i);
      expect(header).not.toMatch(/Domain=/i);
    }
  });
});
