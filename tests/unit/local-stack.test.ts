import { afterEach, describe, expect, it, vi } from "vitest";
import { assertImmediateSignup, assertLoopback, localCliOutput, localWebEnvironment, parseStatus } from "../../scripts/local-stack";

afterEach(() => vi.unstubAllGlobals());

it("omits CLI credential rows while preserving migration and service diagnostics", () => {
  const output = 'Applying migration 0049.sql\n{"SECRET_KEY":"private-test-value","DB_URL":"postgresql://owner:private-test-value@localhost/db"}\nSecret key: sb_secret_private\nJWT: eyJprivate.token.signature\nAPI URL: http://localhost:55321';
  expect(localCliOutput(output)).toBe("Applying migration 0049.sql\nAPI URL: http://localhost:55321");
});

it("local web runners use their request origin for certificate links even with hosted settings present", () => {
  const inherited = { NODE_ENV: "development" as const, CVSRS_PUBLIC_URL: "https://hosted.example.test", PATH: "local-tools" };
  expect(localWebEnvironment(inherited)).toMatchObject({ NODE_ENV: "development", CVSRS_PUBLIC_URL: "", PATH: "local-tools" });
  expect(inherited.CVSRS_PUBLIC_URL).toBe("https://hosted.example.test");
});

it("keeps privileged shell and dotenv credentials out of local web runtimes", () => {
  const keys = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SERVICE_ROLE_KEY", "CVSRS_SMS_WEBHOOK_DB_URL", "CVSRS_OWNER_DB_URL"];
  const inherited: NodeJS.ProcessEnv = { NODE_ENV: "development" };
  for (const key of keys) inherited[key] = "private-test-value";
  const local = localWebEnvironment(inherited);
  for (const key of keys) {
    expect(local[key], key).toBe("");
    expect(inherited[key]).toBe("private-test-value");
  }
});

it("checks the running Auth policy instead of trusting a changed config file", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ mailer_autoconfirm: false }))
    .mockResolvedValueOnce(Response.json({ mailer_autoconfirm: true }));
  vi.stubGlobal("fetch", fetch);
  const stack = { apiUrl: "http://127.0.0.1:54321", publishableKey: "public", dbUrl: "postgresql://localhost:54322/postgres" };
  await expect(assertImmediateSignup(stack)).rejects.toThrow(/restart/i);
  await expect(assertImmediateSignup(stack)).resolves.toBeUndefined();
  expect(fetch).toHaveBeenCalledWith(`${stack.apiUrl}/auth/v1/settings`, expect.objectContaining({ headers: { apikey: "public" } }));
});

describe("local Supabase stack status", () => {
  const base = { API_URL: "http://127.0.0.1:54321", DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres", STUDIO_URL: "http://127.0.0.1:54323" };

  it("reads the publishable key under either CLI name and never returns the service-role or secret key", () => {
    const current = parseStatus(JSON.stringify({ ...base, PUBLISHABLE_KEY: "sb_publishable_x", SECRET_KEY: "sb_secret_y", SERVICE_ROLE_KEY: "service", MAILPIT_URL: "http://127.0.0.1:54324" }));
    expect(current).toEqual({ apiUrl: base.API_URL, dbUrl: base.DB_URL, publishableKey: "sb_publishable_x", studioUrl: base.STUDIO_URL, inboxUrl: "http://127.0.0.1:54324" });
    expect(JSON.stringify(current)).not.toMatch(/secret|service/);
    const older = parseStatus(JSON.stringify({ ...base, ANON_KEY: "eyJ.anon", INBUCKET_URL: "http://127.0.0.1:54324" }));
    expect(older?.publishableKey).toBe("eyJ.anon");
  });

  it("returns null for output that is not a running stack", () => {
    expect(parseStatus("not json")).toBeNull();
    expect(parseStatus(JSON.stringify({ API_URL: base.API_URL }))).toBeNull();
  });

  it("refuses privileged local steps against anything but a loopback database", () => {
    expect(() => assertLoopback(base.DB_URL)).not.toThrow();
    expect(() => assertLoopback("postgresql://postgres@[::1]:54322/postgres")).not.toThrow();
    expect(() => assertLoopback("postgresql://postgres:pw@db.abcd.supabase.co:5432/postgres")).toThrow(/not the local stack/);
  });
});

describe("end-to-end stack configuration", () => {
  it("shares nothing with the development stack: own project id, ports and app origin", async () => {
    const { readFileSync } = await import("node:fs");
    const { e2eConfig } = await import("../../scripts/e2e-stack");
    const dev = readFileSync("supabase/config.toml", "utf8");
    const e2e = e2eConfig(dev);
    expect(e2e).toMatch(/^project_id = "cvsrs-e2e"$/m);
    for (const port of [54320, 54321, 54322, 54323, 54324, 54327, 54329, 8083]) expect(e2e).not.toMatch(new RegExp(`= ${port}$`, "m"));
    expect(e2e).toMatch(/^port = 55322$/m);
    expect(e2e).not.toContain("localhost:3000");
    expect(e2e).toContain('"http://localhost:3100/auth/callback?next=/children"');
    // The auth rules under test are the production ones.
    expect(e2e).toMatch(/^minimum_password_length = 12$/m);
    expect(e2e).toMatch(/\[auth\.mfa\.totp\]\nenroll_enabled = true\nverify_enabled = true/);
  });
});
