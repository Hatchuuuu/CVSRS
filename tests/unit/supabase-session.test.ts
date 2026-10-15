import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth, rpc: async () => ({ data: {}, error: null }) }) }));
import { createSupabaseClient } from "@/lib/db/supabase";
import { api } from "@/lib/api/handler";
import { resetRateLimits } from "@/lib/security/rate-limit";

afterEach(() => { vi.unstubAllEnvs(); resetRateLimits(); auth.getUser.mockReset(); });

describe("server session authentication failures", () => {
  it.each([0, 500, 503, undefined])("reports an Auth service failure (%s) as 503 through the API", async (status) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status } });
    const response = await api({}, async () => "unused")(new Request("https://app.example/api/session-test"));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatchObject({ code: "unavailable", retryable: true });
  });

  it("translates a thrown network error into a retryable outage", async () => {
    auth.getUser.mockRejectedValue(new TypeError("fetch failed"));
    const rpc = await createSupabaseClient("https://project.supabase.co", "key", "request");
    await expect(rpc.session()).rejects.toMatchObject({ code: "unavailable", status: 503, retryable: true });
  });

  it("preserves the Auth throttling response instead of treating the session as missing", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status: 429 } });
    const rpc = await createSupabaseClient("https://project.supabase.co", "key", "request");
    await expect(rpc.session()).rejects.toMatchObject({ code: "rate_limited", status: 429, retryable: true });
  });

  it.each([400, 401, 403])("returns no session for a missing or rejected token (%s)", async (status) => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { status } });
    const rpc = await createSupabaseClient("https://project.supabase.co", "key", "request");
    await expect(rpc.session()).resolves.toBeNull();
  });
});
