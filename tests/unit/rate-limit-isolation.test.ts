import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Promoted from the SEC-01 reproduction (.local/audit-scratch/security/global-bucket.unit.ts) with inverted expectations:
// one client, clinic or user must never exhaust another's limit.
const state = vi.hoisted(() => ({ rpcCalls: 0, getRpcClient: vi.fn(), credentialsValid: false }));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [], set: () => undefined }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      signInWithPassword: async () => (state.credentialsValid
        ? { data: { user: { id: "11111111-1111-4111-8111-111111111111" } }, error: null }
        : { data: { user: null }, error: { status: 400, code: "invalid_credentials", message: "Invalid login credentials" } })
    }
  })
}));
vi.mock("@/lib/db", () => ({ getRpcClient: state.getRpcClient }));
vi.mock("pg", () => ({
  default: {
    Client: class {
      async connect() { return undefined; }
      async query() { return { rows: [{ applied: true }] }; }
      async end() { return undefined; }
    }
  }
}));

import { POST as signIn } from "@/app/auth/sign-in/route";
import { GET as display } from "@/app/api/v1/clinics/[clinicId]/queue/display/route";
import { GET as report } from "@/app/api/v1/clinics/[clinicId]/reports/[name]/route";
import { POST as callNext } from "@/app/api/v1/clinics/[clinicId]/queue/call-next/route";
import { POST as smsWebhook } from "@/app/api/v1/webhooks/sms/route";
import { api } from "@/lib/api/handler";
import { AUTH_LIMITS } from "@/lib/auth/request";
import { ConfigError, getConfig } from "@/lib/env";
import { limitRequest, resetRateLimits } from "@/lib/security/rate-limit";

const ORIGIN = "http://localhost:3000";
const clinicA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const clinicB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

const signInReq = (ip: string, email = "nurse@clinic.example", origin = ORIGIN) => new Request(`${origin}/auth/sign-in`, {
  method: "POST", headers: { origin, "content-type": "application/json", "x-client-ip": ip }, body: JSON.stringify({ email, password: "wrong-password" }),
});
const displayReq = (clinic: string, ip: string) => display(new Request(`${ORIGIN}/api/v1/clinics/${clinic}/queue/display`, { headers: { "x-client-ip": ip } }), { params: Promise.resolve({ clinicId: clinic }) });
const callNextReq = (clinic: string, ip: string) => callNext(new Request(`${ORIGIN}/api/v1/clinics/${clinic}/queue/call-next`, {
  method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "idempotency-key": crypto.randomUUID(), "x-client-ip": ip }, body: JSON.stringify({ station: "Table 1" }),
}), { params: Promise.resolve({ clinicId: clinic }) });

const authedRoute = api({ rate: { limit: 5, windowMs: 60_000 } }, async ({ session }) => ({ user: session?.userId }));
async function authedGet(user: string | null, ip: string) {
  state.getRpcClient.mockImplementationOnce(async () => ({
    session: async () => (user ? { userId: user, email: null } : null),
    rpc: async () => null,
  }));
  return authedRoute(new Request(`${ORIGIN}/api/v1/me/thing`, { headers: { "x-client-ip": ip } }));
}

beforeEach(() => {
  resetRateLimits();
  state.rpcCalls = 0;
  state.credentialsValid = false;
  state.getRpcClient.mockReset().mockImplementation(async () => ({
    session: async () => null,
    rpc: async () => { state.rpcCalls++; return { ok: true }; },
  }));
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
  vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-client-ip");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); resetRateLimits(); });

describe("sign-in throttling is per client address and account", () => {
  it("31 failed sign-ins from client X do not change client Y's outcome, even for the same account", async () => {
    for (let i = 0; i < 31; i++) await signIn(signInReq("203.0.113.66"));
    expect((await signIn(signInReq("203.0.113.66"))).status).toBe(429);
    const victim = await signIn(signInReq("198.51.100.7"));
    expect(victim.status).toBe(401);
  });
  it("throttles one client guessing many accounts without blocking anyone else", async () => {
    let last = 0;
    for (let i = 0; i < 101; i++) last = (await signIn(signInReq("203.0.113.66", `user${i}@clinic.example`))).status;
    expect(last).toBe(429);
    expect((await signIn(signInReq("198.51.100.7", "user1@clinic.example"))).status).toBe(401);
  });
  it("without a trusted address source, one account's lockout does not affect other accounts", async () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    for (let i = 0; i < 31; i++) await signIn(signInReq("203.0.113.66", "target@clinic.example"));
    expect((await signIn(signInReq("198.51.100.7", "target@clinic.example"))).status).toBe(429);
    expect((await signIn(signInReq("198.51.100.7", "other@clinic.example"))).status).toBe(401);
  });
});

describe("sign-in cannot be denied to everyone by a few addresses (RV2-A-01)", () => {
  // The two flood tests make about 1,000 sequential sign-in calls (under 1 s alone). They assert counts, not speed, so a loaded
  // machine (a browser run alongside) must not fail them on vitest's default 5 s timeout.
  const FLOOD_TIMEOUT_MS = 30_000;
  const { address, global } = AUTH_LIMITS["sign-in"];
  it("one IPv6 host rotating through its /64 is throttled as one client", async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= address; i++) statuses.push((await signIn(signInReq(`2001:db8:0:1::${(i % 64).toString(16)}`, `guess${i}@clinic.example`))).status);
    expect(statuses.slice(0, address).every((s) => s === 401)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await signIn(signInReq("2001:db8:0:1:abcd::1", "another@clinic.example"))).status).toBe(429);
    expect((await signIn(signInReq("2001:db8:0:2::1", "another@clinic.example"))).status).toBe(401);
  });
  it(`${global / address} IPv4 addresses x ${address} failed attempts do not produce 429 for a fresh client`, async () => {
    for (let a = 0; a < global / address; a++) for (let i = 0; i < address; i++) await signIn(signInReq(`192.0.2.${a + 1}`, `x${a}-${i}@clinic.example`));
    expect((await signIn(signInReq("198.51.100.7", "nurse@clinic.example"))).status).toBe(401);
  }, FLOOD_TIMEOUT_MS);
  it("during a distributed flood, addresses that keep failing are throttled harder while fresh clients still get through", async () => {
    for (let a = 0; a < global / address; a++) for (let i = 0; i < address; i++) await signIn(signInReq(`192.0.2.${a + 1}`, `x${a}-${i}@clinic.example`));
    let last = 0;
    for (let i = 0; i <= AUTH_LIMITS["sign-in"].addressUnderAttack; i++) last = (await signIn(signInReq("203.0.113.5", `y${i}@clinic.example`))).status;
    expect(last).toBe(429);
    expect((await signIn(signInReq("198.51.100.7", "nurse@clinic.example"))).status).toBe(401);
  }, FLOOD_TIMEOUT_MS);
  it("successful sign-ins never use up the address allowance (staff sharing one clinic address)", async () => {
    state.credentialsValid = true;
    for (let i = 0; i < address + 20; i++) expect((await signIn(signInReq("203.0.113.80", `staff${i}@clinic.example`))).status).toBe(200);
    state.credentialsValid = false;
    expect((await signIn(signInReq("203.0.113.80", "typo@clinic.example"))).status).toBe(401);
  });
  it("still limits guesses against one account from one client", async () => {
    let last = 0;
    for (let i = 0; i <= AUTH_LIMITS["sign-in"].account; i++) last = (await signIn(signInReq("203.0.113.81", "target@clinic.example"))).status;
    expect(last).toBe(429);
  });
});

describe("waiting-room displays are limited per clinic and client", () => {
  it("one clinic's screens never exhaust another clinic's display limit", async () => {
    for (let i = 0; i < 150; i++) await displayReq(clinicA, "10.0.0.1");
    expect((await displayReq(clinicA, "10.0.0.1")).status).toBe(429);
    expect((await displayReq(clinicB, "10.9.9.9")).status).toBe(200);
    expect((await displayReq(clinicB, "10.0.0.1")).status).toBe(200);
  });
  it("fifty clinics each polling every five seconds for a minute stay below the limit, even without a trusted address source", async () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    for (let c = 0; c < 50; c++) {
      const clinic = `${String(c).padStart(8, "0")}-0000-4000-8000-000000000000`;
      for (let i = 0; i < 12; i++) expect((await displayReq(clinic, "10.0.0.1")).status).toBe(200);
    }
  });
});

describe("authenticated routes", () => {
  const reportReq = (name: string) => report(new Request(`${ORIGIN}/api/v1/clinics/${clinicA}/reports/${name}`, {
    headers: { "x-client-ip": "203.0.113.90" },
  }), { params: Promise.resolve({ clinicId: clinicA, name }) });

  it("varying report names cannot bypass the pre-authentication database ceiling", async () => {
    for (let i = 0; i < 600; i++) expect((await reportReq(`unknown-${i}`)).status).toBe(401);
    expect((await reportReq("another-unknown-name")).status).toBe(429);
    expect(state.getRpcClient).toHaveBeenCalledTimes(600);
  });

  it("varying report names share one signed-in user's route allowance", async () => {
    state.getRpcClient.mockImplementation(async () => ({
      session: async () => ({ userId: userA, email: null }),
      rpc: async () => null,
    }));
    for (let i = 0; i < 60; i++) expect((await reportReq(`unknown-${i}`)).status).toBe(404);
    expect((await reportReq("another-unknown-name")).status).toBe(429);
  });

  it("an unauthenticated flood from one client never blocks a signed-in user elsewhere", async () => {
    // The pre-authentication ceiling is ten times the route limit so staff sharing one clinic address are not throttled together.
    for (let i = 0; i < 600; i++) expect((await callNextReq(clinicA, "203.0.113.66")).status).toBe(401);
    expect((await callNextReq(clinicA, "203.0.113.66")).status).toBe(429);
    state.getRpcClient.mockImplementationOnce(async () => ({ session: async () => ({ userId: userA, email: null }), rpc: async () => ({ ok: true }) }));
    expect((await callNextReq(clinicB, "198.51.100.7")).status).toBe(200);
  });
  it("without a trusted address source, an unauthenticated flood is rejected as 401, never by exhausting a shared bucket", async () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    for (let i = 0; i < 200; i++) expect((await callNextReq(clinicA, "203.0.113.66")).status).toBe(401);
    state.getRpcClient.mockImplementationOnce(async () => ({ session: async () => ({ userId: userA, email: null }), rpc: async () => ({ ok: true }) }));
    expect((await callNextReq(clinicB, "198.51.100.7")).status).toBe(200);
  });
  it("two signed-in users behind the same address never share a post-authentication bucket", async () => {
    for (let i = 0; i < 5; i++) expect((await authedGet(userA, "10.1.1.1")).status).toBe(200);
    expect((await authedGet(userA, "10.1.1.1")).status).toBe(429);
    expect((await authedGet(userB, "10.1.1.1")).status).toBe(200);
  });
  it("keeps per-user limits when no trusted address source is configured", async () => {
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    for (let i = 0; i < 5; i++) await authedGet(userA, "10.1.1.1");
    expect((await authedGet(userA, "10.1.1.1")).status).toBe(429);
    expect((await authedGet(userB, "10.2.2.2")).status).toBe(200);
  });
});

describe("SMS delivery receipts", () => {
  const sign = (body: string) => createHmac("sha256", "secret").update(body).digest("hex");
  const send = (body: string, signature?: string, ip = "203.0.113.66") => smsWebhook(new Request(`${ORIGIN}/api/v1/webhooks/sms`, {
    method: "POST", body, headers: { "x-client-ip": ip, ...(signature ? { "x-signature": signature } : {}) },
  }));
  it("an unsigned flood does not 429 a correctly signed provider callback", async () => {
    vi.stubEnv("SMS_WEBHOOK_SECRET", "secret");
    vi.stubEnv("CVSRS_SMS_WEBHOOK_DB_URL", "postgresql://webhook@127.0.0.1/db");
    for (let i = 0; i < 400; i++) expect([401, 429]).toContain((await send("{}", "0".repeat(64))).status);
    const body = JSON.stringify({ eventId: "receipt-1", providerMessageId: "message-1", status: "delivered" });
    expect((await send(body, sign(body), "198.51.100.7")).status).toBe(200);
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    for (let i = 0; i < 400; i++) await send("{}");
    expect((await send(body, sign(body))).status).toBe(200);
  });
});

describe("store outage policy (SEC-04)", () => {
  const production = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_PUBLIC_URL", "https://app.example");
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "https://redis.example");
    vi.stubEnv("CVSRS_RATE_LIMIT_TOKEN", "store-token");
    vi.stubGlobal("fetch", async () => Response.json({ error: "unavailable" }, { status: 500 }));
  };
  it("with the circuit open, sign-in returns 503 while an authenticated GET degrades", async () => {
    production();
    for (let i = 0; i < 5; i++) await expect(limitRequest(`warm-${i}`, 10, 60000)).rejects.toMatchObject({ status: 503 });
    const signInResponse = await signIn(signInReq("203.0.113.66", "nurse@clinic.example", "https://app.example"));
    expect(signInResponse.status).toBe(503);
    expect((await authedGet(userA, "10.1.1.1")).status).toBe(200);
  });
});

describe("production configuration", () => {
  const base = () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_PUBLIC_URL", "https://app.example");
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET", "");
  };
  it("fails closed without a trusted client-address source", () => {
    base();
    expect(() => getConfig()).toThrow(ConfigError);
    expect(() => getConfig()).toThrow(/CVSRS_TRUSTED_CLIENT_IP_HEADER/);
  });
  it("accepts a trusted header or the explicit, documented shared-bucket opt-in", () => {
    base();
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    expect(getConfig()).toMatchObject({ mode: "supabase", production: true });
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "");
    vi.stubEnv("CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET", "1");
    expect(getConfig()).toMatchObject({ mode: "supabase", production: true });
  });
  it.each([["CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-real-ip, x-forwarded-for"], ["CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET", "yes"]])("rejects a malformed %s", (name, value) => {
    base();
    vi.stubEnv("CVSRS_TRUSTED_CLIENT_IP_HEADER", "x-real-ip");
    vi.stubEnv(name, value);
    expect(() => getConfig()).toThrow(ConfigError);
  });
});
