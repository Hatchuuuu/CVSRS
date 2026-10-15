import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const db = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/db", () => ({ getRpcClient: async () => { db.calls++; throw new Error("should not reach database"); } }));
import { api } from "@/lib/api/handler";

const run = api({ auth: false, body: z.object({ name: z.string() }) }, async () => null);
const headers = { origin: "https://app.example", "idempotency-key": "11111111-1111-4111-8111-111111111111" };
afterEach(() => vi.unstubAllEnvs());

describe("API body boundary", () => {
  it("enforces shared production limits even when a route declares no rate option", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CVSRS_RATE_LIMIT_URL", "");
    db.calls = 0;
    const response = await api({ auth: false }, async () => "unused")(new Request("https://app.example/api/default-limit"));
    expect(response.status).toBe(503);
    expect(db.calls).toBe(0);
  });
  it("rejects malformed JSON before constructing the RPC client", async () => {
    db.calls = 0;
    const res = await run(new Request("https://app.example/api", { method: "POST", headers, body: "{" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("invalid_request");
    expect(db.calls).toBe(0);
  });
  it("rejects a multibyte body over 1 MB before constructing the RPC client", async () => {
    db.calls = 0;
    const res = await run(new Request("https://app.example/api", { method: "POST", headers, body: "é".repeat(500_001) }));
    expect(res.status).toBe(413);
    expect(db.calls).toBe(0);
  });
});
