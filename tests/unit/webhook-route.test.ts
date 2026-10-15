import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const constructed = vi.hoisted(() => ({ count: 0, queries: 0 }));
vi.mock("pg", () => ({ default: { Client: class {
  constructor() { constructed.count++; }
  async connect() { return undefined; }
  async query() { constructed.queries++; return { rows: [{ applied: true }] }; }
  async end() { return undefined; }
} } }));
import { POST } from "@/app/api/v1/webhooks/sms/route";

const endpoint = "https://app.example/api/v1/webhooks/sms";
const sign = (body: string) => createHmac("sha256", "secret").update(body).digest("hex");
const send = (body: string, signature?: string) => POST(new Request(endpoint, { method: "POST", body, headers: signature ? { "x-signature": signature } : {} }));

afterEach(() => {
  vi.unstubAllEnvs();
  constructed.count = 0;
  constructed.queries = 0;
});

describe("SMS webhook route", () => {
  it("does not borrow worker credentials for a valid webhook", async () => {
    vi.stubEnv("CVSRS_WORKER_DB_URL", "postgresql://privileged-worker");
    vi.stubEnv("CVSRS_SMS_WEBHOOK_DB_URL", "");
    vi.stubEnv("SMS_WEBHOOK_SECRET", "secret");
    const body = JSON.stringify({ eventId: "receipt-1", providerMessageId: "message-1", status: "delivered" });
    expect((await send(body, sign(body))).status).toBe(503);
    expect(constructed.count).toBe(0);
  });
  it("rejects unsigned and invalid signatures before constructing a database client", async () => {
    vi.stubEnv("CVSRS_WORKER_DB_URL", "postgresql://unused");
    vi.stubEnv("SMS_WEBHOOK_SECRET", "secret");
    expect((await send("{}" )).status).toBe(401);
    expect((await send("{}", "bad")).status).toBe(401);
    expect(constructed.count).toBe(0);
  });
  it("rejects correctly signed malformed JSON before constructing a database client", async () => {
    vi.stubEnv("CVSRS_WORKER_DB_URL", "postgresql://unused");
    vi.stubEnv("SMS_WEBHOOK_SECRET", "secret");
    const res = await send("not json", sign("not json"));
    expect(res.status).toBe(400);
    expect(constructed.count).toBe(0);
  });
  it("rejects more than 10,000 UTF-8 bytes before constructing a client", async () => {
    vi.stubEnv("CVSRS_WORKER_DB_URL", "postgresql://unused");
    vi.stubEnv("SMS_WEBHOOK_SECRET", "secret");
    const body = "é".repeat(5_001);
    expect((await send(body, sign(body))).status).toBe(413);
    expect(constructed.count).toBe(0);
  });
});
