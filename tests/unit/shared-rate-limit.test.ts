import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientAddress, hit, limitRequest, MEMORY_BUCKET_CAP, memoryBucketCount, requestLimitKey, resetRateLimits, routePattern } from "@/lib/security/rate-limit";

const productionStore = () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip");
  vi.stubEnv("CVSRS_RATE_LIMIT_URL", "https://redis.example");
  vi.stubEnv("CVSRS_RATE_LIMIT_TOKEN", "store-token");
};
const failingStore = () => vi.stubGlobal("fetch", async () => Response.json({ error: "unavailable" }, { status: 500 }));
const openCircuit = async () => {
  for (let i = 0; i < 5; i++) await expect(limitRequest(`warm-${i}`, 10, 60000)).rejects.toMatchObject({ status: 503 });
};

beforeEach(() => resetRateLimits());
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetRateLimits(); });

describe("client identity for request limits", () => {
  it("does not trust caller supplied forwarded IP addresses unless a trusted header is configured", () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    const req = (ip: string) => new Request("https://app.example/api/v1/verify/token", { headers: { "x-forwarded-for": ip } });
    expect(clientAddress(req("1.2.3.4"))).toEqual({ key: "shared", shared: true });
    expect(clientAddress(req("4.3.2.1"))).toEqual({ key: "shared", shared: true });
  });
  it("gives two client addresses different keys once the ingress header is configured", () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip");
    const req = (ip: string) => new Request("https://app.example/api/v1/verify/token", { headers: { "x-client-ip": ip } });
    expect(requestLimitKey(req("1.2.3.4"))).not.toBe(requestLimitKey(req("4.3.2.1")));
    expect(clientAddress(req("1.2.3.4"))).toEqual({ key: "1.2.3.4", shared: false });
  });
  it("puts requests that bypass the ingress header into one strict bucket rather than treating them as unlimited", () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip");
    expect(clientAddress(new Request("https://app.example/"))).toEqual({ key: "missing-client-header", shared: false });
  });
  it("refuses to run in production without a trusted client-address source or the explicit shared-bucket opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET", "");
    expect(() => clientAddress(new Request("https://app.example/"))).toThrow(expect.objectContaining({ status: 503, message: "The service is not configured." }));
    vi.stubEnv("CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET", "1");
    expect(clientAddress(new Request("https://app.example/"))).toEqual({ key: "shared", shared: true });
  });
});

describe("client address normalization (RV2-A-01)", () => {
  const key = (value: string) => clientAddress(new Headers({ "x-client-ip": value })).key;
  beforeEach(() => vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip"));

  it("accepts exactly one IP literal and keys IPv4 by address", () => {
    expect(key("198.51.100.7")).toBe("198.51.100.7");
    expect(key(" 198.51.100.7 ")).toBe("198.51.100.7");
    expect(key("::ffff:198.51.100.7")).toBe("198.51.100.7");
  });
  it("keys IPv6 by its /64 prefix, whatever the spelling", () => {
    const k = key("2001:db8:0:1::5");
    expect(k).toBe(key("2001:db8:0:1:ffff:ffff:ffff:ffff"));
    expect(k).toBe(key("2001:DB8:0000:0001:0:0:0:9"));
    expect(k).not.toBe(key("2001:db8:0:2::5"));
    expect(k).not.toContain("::5");
  });
  it.each([
    ["a list from an appending forwarder", "1.1.1.1, 198.51.100.7"],
    ["a space-separated list", "1.1.1.1 198.51.100.7"],
    ["an IPv4 address with a port", "198.51.100.7:443"],
    ["a bracketed IPv6 address with a port", "[2001:db8::1]:443"],
    ["an IPv6 zone index", "fe80::1%eth0"],
    ["an out-of-range octet", "198.51.100.256"],
    ["a hostname", "client.example"],
    ["an obfuscation token", "unknown"],
  ])("treats %s as a missing client header, never as an identity", (_label, value) => {
    expect(clientAddress(new Headers({ "x-client-ip": value }))).toEqual({ key: "missing-client-header", shared: false });
  });
  it("two spoofed list prefixes no longer mint two identities", () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-forwarded-for");
    const k1 = clientAddress(new Headers({ "x-forwarded-for": "1.1.1.1, 198.51.100.7" })).key;
    const k2 = clientAddress(new Headers({ "x-forwarded-for": "2.2.2.2, 198.51.100.7" })).key;
    expect(k1).toBe(k2);
  });
});

describe("route scope (RV2-A-04)", () => {
  it("replaces route parameter values with their names, so a non-id segment cannot mint buckets", () => {
    const req = (name: string) => new Request(`https://app.example/api/v1/clinics/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/reports/${name}`);
    const params = (name: string) => ({ clinicId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name });
    expect(routePattern(req("x1"), params("x1"))).toBe("/api/v1/clinics/:clinicId/reports/:name");
    expect(routePattern(req("x%20y"), params("x y"))).toBe(routePattern(req("coverage"), params("coverage")));
    expect(routePattern(req("x1"))).toBe("/api/v1/clinics/:id/reports/x1"); // without parameters: ids only, as before
  });
});

describe("in-process limiter memory (RV2-A-04)", () => {
  it("never holds more than its cap of live buckets, evicting the oldest first", () => {
    const now = 1_000_000;
    for (let i = 0; i < MEMORY_BUCKET_CAP + 500; i++) hit(`flood-${i}`, 5, 60_000, now);
    expect(memoryBucketCount()).toBeLessThanOrEqual(MEMORY_BUCKET_CAP);
    // The newest key is still tracked; an evicted old one starts a fresh window.
    const newest = `flood-${MEMORY_BUCKET_CAP + 499}`;
    for (let i = 0; i < 4; i++) hit(newest, 5, 60_000, now);
    expect(hit(newest, 5, 60_000, now).ok).toBe(false);
  });
});

describe("production shared request limits", () => {
  it("fails closed when production has no shared store", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "");
    await expect(limitRequest("route", 10, 60000)).rejects.toMatchObject({ status: 503 });
  });
  it("interprets atomic store count and expiry without exposing identity in the key", async () => {
    productionStore();
    let command: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, options: RequestInit) => {
      command = JSON.parse(options.body as string);
      return Response.json({ result: [11, 45000] });
    });
    expect(await limitRequest("client-sensitive-route", 10, 60000)).toEqual({ ok: false, retryAfterSec: 45, count: 11 });
    expect(command[0]).toBe("EVAL");
    expect(JSON.stringify(command)).not.toContain("client-sensitive-route");
  });
  it("returns 503 for each of the first store failures, before the circuit opens", async () => {
    productionStore();
    failingStore();
    for (let i = 0; i < 4; i++) await expect(limitRequest("route", 10, 60000)).rejects.toMatchObject({ status: 503 });
    await expect(limitRequest("route", 10, 60000, { onStoreFailure: "closed" })).rejects.toMatchObject({ status: 503 });
  });
  it("with the circuit open, degrades by default to a halved per-process limit", async () => {
    productionStore();
    failingStore();
    await openCircuit();
    const degraded = await limitRequest("cb-route", 10, 60000);
    expect(degraded.ok).toBe(true);
    for (let i = 0; i < 4; i++) await limitRequest("cb-route", 10, 60000);
    expect((await limitRequest("cb-route", 10, 60000)).ok).toBe(false);
  });
  it("with the circuit open, keeps failing closed for scopes that opt into the closed policy", async () => {
    productionStore();
    failingStore();
    await openCircuit();
    await expect(limitRequest("auth/sign-in", 10, 60000, { onStoreFailure: "closed" })).rejects.toMatchObject({ status: 503 });
    expect((await limitRequest("authenticated-get", 10, 60000, { onStoreFailure: "degrade" })).ok).toBe(true);
  });
});
