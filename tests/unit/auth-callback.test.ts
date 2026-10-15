import { beforeEach, describe, expect, it, vi } from "vitest";

const { exchange, setCookie, config } = vi.hoisted(() => ({ exchange: vi.fn(), setCookie: vi.fn(), config: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { exchangeCodeForSession: exchange } }) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: setCookie }) }));
vi.mock("@/lib/env", () => ({
  ConfigError: class ConfigError extends Error {},
  canonicalPublicUrl: (value: string) => new URL(value).origin,
  getConfig: config,
}));

import { GET } from "@/app/auth/callback/route";

describe("PKCE callback", () => {
  beforeEach(() => {
    exchange.mockReset();
    setCookie.mockReset();
    config.mockReturnValue({ mode: "supabase", production: false, supabaseUrl: "https://example.supabase.co", supabaseKey: "public-key" });
  });

  it("rejects missing codes without calling Auth", async () => {
    const response = await GET(new Request("https://app.example/auth/callback?next=/children"));
    expect(response.headers.get("location")).toBe("https://app.example/sign-in?auth=link-error");
    expect(exchange).not.toHaveBeenCalled();
  });

  it("exchanges the code and permits the password reset destination", async () => {
    exchange.mockResolvedValue({ error: null });
    const response = await GET(new Request("https://app.example/auth/callback?code=one-use&next=/account/reset-password"));
    expect(exchange).toHaveBeenCalledWith("one-use");
    expect(response.headers.get("location")).toBe("https://app.example/account/reset-password");
  });

  it("rejects open redirects and masks exchange errors", async () => {
    exchange.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "provider secret" } });
    const unsafe = await GET(new Request("https://app.example/auth/callback?code=one-use&next=https://evil.example"));
    expect(unsafe.headers.get("location")).toBe("https://app.example/children");
    const failed = await GET(new Request("https://app.example/auth/callback?code=other&next=/account/reset-password"));
    expect(failed.headers.get("location")).toBe("https://app.example/sign-in?auth=link-error");
  });
});
