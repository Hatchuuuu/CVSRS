import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ signUp: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { signUp: state.signUp } }) }));
import { POST as signUp } from "@/app/auth/sign-up/route";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password-policy";
import { resetRateLimits } from "@/lib/security/rate-limit";
import { LEGAL_VERSION } from "@/lib/legal";

const request = (password: string) => new Request("http://localhost:3000/auth/sign-up", {
  method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json" },
  body: JSON.stringify({ email: "parent@example.org", password, fullName: "Parent", termsVersion: LEGAL_VERSION }),
});

beforeEach(() => {
  resetRateLimits();
  state.signUp.mockReset().mockResolvedValue({ data: { session: { access_token: "x" } }, error: null });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
});

describe("shared password policy (FE-19)", () => {
  it("requires at least 12 characters and states the rule in the hint", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(12);
    expect(PASSWORD_HINT).toContain("12");
    expect(passwordProblem("a".repeat(11))).toMatch(/12/);
    expect(passwordProblem("a".repeat(12))).toBeNull();
    expect(passwordProblem("a".repeat(73))).not.toBeNull();
    expect(passwordProblem("é".repeat(37))).not.toBeNull(); // 74 UTF-8 bytes: over the Auth hashing limit
  });
  it("is enforced by the server sign-up route, not only by the form", async () => {
    const short = await signUp(request("elevenchars"));
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatch(/12/);
    expect(state.signUp).not.toHaveBeenCalled();
    expect((await signUp(request("twelve chars"))).status).toBe(200);
    expect(state.signUp).toHaveBeenCalledTimes(1);
  });
});
