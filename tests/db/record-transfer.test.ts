import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { admin, as, expectCode, grant, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let staffB: Actor; // child.register at the receiving clinic
let assistantB: Actor; // no guardian.verify... assistant role has it; used as a receiving-side user without release rights
let seq = 0;
type R = { r: Record<string, unknown> };
const T = (n: number) => isoDaysFromToday(n);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);
let otherOrgClinic: string;

async function child(g: Actor, name = "Move Kid") {
  const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, dob: T(-120) })]));
  await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
  const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [g.id, r.childId]);
  await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
  return r.childId as string;
}
const reqG = (a: Actor, kid: string, to = w.otherClinic) => as(a, (q) => q<R>("select public.request_record_transfer_guardian($1,$2,$3) as r", [op(), kid, to])).then((x) => x[0]!.r);
const reqS = (a: Actor, kid: string, to = w.otherClinic, clinic = w.clinic) => as(a, (q) => q<R>("select public.initiate_record_transfer_out($1,$2,$3,$4,'family is moving') as r", [op(), clinic, kid, to])).then((x) => x[0]!.r);
const release = (a: Actor, id: string, clinic = w.clinic) => as(a, (q) => q("select public.approve_record_transfer_release($1,$2,$3)", [op(), clinic, id]));
const accept = (a: Actor, id: string, clinic = w.otherClinic, key = op()) => as(a, (q) => q<R>("select public.accept_record_transfer($1,$2,$3) as r", [key, clinic, id])).then((x) => x[0]!.r);
const decline = (a: Actor, id: string, clinic: string, reason = "the family changed their mind") => as(a, (q) => q("select public.decline_record_transfer($1,$2,$3,$4)", [op(), clinic, id, reason]));
const lists = (a: Actor, clinic: string) => as(a, (q) => q<R>("select public.list_record_transfers($1) as r", [clinic])).then((x) => x[0]!.r as unknown as { outgoing: { id: string; status: string; childName: string | null }[]; incoming: { id: string; status: string; childName: string | null; recordNo: string | null; childId: string | null }[]; clinics: { id: string }[] });
const enrolled = (kid: string) => admin<{ clinic_id: string; status: string; is_primary: boolean; basis: string }>("select clinic_id, status, is_primary, basis from public.child_clinic_enrollments where child_id = $1 order by created_at", [kid]);
const staffGet = (a: Actor, clinic: string, kid: string) => as(a, (q) => q<R>("select public.staff_get_child($1,$2) as r", [clinic, kid])).then((x) => x[0]!.r);

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "tr-v1");
  staffB = w.otherClinicStaff; // clinical lead at the other clinic: child.register + review.resolve there
  assistantB = await newUser("asstB");
  await grant(w.org, w.otherClinic, assistantB, "assistant");
  const org2 = (await admin<{ id: string }>("insert into public.organizations (name) values ('Elsewhere Org') returning id"))[0]!.id;
  otherOrgClinic = (await admin<{ id: string }>("insert into public.clinics (organization_id, name) values ($1,'Faraway Clinic') returning id", [org2]))[0]!.id;
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("asking for a transfer", () => {
  it("a verified guardian can ask; targets must be another active clinic of the same organization; one open transfer per child", async () => {
    const kid = await child(w.g1);
    await expectCode(reqG(w.g1, kid, w.clinic), "CV422");
    await expectCode(reqG(w.g1, kid, otherOrgClinic), "CV422");
    await expectCode(reqG(w.g1, kid, crypto.randomUUID()), "CV422");
    await expectCode(reqG(w.g2, kid), "CV404"); // not this child's guardian
    await expectCode(as(null, (q) => q("select public.request_record_transfer_guardian($1,$2,$3)", [op(), kid, w.otherClinic])), "42501");
    const r = await reqG(w.g1, kid);
    expect(r.status).toBe("requested");
    const [{ r: mine }] = await as(w.g1, (q) => q<{ r: { transfers: { id: string; fromClinicTimezone: string }[] } }>("select public.my_record_transfers($1) as r", [kid]));
    expect(mine.transfers.find((t) => t.id === r.transferId)?.fromClinicTimezone).toBe("Asia/Manila");
    expect(await count("select count(*) n from public.record_transfers where child_id = $1 and consent_method = 'app' and consent_guardian_id is not null", [kid])).toBe(1);
    await expectCode(reqG(w.g1, kid), "CV409");
    await expectCode(reqS(w.assistant, kid), "CV409");
  });

  it("staff of the current clinic with guardian.verify can record an in-person request; nobody else, and only for their own enrolled child", async () => {
    const kid = await child(w.g1);
    for (const a of [w.inventory, w.techAdmin, w.g1, staffB, { ...w.assistant, aal: "aal1" as const }]) await expectCode(reqS(a, kid), "CV403");
    await expectCode(reqS(w.assistant, crypto.randomUUID()), "CV404"); // not enrolled here (no receipt is kept)
    const [{ r: provisional }] = await as(w.g2, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Unverified Guardian Kid", dob: T(-30) })]));
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, provisional.childId]));
    await expectCode(reqS(w.assistant, provisional.childId as string), "CV409"); // guardian not verified
    const r = await reqS(w.assistant, kid);
    expect(r.status).toBe("requested");
    expect(await count("select count(*) n from public.record_transfers where child_id = $1 and consent_method = 'in_person' and initiated_by = $2", [kid, w.assistant.id])).toBe(1);
  });
});

describe("release and acceptance are separate decisions by different clinics", () => {
  it("cannot leave a new confirmed old-clinic booking when acceptance races a blocked booking", async () => {
    const kid = await child(w.g1, "Booking Race Kid");
    const [{ r: session }] = await as(w.assistant, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ serviceDate: T(2), startTime: "08:00", endTime: "12:00", totalCapacity: 1, onlineCapacity: 1, walkinCapacity: 0 })]));
    const id = (await reqG(w.g1, kid)).transferId as string;
    await release(w.lead, id);
    const blocker = new pg.Client({ connectionString: pool.options.connectionString });
    await blocker.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select 1 from public.clinic_sessions where id = $1 for update", [session.sessionId]);
      const booking = as(w.g1, (q) => q<R>("select public.book_appointment($1,$2,$3) as r", [op(), kid, session.sessionId]));
      let blocked = false;
      for (let n = 0; n < 100; n++) {
        blocked = Number((await admin<{ n: string }>("select count(*) n from pg_stat_activity where query like 'select public.book_appointment(%' and wait_event_type = 'Lock'"))[0]!.n) > 0;
        if (blocked) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
      const acceptance = accept(staffB, id);
      let acceptedOrWaiting = false;
      for (let n = 0; n < 100; n++) {
        acceptedOrWaiting = Number((await admin<{ n: string }>("select count(*) n from pg_stat_activity where query like 'select public.accept_record_transfer(%' and wait_event_type = 'Lock'"))[0]!.n) > 0
          || (await admin<{ status: string }>("select status from public.record_transfers where id = $1", [id]))[0]!.status === "completed";
        if (acceptedOrWaiting) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(acceptedOrWaiting).toBe(true);
      await blocker.query("commit");
      await Promise.allSettled([booking, acceptance]);
      expect((await admin<{ status: string }>("select status from public.record_transfers where id = $1", [id]))[0]!.status).toBe("completed");
      expect(await count("select count(*) n from public.appointments where child_id = $1 and session_id = $2 and status = 'confirmed'", [kid, session.sessionId])).toBe(0);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      await blocker.end();
    }
  });
  it("nothing moves until a lead of the current clinic releases it AND the receiving clinic accepts", async () => {
    const kid = await child(w.g1, "Journey Kid");
    const t = await reqG(w.g1, kid);
    const id = t.transferId as string;
    await expectCode(accept(staffB, id), "CV409"); // not released yet
    await expectCode(release(w.clinician, id), "CV403");
    await expectCode(release(w.assistant, id), "CV403");
    await expectCode(release(staffB, id), "CV403"); // no rights at the current clinic
    await expectCode(release(staffB, id, w.otherClinic), "CV404"); // wrong side
    await release(w.lead, id);
    await expectCode(release(w.lead2, id), "CV409");
    expect((await enrolled(kid)).map((e) => `${e.clinic_id === w.clinic ? "A" : "B"}:${e.status}`)).toEqual(["A:active"]);
    for (const a of [w.lead, w.clinician, w.assistant, w.g1, w.inventory]) await expectCode(accept(a, id), "CV403"); // no rights at the receiving clinic
    await expectCode(accept(w.lead, id, w.clinic), "CV404"); // the sending side is not the destination
    expect((await enrolled(kid)).filter((e) => e.clinic_id === w.otherClinic)).toHaveLength(0);
    // the receiving clinic: still cannot see the child before accepting
    expect(await staffGet(staffB, w.otherClinic, kid)).toBeNull();
    const done = await accept(staffB, id);
    expect(done).toMatchObject({ status: "completed", childId: kid });
    expect((await enrolled(kid)).map((e) => `${e.clinic_id === w.clinic ? "A" : "B"}:${e.status}:${e.is_primary}`)).toEqual(["A:closed:false", "B:active:true"]);
    expect((await enrolled(kid)).find((e) => e.clinic_id === w.otherClinic)!.basis).toBe("transfer");
    await expectCode(accept(staffB, id), "CV409");
  });

  it("access moves with the enrollment: the old clinic loses the child, the new clinic gets it with the whole history", async () => {
    const kid = await child(w.g1, "Access Kid");
    await as(w.clinician, (q) => q("select public.record_outside_dose_staff($1,$2,$3,$4,$5,true)", [op(), w.clinic, kid, JSON.stringify({ productText: "DEMO-P-ALPHA", administeredOn: T(-30), provider: "Elsewhere" }), w.products["DEMO-P-ALPHA"]]));
    expect(await staffGet(w.lead, w.clinic, kid)).not.toBeNull();
    const id = (await reqS(w.assistant, kid)).transferId as string;
    await release(w.lead, id);
    await accept(staffB, id);
    expect(await staffGet(w.lead, w.clinic, kid)).toBeNull();
    expect(await staffGet(w.assistant, w.clinic, kid)).toBeNull();
    expect((await staffGet(staffB, w.otherClinic, kid))!.displayName).toEqual(expect.stringContaining("Access Kid"));
    const hist = (await as(staffB, (q) => q<R>("select public.list_child_history($1,$2) as r", [w.otherClinic, kid])))[0]!.r as unknown as { verificationStatus: string }[];
    expect(hist.map((h) => h.verificationStatus)).toEqual(["verified"]);
    expect((await as(w.lead, (q) => q<R>("select public.list_child_history($1,$2) as r", [w.clinic, kid])))[0]!.r).toBeNull();
    expect((await as(w.g1, (q) => q<R>("select public.guardian_child_history($1) as r", [kid])))[0]!.r).toHaveLength(1); // the guardian's view is unchanged
  });

  it("bookings at the old clinic are cancelled and the family is told once; a visit in progress blocks the move", async () => {
    const kid = await child(w.g1, "Booked Kid");
    await as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: T(2), startTime: "08:00", endTime: "12:00", totalCapacity: 20, onlineCapacity: 20, walkinCapacity: 0 })]));
    const slot = (await admin<{ id: string }>("select id from public.clinic_sessions where clinic_id = $1 and service_date = $2 order by created_at desc limit 1", [w.clinic, T(2)]))[0]!.id;
    const appt = (await as(w.g1, (q) => q<R>("select public.book_appointment($1,$2,$3,null) as r", [op(), kid, slot])))[0]!.r;
    const id = (await reqG(w.g1, kid)).transferId as string;
    await release(w.lead, id);
    // a visit starts at the old clinic
    const ci = (await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'walk-in') as r", [op(), w.clinic, kid])))[0]!.r;
    const called = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, ci.version])))[0]!.r;
    await as(w.assistant, (q) => q("select public.queue_transition($1,$2,$3,'in_service',$4,'S1')", [op(), w.clinic, ci.queueEntryId, called.version]));
    await expectCode(accept(staffB, id), "CV409");
    await admin("update public.encounters set status = 'cancelled' where child_id = $1 and status = 'open'", [kid]);
    await accept(staffB, id);
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [appt.appointmentId]))[0]!.status).toBe("cancelled");
    await admin("select private.process_outbox(300)");
    await admin("select private.process_outbox(300)");
    const box = (await as(w.g1, (q) => q<R>("select public.my_messages(100) as r", [])))[0]!.r as { items: { title: string; body: string }[] };
    expect(box.items.filter((m) => m.title === "Record moved to another clinic" && m.body.includes("Booked Kid"))).toHaveLength(1);
    expect(box.items.some((m) => m.title === "Visit cancelled" && m.body.includes("Booked Kid"))).toBe(true);
  });

  it("is idempotent, including two staff accepting at the same moment", async () => {
    const kid = await child(w.g1, "Race Kid");
    const id = (await reqG(w.g1, kid)).transferId as string;
    await release(w.lead, id);
    const key = op();
    const results = await Promise.allSettled([accept(staffB, id, w.otherClinic, key), accept(staffB, id, w.otherClinic, key)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await count("select count(*) n from public.child_clinic_enrollments where child_id = $1 and clinic_id = $2", [kid, w.otherClinic])).toBe(1);
    const other = await Promise.allSettled([accept(staffB, id, w.otherClinic), accept(staffB, id, w.otherClinic)]);
    expect(other.every((r) => r.status === "rejected")).toBe(true);
  });
});

describe("declining and cancelling", () => {
  it("either clinic or the guardian can stop it before it completes; closed transfers stay closed; a new request is then possible", async () => {
    const kid = await child(w.g1, "Stop Kid");
    let id = (await reqG(w.g1, kid)).transferId as string;
    await expectCode(decline(w.clinician, id, w.clinic), "CV403"); // needs review.resolve at the current clinic
    await expectCode(decline(w.lead, id, w.clinic, " "), "CV422");
    await decline(w.lead, id, w.clinic);
    await expectCode(decline(w.lead, id, w.clinic), "CV409");
    await expectCode(release(w.lead, id), "CV409");
    id = (await reqG(w.g1, kid)).transferId as string;
    await release(w.lead, id);
    await decline(staffB, id, w.otherClinic, "we are not taking new children");
    id = (await reqG(w.g1, kid)).transferId as string;
    await expectCode(as(w.g2, (q) => q("select public.cancel_record_transfer_guardian($1,$2)", [op(), id])), "CV404");
    await as(w.g1, (q) => q("select public.cancel_record_transfer_guardian($1,$2)", [op(), id]));
    await expectCode(as(w.g1, (q) => q("select public.cancel_record_transfer_guardian($1,$2)", [op(), id])), "CV409");
    expect((await enrolled(kid)).map((e) => e.status)).toEqual(["active"]);
    expect(await count("select count(*) n from public.record_transfers where child_id = $1", [kid])).toBe(3);
  });
});

describe("what each side may see", () => {
  it("the receiving clinic sees no child details until the record is released; unrelated clinics see nothing", async () => {
    const kid = await child(w.g1, "Private Move Kid");
    const id = (await reqG(w.g1, kid)).transferId as string;
    let inc = (await lists(staffB, w.otherClinic)).incoming.find((x) => x.id === id)!;
    expect(inc).toMatchObject({ status: "requested", childName: null, recordNo: null, childId: null });
    await release(w.lead, id);
    inc = (await lists(staffB, w.otherClinic)).incoming.find((x) => x.id === id)!;
    expect(inc.childName).toEqual(expect.stringContaining("Private Move Kid"));
    expect(inc.childId).toBeNull(); // no link into the record until accepted
    const out = (await lists(w.assistant, w.clinic)).outgoing.find((x) => x.id === id)!;
    expect(out.childName).toEqual(expect.stringContaining("Private Move Kid"));
    expect((await lists(staffB, w.otherClinic)).clinics.map((c) => c.id)).toEqual([w.clinic]);
    for (const a of [w.inventory, w.g1, w.techAdmin]) await expectCode(lists(a, w.clinic), "CV403");
    await expectCode(lists(w.lead, w.otherClinic), "CV403");
    await expectCode(lists(assistantB, w.clinic), "CV403");
    for (const t of ["public.record_transfers"]) await expectCode(as(w.g1, (q) => q(`select * from ${t}`)), "42501");
    await expectCode(admin("delete from public.record_transfers"), "CV403");
    const mine = (await as(w.g1, (q) => q<R>("select public.my_record_transfers($1) as r", [kid])))[0]!.r as unknown as { transfers: { id: string; status: string }[]; clinics: { id: string }[] };
    expect(mine.transfers[0]).toMatchObject({ id, status: "ready" });
    expect(mine.clinics.map((c) => c.id)).toEqual([w.otherClinic]);
    expect((await as(w.g2, (q) => q<R>("select public.my_record_transfers($1) as r", [kid])))[0]!.r).toBeNull();
    expect(await count("select count(*) n from private.audit_logs where action in ('transfer.requested','transfer.released') and entity_id = $1", [kid])).toBe(2);
  });
});
