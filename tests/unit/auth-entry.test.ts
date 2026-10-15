import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  config: vi.fn(), set: vi.fn(), get: vi.fn(),
  signIn: vi.fn(), signUp: vi.fn(), rpc: vi.fn(),
}));
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), getConfig: state.config }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], get: state.get, set: state.set }) }));
// The sign-up route reads the public clinic directory to validate a staff application.
vi.mock("@/lib/db", () => ({ getRpcClient: async () => ({ session: async () => null, rpc: state.rpc }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { signInWithPassword: state.signIn, signUp: state.signUp } }) }));

import { POST as signIn } from "@/app/auth/sign-in/route";
import { POST as signUp } from "@/app/auth/sign-up/route";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal";

const userId = "11111111-1111-4111-8111-111111111111";
const clinicId = "22222222-2222-4222-8222-222222222222";
// A sign-up body carries the current terms agreement, as the form sends it, unless the test overrides termsVersion.
const withTerms = (path: string, body: unknown) =>
  path === "/auth/sign-up" && body && typeof body === "object" && !Array.isArray(body) ? { termsVersion: LEGAL_VERSION, ...body } : body;
const request = (path: string, body: unknown) => new Request(`http://localhost:3000${path}`, {
  method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(withTerms(path, body)),
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
  state.signIn.mockResolvedValue({ data: { user: null }, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } });
});

describe("password sign-in (Supabase Auth is the only identity source)", () => {
  it("answers 503 with a safe message, and starts no session, when this copy is not connected to the sign-in service", async () => {
    const { ConfigError } = await import("@/lib/env");
    state.config.mockImplementation(() => { throw new ConfigError("Service is not configured: set NEXT_PUBLIC_SUPABASE_URL", "unconfigured"); });
    const response = await signIn(request("/auth/sign-in", { email: "parent@example.com", password: "long-password" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("NEXT_PUBLIC");
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it.each([{ email: "parent@example.com" }, { email: "not-an-email", password: "long-password" }, { email: "parent@example.com", password: "" }])(
    "asks for an email address and password %j without calling Auth", async (body) => {
      expect((await signIn(request("/auth/sign-in", body))).status).toBe(400);
      expect(state.signIn).not.toHaveBeenCalled();
    },
  );

  it("gives one generic answer for a wrong password or an unknown address", async () => {
    const response = await signIn(request("/auth/sign-in", { email: "parent@example.com", password: "wrong-password-1" }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Invalid credentials. Please verify your email and password.");
  });

  it("reports a confirmation-policy mismatch without sending the user to an email link", async () => {
    state.signIn.mockResolvedValueOnce({ data: { user: null }, error: { status: 400, code: "email_not_confirmed", message: "Email not confirmed" } });
    const response = await signIn(request("/auth/sign-in", { email: "parent@example.com", password: "long-password" }));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/administrator/i);
  });

  it.each([
    [{ status: 429, code: "over_request_rate_limit", message: "rate limit" }, 429, /too many attempts/i],
    [{ status: 500, code: "unexpected_failure", message: "db down" }, 503, /temporarily unavailable/i],
    [{ status: 0, message: "fetch failed" }, 503, /temporarily unavailable/i],
  ])("does not call an Auth service failure %j a wrong password", async (error, status, message) => {
    state.signIn.mockResolvedValueOnce({ data: { user: null }, error });
    const response = await signIn(request("/auth/sign-in", { email: "parent@example.com", password: "long-password" }));
    expect(response.status).toBe(status);
    const body = await response.json();
    expect(body.error).toMatch(message);
    expect(body.error).not.toMatch(/invalid credentials/i);
  });

  it("ignores persona selectors: an email alone never signs anyone in", async () => {
    const response = await signIn(request("/auth/sign-in", { email: "lead@demo.cvsrs.test", userId }));
    expect(response.status).toBe(400);
    expect(state.signIn).not.toHaveBeenCalled();
    expect(state.set).not.toHaveBeenCalled();
  });
});

describe("authentication input and throttling", () => {
  it.each([null, [], "email", { email: {} }])("rejects nonobject or nonstring credentials %j", async (body) => {
    expect((await signIn(request("/auth/sign-in", body))).status).toBe(400);
    expect(state.set).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const req = new Request("http://localhost:3000/auth/sign-in", { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: "{" });
    expect((await signIn(req)).status).toBe(400);
    expect(state.set).not.toHaveBeenCalled();
  });

  it("bounds authentication payloads before parsing or selecting users", async () => {
    expect((await signIn(request("/auth/sign-in", { email: "x".repeat(20_000) }))).status).toBe(413);
    expect(state.signIn).not.toHaveBeenCalled();
  });

  it("rate limits repeated authentication attempts", async () => {
    let response: Response | undefined;
    for (let i = 0; i < 31; i++) response = await signIn(request("/auth/sign-in", { email: "unknown@example.com", password: "wrong-password-1" }));
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(state.set).not.toHaveBeenCalled();
  });

  it("retains Supabase password authentication", async () => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    state.signIn.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    const response = await signIn(request("/auth/sign-in", { email: "real@example.com", password: "password" }));
    expect(response.status).toBe(200);
    expect(state.signIn).toHaveBeenCalledWith({ email: "real@example.com", password: "password" });
  });

  it("does not claim success without an immediate session or return raw provider errors", async () => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    state.signUp.mockResolvedValueOnce({ data: { session: null }, error: null })
      .mockResolvedValueOnce({ data: {}, error: { status: 422, message: "provider internal secret" } });
    const verified = await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent" }));
    expect(verified.status).toBe(503);
    expect((await verified.json()).error).toMatch(/administrator/i);
    const failed = await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent" }));
    expect(failed.status).toBe(400);
    expect(JSON.stringify(await failed.json())).not.toContain("internal secret");
  });

  it("makes one Auth call per sign-up, and reports an Auth rate limit as such", async () => {
    state.signUp.mockResolvedValueOnce({ data: { user: { id: userId }, session: { access_token: "x" } }, error: null });
    const ok = await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent" }));
    expect(await ok.json()).toEqual({ ok: true, redirect: "/children" });
    expect(state.signIn).not.toHaveBeenCalled();
    expect(state.signUp.mock.calls[0]?.[0].options).not.toHaveProperty("emailRedirectTo");
    state.signUp.mockResolvedValueOnce({ data: {}, error: { status: 429, code: "over_email_send_rate_limit", message: "x" } });
    const limited = await signUp(request("/auth/sign-up", { email: "other@example.com", password: "long-password", fullName: "Real Parent" }));
    expect(limited.status).toBe(429);
  });

  it("requires a name on the server, not only in the form", async () => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    const response = await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "   " }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/full name/i);
    expect(state.signUp).not.toHaveBeenCalled();
  });

  it("refuses a mobile number SMS could never reach, before creating the account; a usual one is accepted", async () => {
    const refused = await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent", phone: "12345" }));
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/0917 123 4567/);
    expect(state.signUp).not.toHaveBeenCalled();
    state.signUp.mockResolvedValueOnce({ data: { session: { access_token: "x" } }, error: null });
    await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent", phone: "0917-123-4567" }));
    expect(state.signUp).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "2020-01-01"])("refuses a sign-up whose terms agreement is %s before creating the account", async (termsVersion) => {
    const response = await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent", termsVersion }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Terms of Use/);
    expect(state.signUp).not.toHaveBeenCalled();
  });

  it("records the accepted terms version on the new account", async () => {
    state.signUp.mockResolvedValueOnce({ data: { session: { access_token: "x" } }, error: null });
    await signUp(request("/auth/sign-up", { email: "real@example.com", password: "long-password", fullName: "Real Parent" }));
    expect(state.signUp.mock.calls[0]?.[0].options.data).toMatchObject({ terms_version: LEGAL_VERSION });
  });

  it("creates a staff account carrying its application and opens the clinic workspace immediately", async () => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    state.rpc.mockResolvedValue([{ id: clinicId, name: "Clinic" }]);
    state.signUp.mockResolvedValueOnce({ data: { session: { access_token: "x" } }, error: null });
    const response = await signUp(request("/auth/sign-up", {
      email: "nurse@example.com", password: "long-password", fullName: "Nurse Reyes", next: "/clinic",
      clinicId, role: "clinical_staff", positionTitle: "Midwife", note: "",
    }));
    expect(await response.json()).toEqual({ ok: true, redirect: "/clinic" });
    expect(state.rpc).toHaveBeenCalledWith("list_public_clinics");
    expect(state.signUp).toHaveBeenCalledWith(expect.objectContaining({
      options: expect.objectContaining({
        data: expect.objectContaining({ staff_application: { clinic_id: clinicId, role: "clinical_staff", position_title: "Midwife", note: null } }),
      }),
    }));
  });

  it.each([
    [{ role: "clinical_staff" }, /health center/i],
    [{ clinicId: "not-a-uuid", role: "clinical_staff" }, /health center/i],
    [{ clinicId, role: "superuser" }, /role/i],
    [{ clinicId, role: "assistant", positionTitle: "x".repeat(81) }, /80 characters/i],
  ])("refuses a staff sign-up with an invalid application %j before creating the account", async (application, message) => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    const response = await signUp(request("/auth/sign-up", { email: "nurse@example.com", password: "long-password", fullName: "Nurse Reyes", next: "/clinic", ...application }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(message);
    expect(state.signUp).not.toHaveBeenCalled();
  });

  it("refuses a staff application to a health center that is not in the public directory", async () => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    state.rpc.mockResolvedValue([{ id: "99999999-9999-4999-8999-999999999999", name: "Other" }]);
    const response = await signUp(request("/auth/sign-up", { email: "nurse@example.com", password: "long-password", fullName: "Nurse Reyes", next: "/clinic", clinicId, role: "assistant" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/from the list/i);
    expect(state.signUp).not.toHaveBeenCalled();
  });

  it("a family sign-up carries no staff application", async () => {
    state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
    state.signUp.mockResolvedValueOnce({ data: { session: { access_token: "x" } }, error: null });
    await signUp(request("/auth/sign-up", { email: "parent@example.com", password: "long-password", fullName: "Parent", clinicId, role: "tech_admin" }));
    expect(JSON.stringify(state.signUp.mock.calls[0]?.[0])).not.toContain("staff_application");
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it.each([["/clinic", "/clinic"], [undefined, "/children"], ["/children", "/children"], ["//evil.example", "/children"], ["/account/reset-password", "/children"]])(
    "sends a password sign-in with next=%s to %s",
    async (next, destination) => {
      state.config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://project.supabase.co", supabaseKey: "public-key" });
      state.signIn.mockResolvedValueOnce({ data: { user: { id: userId } }, error: null });
      const response = await signIn(request("/auth/sign-in", { email: "nurse@example.com", password: "long-password", ...(next ? { next } : {}) }));
      expect(await response.json()).toEqual({ ok: true, redirect: destination });
    },
  );
});
