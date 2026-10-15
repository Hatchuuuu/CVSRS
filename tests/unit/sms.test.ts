import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSmsProvider } from "../../src/lib/sms";
import { toE164, type SmsProvider } from "../../src/lib/sms/provider";
import { SandboxSmsProvider } from "../../src/lib/sms/sandbox";
import { handleSmsWebhook, verifySignature } from "../../src/lib/sms/webhook";

/** The contract every provider adapter must satisfy. Run against each real adapter as it is added. */
export async function providerContract(make: () => SmsProvider & { failNext?: (retryable: boolean, code?: string) => void }) {
  const p = make();
  const first = await p.send({ id: "m-1", to: "0917 123 4567", body: "hello" });
  expect(first.ok).toBe(true);
  const again = await p.send({ id: "m-1", to: "0917 123 4567", body: "hello" });
  expect(again).toEqual(first); // the id is an idempotency key
  const bad = await p.send({ id: "m-2", to: "12", body: "hello" });
  expect(bad).toMatchObject({ ok: false, retryable: false });
  if (p.failNext) {
    p.failNext(true, "timeout");
    expect(await p.send({ id: "m-3", to: "0917 123 4567", body: "x" })).toMatchObject({ ok: false, retryable: true, code: "timeout" });
    expect((await p.send({ id: "m-3", to: "0917 123 4567", body: "x" })).ok).toBe(true); // works on retry
  }
}

describe("SMS provider contract", () => {
  it("refuses the simulated provider in production so messages cannot be falsely marked sent", () => {
    expect(() => getSmsProvider({ NODE_ENV: "production", SMS_PROVIDER: "sandbox" })).toThrow("not permitted in production");
  });
  it("the sandbox provider satisfies it", async () => {
    await providerContract(() => new SandboxSmsProvider());
  });
  it("is off unless configured, and unknown providers fail loudly", () => {
    expect(getSmsProvider({})).toBeNull();
    expect(getSmsProvider({ SMS_PROVIDER: "none" })).toBeNull();
    expect(getSmsProvider({ SMS_PROVIDER: "sandbox" })?.name).toBe("sandbox");
    expect(() => getSmsProvider({ SMS_PROVIDER: "acme" })).toThrow(/Unknown SMS_PROVIDER/);
  });
  it("normalises Philippine numbers only when unambiguous", () => {
    expect(toE164("0917 123 4567")).toBe("+639171234567");
    expect(toE164("+63 917 123 4567")).toBe("+639171234567");
    expect(toE164("639171234567")).toBe("+639171234567");
    expect(toE164("12345")).toBeNull();
    expect(toE164("abc")).toBeNull();
  });
});

describe("webhook signatures", () => {
  const secret = "test-secret";
  const body = JSON.stringify({ eventId: "e1", providerMessageId: "p1", status: "delivered" });
  const sign = (b: string, s = secret) => createHmac("sha256", s).update(b).digest("hex");

  it("accepts only the exact HMAC of the raw body", () => {
    expect(verifySignature(secret, body, sign(body))).toBe(true);
    expect(verifySignature(secret, body, "sha256=" + sign(body))).toBe(true);
    expect(verifySignature(secret, body + " ", sign(body))).toBe(false);
    expect(verifySignature(secret, body, sign(body, "other"))).toBe(false);
    expect(verifySignature(secret, body, sign(body) + "f")).toBe(false);
    expect(verifySignature(secret, body, "zz")).toBe(false);
    expect(verifySignature(secret, body, null)).toBe(false);
    expect(verifySignature("", body, sign(body, ""))).toBe(false);
  });

  it("rejects before touching the database when unsigned, unconfigured or malformed", async () => {
    const touched: string[] = [];
    const client = { query: async (sql: string) => (touched.push(sql), { rows: [{ applied: true }] }) } as never;
    expect(await handleSmsWebhook(client, { provider: "sandbox", secret: undefined, rawBody: body, signature: sign(body) })).toMatchObject({ status: 503 });
    expect(await handleSmsWebhook(client, { provider: "sandbox", secret, rawBody: body, signature: "nope" })).toMatchObject({ status: 401 });
    const junk = "not json";
    expect(await handleSmsWebhook(client, { provider: "sandbox", secret, rawBody: junk, signature: sign(junk) })).toMatchObject({ status: 400 });
    const unknownStatus = JSON.stringify({ eventId: "e", providerMessageId: "p", status: "exploded" });
    expect(await handleSmsWebhook(client, { provider: "sandbox", secret, rawBody: unknownStatus, signature: sign(unknownStatus) })).toMatchObject({ status: 400 });
    expect(touched).toEqual([]);
    expect(await handleSmsWebhook(client, { provider: "sandbox", secret, rawBody: body, signature: sign(body) })).toEqual({ status: 200, applied: true });
    expect(touched).toHaveLength(1);
  });
});
