import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigError } from "@/lib/env";
import { checkReadiness } from "@/lib/health";

afterEach(() => {
  vi.useRealTimers();
});

const deps = (probe: () => Promise<unknown>, config: () => void = () => undefined) => ({ config, probe });

describe("readiness check (audit F14)", () => {
  it("is ready when configuration is valid and one database call answers", async () => {
    await expect(checkReadiness(deps(async () => []))).resolves.toEqual({ ready: true });
  });

  it("is not ready when the configuration is invalid, and never calls the database", async () => {
    const probe = vi.fn(async () => []);
    const result = await checkReadiness(deps(probe, () => { throw new ConfigError("CVSRS_PUBLIC_URL is required in production"); }));
    expect(result).toEqual({ ready: false, reason: "configuration" });
    expect(probe).not.toHaveBeenCalled();
  });

  it("is not ready when the database call fails", async () => {
    await expect(checkReadiness(deps(async () => { throw new Error("connect ECONNREFUSED"); }))).resolves.toEqual({ ready: false, reason: "database" });
  });

  it("gives up on a database that does not answer within the timeout", async () => {
    vi.useFakeTimers();
    const pending = checkReadiness(deps(() => new Promise(() => undefined)), 2000);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(pending).resolves.toEqual({ ready: false, reason: "database" });
  });
});

describe("GET /api/v1/health/ready", () => {
  it("answers 503 without internal detail when the service is not configured", async () => {
    vi.resetModules();
    vi.doMock("@/lib/env", async (original) => ({
      ...(await original<typeof import("@/lib/env")>()),
      getConfig: () => { throw new ConfigError("secret detail: CVSRS_LOCAL_DB_URL"); },
    }));
    const { GET } = await import("@/app/api/v1/health/ready/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ status: "unavailable" });
    expect(text).not.toContain("CVSRS");
    vi.doUnmock("@/lib/env");
  });
});

describe("readiness covers the production rate-limit store settings (I4-15)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("assertRateLimitStoreConfigured refuses missing or non-HTTPS store settings in production only", async () => {
    const { assertRateLimitStoreConfigured } = await import("@/lib/security/rate-limit");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "");
    vi.stubEnv("CVSRS_RATE_LIMIT_TOKEN", "");
    expect(() => assertRateLimitStoreConfigured()).not.toThrow();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => assertRateLimitStoreConfigured()).toThrow(/CVSRS_RATE_LIMIT_URL/);
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "http://redis.example.test/");
    vi.stubEnv("CVSRS_RATE_LIMIT_TOKEN", "t");
    expect(() => assertRateLimitStoreConfigured()).toThrow(/CVSRS_RATE_LIMIT_URL/);
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "https://redis.example.test/");
    expect(() => assertRateLimitStoreConfigured()).not.toThrow();
  });

  async function readyRoute(store: { url: string; token: string }, rpc: () => Promise<{ error: null | { code: string } }>) {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", store.url);
    vi.stubEnv("CVSRS_RATE_LIMIT_TOKEN", store.token);
    const createClient = vi.fn(() => ({ rpc: () => ({ abortSignal: () => rpc() }) }));
    vi.doMock("@supabase/supabase-js", () => ({ createClient }));
    vi.doMock("@/lib/env", async (original) => ({
      ...(await original<typeof import("@/lib/env")>()),
      getConfig: () => ({ mode: "supabase", supabaseUrl: "https://x.supabase.co", supabaseKey: "k", production: true }),
    }));
    const { GET } = await import("@/app/api/v1/health/ready/route");
    return { res: await GET(), createClient };
  }

  it("GET /api/v1/health/ready answers 503 in production without a rate-limit store, and never probes the database", async () => {
    try {
      const { res, createClient } = await readyRoute({ url: "", token: "" }, async () => ({ error: null }));
      expect(res.status).toBe(503);
      expect(createClient).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("@/lib/env");
      vi.doUnmock("@supabase/supabase-js");
    }
  });

  it("GET /api/v1/health/ready answers 200 in production once the store settings are valid and the database answers", async () => {
    try {
      const { res, createClient } = await readyRoute({ url: "https://redis.example.test/", token: "t" }, async () => ({ error: null }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ready" });
      expect(createClient).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock("@/lib/env");
      vi.doUnmock("@supabase/supabase-js");
    }
  });
});
