import { createHmac } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dispatchSms } from "../../src/lib/sms/dispatch";
import { SandboxSmsProvider } from "../../src/lib/sms/sandbox";
import { handleSmsWebhook } from "../../src/lib/sms/webhook";
import { admin, as, op, pool, TEST_URL, type Actor } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let client: pg.Client;
let slot: string;
type R = { r: Record<string, unknown> };
const T = (n: number) => isoDaysFromToday(n);
const secret = "shared-secret";
const post = (body: object) => {
  const raw = JSON.stringify(body);
  return handleSmsWebhook(client, { provider: "sandbox", secret, rawBody: raw, signature: createHmac("sha256", secret).update(raw).digest("hex") });
};

async function optedInGuardian(g: Actor, phone: string) {
  const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Dispatch Kid", dob: T(-60) })]));
  await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
  const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [g.id, r.childId]);
  await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
  await as(g, (q) => q("select public.set_contact_preferences($1,null,$2,null)", [op(), phone]));
  const gid = (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [g.id]))[0]!.id;
  await as(w.assistant, (q) => q("select public.verify_guardian_contact($1,$2,$3)", [op(), w.clinic, gid]));
  await as(g, (q) => q("select public.set_contact_preferences($1,null,null,true)", [op()]));
  return { childId: r.childId as string, gid };
}

beforeAll(async () => {
  w = await clinicalWorld();
  client = new pg.Client({ connectionString: TEST_URL });
  await client.connect();
  await as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: T(1), startTime: "08:00", endTime: "12:00", totalCapacity: 50, onlineCapacity: 50, walkinCapacity: 0 })]));
  slot = (await admin<{ id: string }>("select id from public.clinic_sessions where clinic_id = $1 and service_date = $2", [w.clinic, T(1)]))[0]!.id;
});
afterAll(async () => {
  await client.end();
  await setDemoMode(false);
  await pool.end();
});

describe("booking -> queued -> provider -> callback, end to end", () => {
  it("sends the text once through the provider, records the provider id, and tracks delivery", async () => {
    const { childId, gid } = await optedInGuardian(w.g1, "0917 555 1234");
    await as(w.g1, (q) => q("select public.book_appointment($1,$2,$3,null)", [op(), childId, slot]));
    await admin("select private.process_outbox(100)");
    const provider = new SandboxSmsProvider();
    const r1 = await dispatchSms(client, provider, 50);
    expect(r1.sent).toBeGreaterThanOrEqual(1);
    const msg = (await admin<{ id: string; status: string; provider: string; provider_message_id: string }>("select id, status, provider, provider_message_id from public.sms_messages where guardian_id = $1", [gid]))[0]!;
    expect(msg).toMatchObject({ status: "sent", provider: "sandbox", provider_message_id: `sandbox-${msg.id}` });
    expect(provider.sent.get(msg.id)).toMatchObject({ to: expect.stringMatching(/5551234$/) });
    // a second pass sends nothing again
    expect((await dispatchSms(client, provider, 50)).claimed).toBe(0);
    // the callback marks it delivered; replaying it changes nothing
    expect(await post({ eventId: "d-1", providerMessageId: msg.provider_message_id, status: "delivered" })).toEqual({ status: 200, applied: true });
    expect(await post({ eventId: "d-1", providerMessageId: msg.provider_message_id, status: "delivered" })).toEqual({ status: 200, applied: false });
    expect((await admin<{ status: string }>("select status from public.sms_messages where id = $1", [msg.id]))[0]!.status).toBe("delivered");
    // wrong signature never reaches the database
    const raw = JSON.stringify({ eventId: "x", providerMessageId: msg.provider_message_id, status: "failed" });
    expect(await handleSmsWebhook(client, { provider: "sandbox", secret, rawBody: raw, signature: "00" })).toMatchObject({ status: 401 });
    expect(Number((await admin<{ n: string }>("select count(*) n from public.sms_events where provider_event_id = 'x'"))[0]!.n)).toBe(0);
  });

  it("retryable failures are retried with backoff, permanent failures stop, and a provider that throws is retried safely", async () => {
    const { gid } = await optedInGuardian(w.g2, "0917 555 9999");
    const ins = async (key: string) => (await admin<{ id: string }>("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key) values ($1,$2,'appointment','x',$3) returning id", [w.org, gid, key]))[0]!.id;
    const [a, b, c] = [await ins("d-a"), await ins("d-b"), await ins("d-c")];
    const p = new SandboxSmsProvider();
    p.failNext(true, "timeout");
    p.failNext(false, "blocked_number");
    const flaky: typeof p = Object.assign(Object.create(p), { name: "sandbox", send: async (req: { id: string; to: string; body: string }) => { if (req.id === c) throw new Error("network down"); return p.send(req); } });
    const res = await dispatchSms(client, flaky, 50);
    expect(res).toMatchObject({ claimed: 3, sent: 0, retry: 2, failed: 1 });
    const rows = await admin<{ id: string; status: string; last_error_code: string; wait: number }>("select id, status, last_error_code, extract(epoch from (available_at - now()))::int wait from public.sms_messages where id = any($1)", [[a, b, c]]);
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by[a]).toMatchObject({ status: "queued", last_error_code: "timeout" });
    expect(by[a]!.wait).toBeGreaterThan(30);
    expect(by[b]).toMatchObject({ status: "failed", last_error_code: "blocked_number" });
    expect(by[c]).toMatchObject({ status: "queued", last_error_code: "provider_error" });
  });

  it("an opt-out reply stops further texts", async () => {
    const gid = (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [w.g1.id]))[0]!.id;
    await admin("update public.sms_messages set status = 'sent', provider = 'sandbox', provider_message_id = 'pm-stop-x' where id = (select id from public.sms_messages where guardian_id = $1 order by created_at limit 1)", [gid]);
    expect(await post({ eventId: "stop-x", providerMessageId: "pm-stop-x", status: "opted_out" })).toEqual({ status: 200, applied: true });
    await admin("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key) values ($1,$2,'appointment','after stop','after-stop')", [w.org, gid]);
    const res = await dispatchSms(client, new SandboxSmsProvider(), 50);
    expect((await admin<{ status: string }>("select status from public.sms_messages where dedupe_key = 'after-stop'"))[0]!.status).toBe("queued");
    expect(res.sent).toBe(0);
  });

  it("does not count a provider response from a reclaimed claim", async () => {
    const gid = (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [w.g2.id]))[0]!.id;
    const id = (await admin<{ id: string }>(
      "insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key, available_at) values ($1,$2,'appointment','stale worker',$3,now() - interval '1 minute') returning id",
      [w.org, gid, `stale-dispatch-${op()}`],
    ))[0]!.id;
    const provider = {
      name: "sandbox",
      send: async () => {
        await admin("update public.sms_messages set locked_until = now() - interval '1 second' where id = $1", [id]);
        const reclaimed = (await admin<{ id: string; attempt: number }>("select * from private.claim_sms(100)")) .find((m) => m.id === id);
        expect(reclaimed?.attempt).toBe(2);
        return { ok: true as const, providerMessageId: "late-provider-id" };
      },
    };
    const result = await dispatchSms(client, provider, 1);
    expect(result).toEqual({ claimed: 1, sent: 0, retry: 0, failed: 0 });
    expect((await admin<{ status: string; attempt_count: number; provider_message_id: string | null }>(
      "select status, attempt_count, provider_message_id from public.sms_messages where id = $1", [id],
    ))[0]).toEqual({ status: "sending", attempt_count: 2, provider_message_id: null });
  });

  it("counts a fifth retryable provider error as a persisted failure", async () => {
    const gid = (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [w.g2.id]))[0]!.id;
    const id = (await admin<{ id: string }>(
      "insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key, attempt_count, available_at) values ($1,$2,'appointment','final retry',$3,4,now() - interval '1 minute') returning id",
      [w.org, gid, `fifth-dispatch-${op()}`],
    ))[0]!.id;
    const provider = new SandboxSmsProvider();
    provider.failNext(true, "timeout");
    expect(await dispatchSms(client, provider, 1)).toEqual({ claimed: 1, sent: 0, retry: 0, failed: 1 });
    expect((await admin<{ status: string; attempt_count: number }>(
      "select status, attempt_count from public.sms_messages where id = $1", [id],
    ))[0]).toEqual({ status: "failed", attempt_count: 5 });
  });
});
