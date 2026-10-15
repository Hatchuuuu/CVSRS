import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let bhw: Actor;
type R = { r: Record<string, unknown> };
type Item = { childId: string; childName: string; behind: number; due: number; review: number; needs: { requirement: string; status: string }[]; attempts: number; lastAttempt: { outcome: string } | null; guardian: { name: string; phone: string | null; phoneChecked: boolean } | null };
type Worklist = { schedule: string; staleChildren: number; items: Item[] };
const T = (n: number) => isoDaysFromToday(n);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);
const AGES = [5, 40, 100, 200, 400, 900, 1500];
const kids: { id: string; age: number }[] = [];

async function child(daysOld: number, name: string, guardian?: Actor) {
  if (guardian) {
    const [{ r }] = await as(guardian, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: name, dob: T(-daysOld) })]));
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [guardian.id, r.childId]);
    await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
    return r.childId as string;
  }
  const [{ r }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: name, dob: T(-daysOld) })]));
  return r.childId as string;
}
const refresh = (a: Actor, batch = 200) => as(a, (q) => q<R>("select public.refresh_followup($1,$2,$3) as r", [op(), w.clinic, batch])).then((x) => x[0]!.r as { refreshed: number; remaining: number });
const list = (a: Actor, filter = "behind") => as(a, (q) => q<R>("select public.list_followup_worklist($1,$2,100) as r", [w.clinic, filter])).then((x) => x[0]!.r as unknown as Worklist);
const log = (a: Actor, id: string, outcome = "no_answer", note: string | null = null, next: string | null = null) => as(a, (q) => q("select public.log_followup_attempt($1,$2,$3,$4,$5,$6)", [op(), w.clinic, id, outcome, note, next]));
const evalOf = async (id: string) => (await as(w.clinician, (q) => q<R>("select public.evaluate_child($1,$2,null) as r", [w.clinic, id])))[0]!.r as { status: string; requirements?: { requirement: string; status: string }[] };

beforeAll(async () => {
  w = await clinicalWorld();
  bhw = await newUser("bhw");
  await grant(w.org, w.clinic, bhw, "bhw");
  for (const age of AGES) kids.push({ id: await child(age, `Follow Kid ${age}`, age === 40 ? w.g1 : undefined), age });
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("no schedule, no worklist", () => {
  it("says there is no active schedule and lists nothing instead of guessing", async () => {
    await refresh(w.lead);
    const l = await list(w.lead, "all");
    expect(l.schedule).toBe("none");
    expect(l.items).toEqual([]);
  });
});

describe("the worklist is exactly what the engine says (F10)", () => {
  it("after a schedule is activated, snapshots go stale and the list matches each child's evaluation", async () => {
    await activateDemoSchedule(w, "fu-v1");
    expect((await list(w.lead, "all")).staleChildren).toBeGreaterThanOrEqual(kids.length);
    let guard = 0;
    while ((await refresh(w.lead, 3)).remaining > 0 && guard++ < 20);
    const l = await list(w.lead, "all");
    expect(l.schedule).toBe("active");
    expect(l.staleChildren).toBe(0);
    const byId = new Map(l.items.map((i) => [i.childId, i]));
    for (const k of kids) {
      const ev = await evalOf(k.id);
      const bad = (ev.requirements ?? []).filter((x) => ["overdue", "past_recommended_date", "due_now", "due_today", "staff_review_needed"].includes(x.status));
      const item = byId.get(k.id);
      if (bad.length === 0) expect(item).toBeUndefined();
      else {
        expect(item, `child aged ${k.age}`).toBeDefined();
        expect(item!.needs.map((n) => `${n.requirement}:${n.status}`).sort()).toEqual(bad.map((n) => `${n.requirement}:${n.status}`).sort());
        expect(item!.behind).toBe(bad.filter((x) => ["overdue", "past_recommended_date"].includes(x.status)).length);
      }
    }
    // the filters partition by status
    const behind = await list(w.lead, "behind");
    expect(behind.items.every((i) => i.behind > 0)).toBe(true);
    const due = await list(w.lead, "due");
    expect(due.items.every((i) => i.due > 0)).toBe(true);
    await expectCode(list(w.lead, "everyone"), "CV422");
  });

  it("a newly verified dose (or a hold) makes the stored result stale, and the next refresh drops what is now complete", async () => {
    const l0 = await list(w.lead, "all");
    expect(l0.items.length).toBeGreaterThan(0);
    const target = l0.items.find((i) => i.needs.some((n) => n.requirement === "A1")) ?? l0.items[0]!;
    const before = target.needs.map((n) => `${n.requirement}:${n.status}`);
    await as(w.clinician, (q) => q("select public.record_outside_dose_staff($1,$2,$3,$4,$5,true)", [op(), w.clinic, target.childId, JSON.stringify({ productText: "DEMO-P-ALPHA", administeredOn: T(-1), provider: "Elsewhere" }), w.products["DEMO-P-ALPHA"]]));
    expect((await list(w.lead, "all")).staleChildren).toBeGreaterThanOrEqual(1);
    await refresh(w.lead, 200);
    const ev = await evalOf(target.childId);
    const nowBad = (ev.requirements ?? []).filter((x) => ["overdue", "past_recommended_date", "due_now", "due_today", "staff_review_needed"].includes(x.status)).map((x) => `${x.requirement}:${x.status}`).sort();
    const item = (await list(w.lead, "all")).items.find((i) => i.childId === target.childId);
    expect(item ? item.needs.map((n) => `${n.requirement}:${n.status}`).sort() : []).toEqual(nowBad);
    expect(nowBad).not.toEqual([...before].sort());
  });

  it("refresh is bounded, idempotent per key, and only for staff who follow families up", async () => {
    await admin("update public.followup_snapshots set computed_at = now() - interval '2 days'");
    const key = op();
    const call = () => as(w.lead, (q) => q<R>("select public.refresh_followup($1,$2,2) as r", [key, w.clinic])).then((x) => x[0]!.r as { refreshed: number });
    const [a, b] = await Promise.all([call(), call()]);
    expect(a.refreshed).toBe(2);
    expect(b.refreshed).toBe(2);
    for (const a2 of [w.assistant, w.inventory, w.g1, w.otherClinicStaff, { ...w.lead, aal: "aal1" as const }]) await expectCode(refresh(a2), "CV403");
    let guard = 0;
    while ((await refresh(w.lead, 200)).remaining > 0 && guard++ < 10);
  });
});

describe("who can see the list and the contact details", () => {
  it("nurses and community health workers can list it; only the health worker sees phone numbers; others cannot", async () => {
    const guardianChildId = kids.find((k) => k.age === 40)!.id;
    await as(w.g1, (q) => q("select public.set_contact_preferences($1,null,'0917 777 8888',null)", [op()]));
    const gid = (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [w.g1.id]))[0]!.id;
    await as(w.assistant, (q) => q("select public.verify_guardian_contact($1,$2,$3)", [op(), w.clinic, gid]));
    const asBhw = (await list(bhw, "all")).items.find((i) => i.childId === guardianChildId);
    const asNurse = (await list(w.clinician, "all")).items.find((i) => i.childId === guardianChildId);
    expect(asBhw, "the guardian's child is on the worklist").toBeDefined();
    expect(asBhw!.guardian).toMatchObject({ phone: "09177778888", phoneChecked: true });
    expect(asNurse!.guardian!.phone).toBeNull();
    for (const a of [w.assistant, w.inventory, w.techAdmin, w.g1, w.otherClinicStaff]) await expectCode(list(a), "CV403");
    expect(await count("select count(*) n from private.audit_logs where action = 'followup.listed'")).toBeGreaterThan(3);
    await expectCode(as(w.g1, (q) => q("select * from public.followup_snapshots")), "42501");
    await expectCode(as(null, (q) => q("select public.list_followup_worklist($1,'all',10)", [w.clinic])), "42501");
  });
});

describe("outreach log", () => {
  it("records attempts append-only; a next-try date hides the child until then; outcomes and dates are validated", async () => {
    const target = (await list(w.lead, "all")).items[0]!;
    await expectCode(log(w.lead, target.childId, "spoke"), "CV422");
    await expectCode(log(w.lead, target.childId, "no_answer", null, T(0)), "CV422");
    await expectCode(log(w.lead, target.childId, "no_answer", null, T(400)), "CV422");
    await expectCode(log(w.assistant, target.childId), "CV403");
    await expectCode(log(w.otherClinicStaff, target.childId), "CV403");
    await expectCode(as(bhw, (q) => q<R>("select public.log_followup_attempt($1,$2,$3,'reached','spoke to mother',null) as r", [op(), w.clinic, crypto.randomUUID()])), "CV404");
    await log(bhw, target.childId, "reached", "spoke to the mother, will come Monday");
    const after = (await list(bhw, "all")).items.find((i) => i.childId === target.childId)!;
    expect(after.attempts).toBe(1);
    expect(after.lastAttempt).toMatchObject({ outcome: "reached" });
    await log(bhw, target.childId, "no_answer", "phone off", T(7));
    expect((await list(bhw, "all")).items.find((i) => i.childId === target.childId)).toBeUndefined(); // snoozed
    expect(await count("select count(*) n from public.followup_attempts where child_id = $1", [target.childId])).toBe(2);
    await admin("update public.followup_attempts set next_try_on = null where child_id = $1", [target.childId]).catch((e: { code?: string }) => expect(e.code).toBe("CV403"));
    await expectCode(admin("delete from public.followup_attempts"), "CV403");
    const key = op();
    await Promise.all([1, 2].map(() => as(bhw, (q) => q("select public.log_followup_attempt($1,$2,$3,'other','dup check',null)", [key, w.clinic, target.childId]))));
    expect(await count("select count(*) n from public.followup_attempts where operation_id = $1", [key])).toBe(1);
  });
});

describe("clinical holds (F09)", () => {
  const place = (a: Actor, id: string, reason = "clinician review pending", note: string | null = "restricted detail", on: string | null = null, rule: string | null = null) =>
    as(a, (q) => q<R>("select public.place_clinical_hold($1,$2,$3,$4,$5,$6,$7) as r", [op(), w.clinic, id, reason, note, on, rule])).then((x) => x[0]!.r);
  const holds = (a: Actor, id: string) => as(a, (q) => q<R>("select public.list_clinical_holds($1,$2) as r", [w.clinic, id])).then((x) => x[0]!.r as unknown as { id: string; status: string; note: string | null; reason: string; resolutionNote: string | null }[]);

  it("clinical staff place a hold, the engine flags every requirement for review, and only a clinical lead releases it", async () => {
    const id = kids.find((k) => k.age === 1500)!.id;
    for (const a of [w.assistant, w.inventory, w.g1, w.otherClinicStaff]) await expectCode(place(a, id), "CV403");
    await expectCode(place(w.clinician, id, "x"), "CV422");
    await expectCode(place(w.clinician, id, "valid reason", null, T(-1)), "CV422");
    await expectCode(place(w.clinician, id, "valid reason", null, null, crypto.randomUUID()), "CV422");
    const h = await place(w.clinician, id);
    await expectCode(place(w.clinician, id), "CV409"); // same hold twice
    const ev = await evalOf(id);
    expect(ev.requirements!.every((x) => x.status === "staff_review_needed")).toBe(true);
    expect((await holds(w.clinician, id))[0]).toMatchObject({ status: "active", note: "restricted detail" });
    await expectCode(as(w.clinician, (q) => q("select public.release_clinical_hold($1,$2,$3,'cleared')", [op(), w.clinic, h.holdId])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.release_clinical_hold($1,$2,$3,' ')", [op(), w.clinic, h.holdId])), "CV422");
    await as(w.lead, (q) => q("select public.release_clinical_hold($1,$2,$3,'reviewed by the clinician, cleared')", [op(), w.clinic, h.holdId]));
    await expectCode(as(w.lead, (q) => q("select public.release_clinical_hold($1,$2,$3,'again')", [op(), w.clinic, h.holdId])), "CV409");
    expect((await holds(w.clinician, id))[0]).toMatchObject({ status: "resolved", resolutionNote: "reviewed by the clinician, cleared" });
    expect((await evalOf(id)).requirements!.some((x) => x.status !== "staff_review_needed")).toBe(true);
    expect(await count("select count(*) n from private.audit_logs where action in ('hold.placed','hold.released') and entity_id = $1", [id])).toBe(2);
  });

  it("recording a vaccine for a child under a hold is refused; guardians never see the hold's notes", async () => {
    const id = kids.find((k) => k.age === 40)!.id;
    const h = await place(w.clinician, id, "waiting for clinician advice", "private note text");
    const [{ r: g }] = await as(w.g1, (q) => q<R>("select public.guardian_get_schedule($1) as r", [id]));
    expect(JSON.stringify(g)).not.toMatch(/private note text|waiting for clinician advice/);
    const stage = await admin<{ n: string }>("select count(*) n from public.clinical_holds where child_id = $1 and status = 'active'", [id]);
    expect(Number(stage[0]!.n)).toBe(1);
    await expectCode(as(w.g1, (q) => q("select public.list_clinical_holds($1,$2)", [w.clinic, id])), "CV403");
    await as(w.lead, (q) => q("select public.release_clinical_hold($1,$2,$3,'cleared')", [op(), w.clinic, h.holdId]));
  });
});

describe("privacy notice gate (F04)", () => {
  const TEXT = "This clinic keeps your child's vaccination records to give care. Only clinic staff and you can see them. Ask the clinic if you want them corrected.";
  const setNotice = (a: Actor, v = "2026-10", t = TEXT) => as(a, (q) => q("select public.set_privacy_notice($1,$2,$3,$4)", [op(), w.clinic, v, t]));
  const getNotice = (a: Actor) => as(a, (q) => q<R>("select public.get_privacy_notice($1) as r", [w.clinic])).then((x) => x[0]!.r as { configured: boolean; version?: string; text?: string; acknowledged: boolean });
  const ack = (a: Actor) => as(a, (q) => q<R>("select public.acknowledge_clinic_privacy_notice($1,$2) as r", [op(), w.clinic])).then((x) => x[0]!.r);
  const addChild = (a: Actor) => as(a, (q) => q("select public.create_child_provisional($1,$2,$3)", [op(), w.clinic, JSON.stringify({ displayName: "Gate Kid", dob: T(-30) })]));

  it("without a configured notice nothing changes; the notice text comes only from the clinic", async () => {
    expect(await getNotice(w.g2)).toEqual({ configured: false, acknowledged: true });
    await addChild(w.g2);
    await expectCode(ack(w.g2), "CV409");
  });

  it("only admin.config can set it, with a version and real text; a changed text needs a new version", async () => {
    for (const a of [w.lead, w.clinician, w.assistant, w.g1]) await expectCode(setNotice(a), "CV403");
    await expectCode(setNotice(w.techAdmin, "", TEXT), "CV422");
    await expectCode(setNotice(w.techAdmin, "v1", "too short"), "CV422");
    await setNotice(w.techAdmin);
    await expectCode(setNotice(w.techAdmin, "2026-10", TEXT + " More."), "CV409");
    expect(await getNotice(w.g2)).toMatchObject({ configured: true, version: "2026-10", text: TEXT, acknowledged: false });
  });

  it("guardians must accept the current version before adding a child or asking to link one; staff registration is not blocked", async () => {
    await expectCode(addChild(w.g2), "CV409");
    await expectCode(as(w.g2, (q) => q("select public.request_guardian_link($1,$2,$3,'mother')", [op(), w.clinic, JSON.stringify({ childName: "Someone", dob: T(-100) })])), "CV409");
    await child(20, "Staff Registered Anyway");
    const r = await ack(w.g2);
    expect(r).toMatchObject({ version: "2026-10", acknowledged: true });
    await ack(w.g2); // idempotent for the same version
    expect(await count("select count(*) n from public.privacy_records pr join public.guardians g on g.id = pr.guardian_id where g.profile_id = $1 and pr.notice_version = '2026-10'", [w.g2.id])).toBe(1);
    await addChild(w.g2);
    expect((await getNotice(w.g2)).acknowledged).toBe(true);
    // a new version must be accepted again
    await setNotice(w.techAdmin, "2026-11", TEXT + " We now also keep appointment records.");
    expect((await getNotice(w.g2)).acknowledged).toBe(false);
    await expectCode(addChild(w.g2), "CV409");
    await ack(w.g2);
    await addChild(w.g2);
    expect(await count("select count(*) n from private.audit_logs where action = 'privacy.acknowledged'")).toBeGreaterThanOrEqual(2);
  });

  it("get_pending_privacy_notices returns batch unacknowledged notices for guardians", async () => {
    // With notice version 2026-11 already acknowledged above by w.g2, set a new version 2026-12
    await setNotice(w.techAdmin, "2026-12", TEXT + " Updated for winter 2026.");
    const pendingBefore = await as(w.g2, (q) => q<R>("select public.get_pending_privacy_notices() as r")).then((x) => x[0]!.r as unknown as Array<{ clinicId: string; version: string }>);
    expect(pendingBefore.some((p) => p.clinicId === w.clinic && p.version === "2026-12")).toBe(true);
    await ack(w.g2);
    const pendingAfter = await as(w.g2, (q) => q<R>("select public.get_pending_privacy_notices() as r")).then((x) => x[0]!.r as unknown as Array<{ clinicId: string; version: string }>);
    expect(pendingAfter.some((p) => p.clinicId === w.clinic)).toBe(false);
  });

  it("the original commands can no longer be called around the gate", async () => {
    await expectCode(as(w.g1, (q) => q("select public.create_child_provisional_base($1,$2,$3,'mother')", [op(), w.clinic, JSON.stringify({ displayName: "Bypass", dob: T(-30) })])), "42501");
    await expectCode(as(w.g1, (q) => q("select public.request_guardian_link_base($1,$2,$3,'mother')", [op(), w.clinic, JSON.stringify({})])), "42501");
  });
});
