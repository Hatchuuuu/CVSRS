import { describe, expect, it, vi } from "vitest";
import { buildCsp } from "../../src/proxy";

describe("Content-Security-Policy", () => {
  it("production scripts need this request's nonce: no inline or eval", () => {
    const csp = buildCsp("abc123", true, "https://x.supabase.co");
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    const scripts = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scripts).not.toMatch(/unsafe-inline|unsafe-eval/);
    expect(csp).toContain("connect-src 'self' https://x.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/https?:\/\/(?!x\.supabase\.co)/); // no third-party origins
  });
  it("differs per request and keeps dev tooling only outside production", () => {
    expect(buildCsp("a", true)).not.toBe(buildCsp("b", true));
    expect(buildCsp("a", false)).toContain("'unsafe-eval'");
    expect(buildCsp("a", true)).not.toContain("'unsafe-eval'");
  });

  // docs/deployment.md §2/§4: missing production configuration fails closed with a generic 503; liveness keeps answering and
  // readiness reports the problem itself (I4-14: the proxy used to answer 500 everywhere, health checks included).
  async function productionProxy(path: string, env: Record<string, string>) {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "");
    if (env.CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS) vi.stubEnv("CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS", env.CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS);
    const { NextRequest } = await import("next/server");
    const { proxy } = await import("../../src/proxy");
    return proxy(new NextRequest(`http://localhost:3100${path}`));
  }

  it("fails closed with a generic 503 in production when Supabase credentials are missing", async () => {
    try {
      const res = await productionProxy("/", {});
      expect(res.status).toBe(503);
      const body = await res.text();
      expect(body).toBe("Service unavailable");
      expect(body).not.toMatch(/SUPABASE|config/i);
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed with 503 when a present setting is invalid", async () => {
    try {
      const res = await productionProxy("/children", { NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "k".repeat(40), CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS: "nonsense" });
      expect(res.status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("lets both health endpoints through to their own handlers, even when configuration is missing", async () => {
    try {
      for (const path of ["/api/v1/health", "/api/v1/health/ready"]) {
        const res = await productionProxy(path, {});
        expect(res.status, path).toBe(200);
        expect(res.headers.get("x-middleware-next"), path).toBe("1");
      }
      // Only those exact paths.
      expect((await productionProxy("/api/v1/health/readyx", {})).status).toBe(503);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
