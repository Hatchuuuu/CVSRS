import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let slot: string;
let seq = 0;
type R = { r: Record<string, unknown> };
const T = (n: number) => isoDaysFromToday(n);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);

async function guardianChild(g: Actor, name: string) {
  const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, dob: T(-60) })]));
  await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
  const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [g.id, r.childId]);
  await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
  return r.childId as string;
}
const guardianId = async (g: Actor) => (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [g.id]))[0]!.id;
const prefs = (g: Actor) => as(g, (q) => q<R>("select public.get_contact_preferences() as r", [])).then((x) => x[0]!.r as Record<string, unknown>);
const setPrefs = (g: Actor, phone: string | null, optIn: boolean | null, lang: string | null = null) =>
  as(g, (q) => q<R>("select public.set_contact_preferences($1,$2,$3,$4) as r", [op(), lang, phone, optIn])).then((x) => x[0]!.r as Record<string, unknown>);
const verifyContact = (a: Actor, gid: string, clinic = w.clinic) => as(a, (q) => q("select public.verify_guardian_contact($1,$2,$3)", [op(), clinic, gid]));
/** A guardian with a child at the clinic, a phone on file, checked in person and opted in. */
async function optedIn(g: Actor, name: string, phone = "0917 123 4567") {
  const child = await guardianChild(g, name);
  await setPrefs(g, phone, null);
  await verifyContact(w.assistant, await guardianId(g));
  await setPrefs(g, null, true);
  return child;
}
const work = () => admin("select private.process_outbox(500)");
const book = (g: Actor, child: string) => as(g, (q) => q<R>("select public.book_appointment($1,$2,$3,null) as r", [op(), child, slot])).then((x) => x[0]!.r);
const smsFor = (gid: string) => admin<{ id: string; body: string; status: string; kind: string; attempt_count: number }>("select id, body, status, kind, attempt_count from public.sms_messages where guardian_id = $1 order by created_at", [gid]);
const claim = (n = 20) => admin<{ id: string; phone: string; body: string; attempt: number }>("select * from private.claim_sms($1)", [n]);
const event = async (id: string, status: string, provider = "sandbox", pm = "pm-1") => (await admin<{ r: boolean }>("select private.record_sms_event($1,$2,$3,$4,now()) as r", [provider, id, pm, status]))[0]!.r;

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "sms-v1");
  await as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: T(1), startTime: "08:00", endTime: "12:00", totalCapacity: 200, onlineCapacity: 200, walkinCapacity: 0 })]));
  slot = (await admin<{ id: string }>("select id from public.clinic_sessions where clinic_id = $1 and service_date = $2", [w.clinic, T(1)]))[0]!.id;
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("consent and the in-person check (F18)", () => {
  it("text messages need an in-person check of the number first; changing the number withdraws both", async () => {
    await guardianChild(w.g1, "Consent Kid");
    const gid = await guardianId(w.g1);
    expect(await prefs(w.g1)).toMatchObject({ hasPhone: false, phoneChecked: false, smsOptIn: false });
    await expectCode(setPrefs(w.g1, null, true), "CV422");
    await expectCode(setPrefs(w.g1, "abc", null), "CV422");
    const p = await setPrefs(w.g1, "0917 123 4567", null);
    expect(p).toMatchObject({ hasPhone: true, phoneChecked: false, phoneMasked: "••••••••567" });
    await expectCode(setPrefs(w.g1, null, true), "CV422"); // still unchecked
    await verifyContact(w.assistant, gid);
    expect(await setPrefs(w.g1, null, true)).toMatchObject({ phoneChecked: true, smsOptIn: true });
    expect(await count("select count(*) n from public.sms_consents where guardian_id = $1 and action = 'granted' and source = 'app'", [gid])).toBe(1);
    // a new number: opt-in and check are gone, and the withdrawal is on record
    const changed = await setPrefs(w.g1, "0918 555 0000", null);
    expect(changed).toMatchObject({ phoneChecked: false, smsOptIn: false });
    expect(await count("select count(*) n from public.sms_consents where guardian_id = $1 and action = 'withdrawn' and source = 'phone_changed'", [gid])).toBe(1);
    await expectCode(setPrefs(w.g1, null, true), "CV422");
    expect(await setPrefs(w.g1, null, null, "fil")).toMatchObject({ language: "fil" });
    await expectCode(setPrefs(w.g1, null, null, "xx"), "CV422");
  });

  it("only staff with guardian.verify at a clinic where the guardian's child is enrolled can check a number", async () => {
    await guardianChild(w.g2, "Verify Kid");
    await setPrefs(w.g2, "0917 000 1111", null);
    const gid = await guardianId(w.g2);
    for (const a of [w.inventory, w.g1, w.otherClinicStaff]) await expectCode(verifyContact(a, gid), "CV403");
    await expectCode(as(w.assistant, (q) => q("select public.verify_guardian_contact($1,$2,$3)", [op(), w.clinic, crypto.randomUUID()])), "CV404");
    await expectCode(as({ ...w.assistant, aal: "aal1" }, (q) => q("select public.verify_guardian_contact($1,$2,$3)", [op(), w.clinic, gid])), "CV403");
    await verifyContact(w.assistant, gid);
    expect(await count("select count(*) n from private.audit_logs where action = 'contact.verified' and entity_id = $1", [gid])).toBe(1);
  });

  it("consent records and SMS tables are protected and immutable", async () => {
    for (const t of ["public.sms_consents", "public.sms_messages", "public.sms_events"]) await expectCode(as(w.g1, (q) => q(`select * from ${t}`)), "42501");
    for (const f of ["private.claim_sms(5)", "private.mark_sms(gen_random_uuid(),1,'sent')", "private.record_sms_event('p','e','m','sent',now())"]) await expectCode(as(w.lead, (q) => q(`select ${f}`)), "42501");
    await expectCode(admin("select private.mark_sms(gen_random_uuid(),'sent')"), "42883");
    await admin("insert into public.sms_consents (organization_id, guardian_id, action, source) values ($1,$2,'granted','app')", [w.org, await guardianId(w.g1)]);
    await expectCode(admin("update public.sms_consents set action = 'granted'"), "CV403");
    await expectCode(admin("delete from public.sms_consents"), "CV403");
    await expectCode(as(null, (q) => q("select public.get_contact_preferences()")), "42501");
  });
});

describe("queueing (BP22): SMS only for opted-in, checked numbers, with fixed minimal wording", () => {
  it("creates one SMS per event for opted-in guardians only, never with the child's name or clinical details", async () => {
    const kid = await optedIn(w.g1, "Sms Kid");
    const other = await guardianChild(w.g2, "Silent Kid");
    await setPrefs(w.g2, null, false).catch(() => undefined);
    await book(w.g1, kid);
    await book(w.g2, other);
    await work();
    const mine = await smsFor(await guardianId(w.g1));
    expect(mine.map((m) => m.kind)).toContain("appointment");
    const sms = mine.find((m) => m.kind === "appointment")!;
    expect(sms.status).toBe("queued");
    expect(sms.body).toContain("Clinical Clinic");
    expect(sms.body).not.toMatch(/Sms Kid|vaccin|dose|lot /i);
    expect((await smsFor(await guardianId(w.g2))).filter((m) => m.kind === "appointment")).toHaveLength(0);
    await work();
    expect(await smsFor(await guardianId(w.g1))).toHaveLength(mine.length); // no duplicates on re-run
  });

  it("clinical events (a vaccination recorded) never become text messages", async () => {
    const child = (await admin<{ id: string }>("select id from public.children order by created_at limit 1"))[0]!.id;
    await admin("insert into private.outbox_jobs (organization_id, job_type, aggregate_type, aggregate_id, dedupe_key, payload) values ($1,'vaccination.recorded','vaccination_event',gen_random_uuid(),'sms-t-vax',$2)", [w.org, JSON.stringify({ childId: child })]);
    await work();
    expect(await count("select count(*) n from public.sms_messages where kind = 'record'")).toBe(0);
  });

  it("turning SMS off withdraws waiting messages and nothing is claimed for that guardian", async () => {
    const kid = await optedIn(w.g2, "Leaver Kid", "0917 222 3333");
    await book(w.g2, kid);
    await work();
    const gid = await guardianId(w.g2);
    expect((await smsFor(gid)).some((m) => m.status === "queued")).toBe(true);
    await setPrefs(w.g2, null, false);
    expect((await smsFor(gid)).every((m) => m.status !== "queued")).toBe(true);
    const claimed = await claim(100);
    expect(claimed.every((c) => !c.phone.endsWith("2223333"))).toBe(true);
  });
});

describe("delivery pipeline", () => {
  it("claims each message once (also concurrently), hands over the phone and text, and retries with backoff", async () => {
    await admin("update public.sms_messages set status = 'failed'"); // clear earlier fixtures
    await setPrefs(w.g1, "0917 999 8888", null);
    await verifyContact(w.assistant, await guardianId(w.g1));
    await setPrefs(w.g1, null, true);
    const gid = await guardianId(w.g1);
    for (let i = 0; i < 3; i++) await admin("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key) values ($1,$2,'appointment','Clinical Clinic: test',$3)", [w.org, gid, `pipe-${i}-${seq}`]);
    const [a, b] = await Promise.all([claim(1), claim(1)]);
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.id).not.toBe(b[0]!.id);
    expect(a[0]).toMatchObject({ phone: expect.stringMatching(/9998888$/), body: "Clinical Clinic: test", attempt: 1 });
    // retry: back to queued with a future time
    await admin("select private.mark_sms($1,$2,'retry','sandbox',null,'timeout')", [a[0]!.id, a[0]!.attempt]);
    const row = (await admin<{ status: string; wait: number; last_error_code: string }>("select status, extract(epoch from (available_at - now()))::int wait, last_error_code from public.sms_messages where id = $1", [a[0]!.id]))[0]!;
    expect(row).toMatchObject({ status: "queued", last_error_code: "timeout" });
    expect(row.wait).toBeGreaterThan(30);
    expect((await claim(100)).map((c) => c.id)).not.toContain(a[0]!.id);
    // success
    await admin("select private.mark_sms($1,$2,'sent','sandbox','pm-a')", [b[0]!.id, b[0]!.attempt]);
    expect((await admin<{ status: string; provider_message_id: string }>("select status, provider_message_id from public.sms_messages where id = $1", [b[0]!.id]))[0]).toEqual({ status: "sent", provider_message_id: "pm-a" });
    // marking something that is not being sent does nothing
    await admin("select private.mark_sms($1,$2,'failed','sandbox',null,'late')", [b[0]!.id, b[0]!.attempt]);
    expect((await admin<{ status: string }>("select status from public.sms_messages where id = $1", [b[0]!.id]))[0]!.status).toBe("sent");
    // attempts are bounded
    await admin("update public.sms_messages set status = 'sending', attempt_count = 5, locked_until = now() + interval '2 minutes' where id = $1", [a[0]!.id]);
    await admin("select private.mark_sms($1,5,'retry','sandbox',null,'still failing')", [a[0]!.id]);
    expect((await admin<{ status: string }>("select status from public.sms_messages where id = $1", [a[0]!.id]))[0]!.status).toBe("failed");
  });

  it("a message stuck in 'sending' is claimable again once its lock expires", async () => {
    const gid = await guardianId(w.g1);
    const id = (await admin<{ id: string }>("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key, status, locked_until, attempt_count) values ($1,$2,'appointment','stuck test',$3,'sending', now() - interval '1 minute', 1) returning id", [w.org, gid, `stuck-${seq}`]))[0]!.id;
    const got = await claim(100);
    expect(got.map((c) => c.id)).toContain(id);
    expect(got.find((c) => c.id === id)!.attempt).toBe(2);
  });
});

describe("provider status callbacks", () => {
  async function sent(pm: string) {
    const gid = await guardianId(w.g1);
    return (await admin<{ id: string }>("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key, status, provider, provider_message_id) values ($1,$2,'appointment','cb test',$3,'sent','sandbox',$4) returning id", [w.org, gid, `cb-${pm}`, pm]))[0]!.id;
  }
  const status = async (id: string) => (await admin<{ status: string }>("select status from public.sms_messages where id = $1", [id]))[0]!.status;

  it("are idempotent, move status forward only, and survive out-of-order arrival", async () => {
    const id = await sent("pm-ord-1");
    expect(await event("e-1", "delivered", "sandbox", "pm-ord-1")).toBe(true);
    expect(await status(id)).toBe("delivered");
    expect(await event("e-1", "delivered", "sandbox", "pm-ord-1")).toBe(false); // duplicate callback
    expect(await event("e-0", "sent", "sandbox", "pm-ord-1")).toBe(false); // older status arrives late
    expect(await event("e-2", "failed", "sandbox", "pm-ord-1")).toBe(false); // a stray failure cannot undo a delivery
    expect(await status(id)).toBe("delivered");
    expect(await count("select count(*) n from public.sms_events where provider_message_id = 'pm-ord-1'")).toBe(3);
    expect(await count("select count(*) n from public.sms_events where provider_message_id = 'pm-ord-1' and applied")).toBe(1);
  });

  it("record failures, ignore unknown messages and unknown statuses", async () => {
    const id = await sent("pm-fail-1");
    expect(await event("f-1", "undeliverable", "sandbox", "pm-fail-1")).toBe(true);
    expect(await status(id)).toBe("undeliverable");
    expect(await event("f-2", "delivered", "sandbox", "no-such-message")).toBe(false);
    await expect(event("f-3", "exploded", "sandbox", "pm-fail-1")).rejects.toMatchObject({ code: "CV422" });
    expect(await event("f-1", "delivered", "other-provider", "pm-fail-1")).toBe(false); // same ids under another provider are a different message
  });

  it("a STOP reply turns SMS off, records the withdrawal and withdraws waiting messages", async () => {
    const gid = await guardianId(w.g1);
    await setPrefs(w.g1, "0917 123 0000", null);
    await verifyContact(w.assistant, gid);
    await setPrefs(w.g1, null, true);
    const id = await sent("pm-stop-1");
    await admin("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key) values ($1,$2,'appointment','waiting',$3)", [w.org, gid, `stop-${seq}`]);
    expect(await event("s-1", "opted_out", "sandbox", "pm-stop-1")).toBe(true);
    expect(await status(id)).toBe("opted_out");
    expect(await prefs(w.g1)).toMatchObject({ smsOptIn: false });
    expect(await count("select count(*) n from public.sms_consents where guardian_id = $1 and source = 'provider_reply'", [gid])).toBe(1);
    expect(await count("select count(*) n from public.sms_messages where guardian_id = $1 and status = 'queued'", [gid])).toBe(0);
  });
});

describe("staff view of guardian contacts", () => {
  it("shows a masked number and its status only to staff who can verify guardians", async () => {
    const child = await guardianChild(w.g2, "Contact View Kid");
    await setPrefs(w.g2, "0917 424 2424", null);
    const list = async (a: Actor) => (await as(a, (q) => q<R>("select public.list_child_guardian_contacts($1,$2) as r", [w.clinic, child])))[0]!.r as unknown as { phoneMasked: string; phoneChecked: boolean; smsOptIn: boolean; guardianId: string }[];
    expect((await list(w.assistant))[0]).toMatchObject({ phoneMasked: "••••••••424", phoneChecked: false, smsOptIn: false });
    expect(JSON.stringify(await list(w.assistant))).not.toContain("0917");
    await expectCode(list(w.inventory), "CV403");
    await expectCode(list(w.g2), "CV403");
    await expectCode(list(w.otherClinicStaff), "CV403");
    await verifyContact(w.assistant, (await list(w.assistant))[0]!.guardianId);
    expect((await list(w.assistant))[0]!.phoneChecked).toBe(true);
  });

  it("rejects completion from an expired attempt after reclaim", async () => {
    const gid = await guardianId(w.g1);
    await setPrefs(w.g1, "0917 123 0000", null);
    await verifyContact(w.assistant, gid);
    await setPrefs(w.g1, null, true);
    const id = (await admin<{ id: string }>("insert into public.sms_messages (organization_id, guardian_id, kind, body, dedupe_key) values ($1,$2,'appointment','lease test',$3) returning id", [w.org, gid, `lease-${seq}`]))[0]!.id;
    const first = (await claim(100)).find((m) => m.id === id)!;
    await admin("update public.sms_messages set locked_until = now() - interval '1 second' where id = $1", [id]);
    const second = (await claim(100)).find((m) => m.id === id)!;
    expect(second.attempt).toBe(first.attempt + 1);
    expect((await admin<{ applied: boolean }>("select private.mark_sms($1,null,'sent') applied", [id]))[0]!.applied).toBe(false);
    await admin("update public.sms_messages set locked_until = null where id = $1", [id]);
    expect((await admin<{ applied: boolean }>("select private.mark_sms($1,$2,'sent') applied", [id, second.attempt]))[0]!.applied).toBe(false);
    await admin("update public.sms_messages set locked_until = now() + interval '2 minutes' where id = $1", [id]);
    for (const outcome of ["sent", "retry"]) {
      const applied = (await admin<{ applied: boolean }>("select private.mark_sms($1,$2,$3,'sandbox','late-id','late') applied", [id, first.attempt, outcome]))[0]!.applied;
      expect(applied).toBe(false);
    }
    expect((await admin<{ status: string; attempt_count: number }>("select status, attempt_count from public.sms_messages where id = $1", [id]))[0]).toEqual({ status: "sending", attempt_count: second.attempt });
    expect((await admin<{ applied: boolean }>("select private.mark_sms($1,$2,'sent','sandbox','current-id') applied", [id, second.attempt]))[0]!.applied).toBe(true);
    expect((await admin<{ status: string; provider_message_id: string }>("select status, provider_message_id from public.sms_messages where id = $1", [id]))[0]).toEqual({ status: "sent", provider_message_id: "current-id" });
  });
});
