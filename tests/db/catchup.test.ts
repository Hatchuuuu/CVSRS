import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let seq = 0;
type R = { r: Record<string, unknown> };
type Plan = { id: string; status: string; rationale?: string; policyReference?: string; items: { id: string; label: string; status: string; statusNote?: string | null }[]; reviewNote?: string };
const T = (n: number) => isoDaysFromToday(n);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);
const ITEMS = [{ label: "First planned dose (as named by the clinician)", targetDate: T(14), note: "with the next visit" }, { label: "Second planned dose", productId: "" }];

async function guardianChild(g: Actor, name: string) {
  const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, dob: T(-400) })]));
  await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
  const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [g.id, r.childId]);
  await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
  return r.childId as string;
}
const items = (n = 2) => JSON.stringify(ITEMS.slice(0, n).map((i) => ({ ...i, productId: i.productId || undefined })));
const draft = (a: Actor, child: string, planId: string | null = null, rationale = "Missed visits while the family was away; clinician advised a catch-up.", ref = "Clinic advice note 2026-09", it = items()) =>
  as(a, (q) => q<R>("select public.save_catchup_draft($1,$2,$3,$4,$5,$6,$7) as r", [op(), w.clinic, child, planId, rationale, ref, it])).then((x) => x[0]!.r);
const submit = (a: Actor, id: string) => as(a, (q) => q("select public.submit_catchup_plan($1,$2,$3)", [op(), w.clinic, id]));
const review = (a: Actor, id: string, decision: string, note: string | null = null) => as(a, (q) => q("select public.review_catchup_plan($1,$2,$3,$4,$5)", [op(), w.clinic, id, decision, note]));
const plansOf = (a: Actor, child: string) => as(a, (q) => q<R>("select public.list_catchup_plans($1,$2) as r", [w.clinic, child])).then((x) => x[0]!.r as unknown as Plan[]);
const guardianPlan = (a: Actor, child: string) => as(a, (q) => q<R>("select public.guardian_get_catchup_plan($1) as r", [child])).then((x) => x[0]!.r as unknown as Plan | null);
const approved = async (child: string, author = w.clinician, reviewer = w.lead) => {
  const p = await draft(author, child);
  await submit(author, p.planId as string);
  await review(reviewer, p.planId as string, "approve");
  return p.planId as string;
};

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "cu-v1");
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("catch-up plans are written and approved by people, never generated (F11)", () => {
  it("clinical staff can draft; nobody else can, and the child must belong to the clinic", async () => {
    const kid = await guardianChild(w.g1, "Plan Kid");
    for (const a of [w.assistant, w.inventory, w.techAdmin, w.g1, w.otherClinicStaff, { ...w.clinician, aal: "aal1" as const }]) await expectCode(draft(a, kid), "CV403");
    await expectCode(as(w.clinician, (q) => q<R>("select public.save_catchup_draft($1,$2,$3,null,'a long enough rationale','ref',$4) as r", [op(), w.clinic, crypto.randomUUID(), items()])), "CV404");
    await expectCode(draft(w.clinician, kid, null, "short", "ref"), "CV422");
    await expectCode(draft(w.clinician, kid, null, "a long enough rationale here", " "), "CV422");
    await expectCode(draft(w.clinician, kid, null, "a long enough rationale here", "ref", "[]"), "CV422");
    await expectCode(draft(w.clinician, kid, null, "a long enough rationale here", "ref", JSON.stringify([{ label: " " }])), "CV422");
    await expectCode(draft(w.clinician, kid, null, "a long enough rationale here", "ref", JSON.stringify([{ label: "x", productId: crypto.randomUUID() }])), "CV422");
    const p = await draft(w.clinician, kid);
    expect(p.status).toBe("draft");
    await expectCode(draft(w.clinician, kid), "CV409"); // one plan in preparation at a time
    expect((await plansOf(w.lead, kid))[0]).toMatchObject({ status: "draft", rationale: expect.stringContaining("Missed visits"), policyReference: "Clinic advice note 2026-09" });
  });

  it("only the author edits a draft; items freeze on submission; the author cannot approve their own plan", async () => {
    const kid = await guardianChild(w.g1, "Freeze Kid");
    const p = await draft(w.clinician, kid);
    const id = p.planId as string;
    await expectCode(draft(w.lead, kid, id), "CV403"); // another clinician cannot edit someone's draft
    const edited = await draft(w.clinician, kid, id, "Updated rationale for this plan.", "Advice v2", JSON.stringify([{ label: "Only item" }]));
    expect(edited.planId).toBe(id);
    expect((await plansOf(w.lead, kid))[0]!.items.map((i) => i.label)).toEqual(["Only item"]);
    await expectCode(submit(w.lead, id), "CV403"); // only the author submits
    await submit(w.clinician, id);
    await expectCode(submit(w.clinician, id), "CV409");
    await expectCode(draft(w.clinician, kid, id), "CV409");
    await expectCode(admin("update public.catchup_plan_items set label = 'changed' where plan_id = $1", [id]), "CV403");
    await expectCode(admin("delete from public.catchup_plan_items where plan_id = $1", [id]), "CV403");
    await expectCode(admin("insert into public.catchup_plan_items (organization_id, plan_id, seq, label) values ($1,$2,9,'sneaky')", [w.org, id]), "CV403");
    await expectCode(admin("update public.catchup_plan_items set status = 'done' where plan_id = $1", [id]), "CV403"); // not approved yet
    await expectCode(admin("delete from public.catchup_plans where id = $1", [id]), "CV403");
    await expectCode(review(w.clinician, id, "approve"), "CV403"); // no rules.approve
    await expectCode(review(w.assistant, id, "approve"), "CV403");
    await expectCode(review(w.lead, id, "maybe"), "CV422");
    await expectCode(review(w.lead, id, "reject", " "), "CV422");
    // the approver cannot be the author
    const own = await draft(w.lead, await guardianChild(w.g2, "Own Kid"));
    await submit(w.lead, own.planId as string);
    await expectCode(review(w.lead, own.planId as string, "approve"), "CV403");
    await review(w.lead2, own.planId as string, "approve");
  });

  it("rejection needs a reason and keeps the plan on record; approval supersedes the previous approved plan", async () => {
    const kid = await guardianChild(w.g1, "Review Kid");
    const p1 = await draft(w.clinician, kid);
    await submit(w.clinician, p1.planId as string);
    await review(w.lead, p1.planId as string, "reject", "Interval is not what the advice note says");
    expect((await plansOf(w.lead, kid))[0]).toMatchObject({ status: "rejected", reviewNote: "Interval is not what the advice note says" });
    await expectCode(review(w.lead, p1.planId as string, "approve"), "CV409");
    const first = await approved(kid);
    const second = await approved(kid);
    const all = await plansOf(w.lead, kid);
    expect(all.find((x) => x.id === first)!.status).toBe("superseded");
    expect(all.find((x) => x.id === second)!.status).toBe("approved");
    expect(all.filter((x) => x.status === "approved")).toHaveLength(1);
    expect(await count("select count(*) n from private.audit_logs where action in ('catchup.approved','catchup.rejected','catchup.drafted','catchup.submitted') and entity_id = any($1)", [[p1.planId, first, second]])).toBeGreaterThanOrEqual(8);
  });

  it("marking items done or dropped needs a note, works only on the approved plan, and only once per item", async () => {
    const kid = await guardianChild(w.g1, "Item Kid");
    const id = await approved(kid);
    const plan = (await plansOf(w.lead, kid)).find((x) => x.id === id)!;
    const [a, b] = plan.items;
    const mark = (actor: Actor, item: string, st: string, note: string | null) => as(actor, (q) => q("select public.set_catchup_item_status($1,$2,$3,$4,$5)", [op(), w.clinic, item, st, note]));
    await expectCode(mark(w.assistant, a!.id, "done", "given"), "CV403");
    await expectCode(mark(w.clinician, a!.id, "done", " "), "CV422");
    await expectCode(mark(w.clinician, a!.id, "skipped", "x"), "CV422");
    await mark(w.clinician, a!.id, "done", "given at the clinic visit");
    await expectCode(mark(w.clinician, a!.id, "dropped", "changed mind"), "CV409");
    await mark(w.lead, b!.id, "dropped", "family moved away");
    const after = (await plansOf(w.lead, kid)).find((x) => x.id === id)!;
    expect(after.items.map((i) => i.status)).toEqual(["done", "dropped"]);
    // a plan that is no longer approved cannot have items marked
    await as(w.lead, (q) => q("select public.cancel_catchup_plan($1,$2,$3,'replaced by advice')", [op(), w.clinic, id]));
    await expectCode(mark(w.clinician, a!.id, "done", "again"), "CV409");
  });

  it("cancelling: the author or an approver may; closed plans stay closed", async () => {
    const kid = await guardianChild(w.g1, "Cancel Kid");
    const p = await draft(w.clinician, kid);
    await expectCode(as(w.assistant, (q) => q("select public.cancel_catchup_plan($1,$2,$3,'no')", [op(), w.clinic, p.planId])), "CV403");
    await expectCode(as(w.clinician, (q) => q("select public.cancel_catchup_plan($1,$2,$3,' ')", [op(), w.clinic, p.planId])), "CV422");
    await as(w.clinician, (q) => q("select public.cancel_catchup_plan($1,$2,$3,'written for the wrong child')", [op(), w.clinic, p.planId]));
    await expectCode(as(w.lead, (q) => q("select public.cancel_catchup_plan($1,$2,$3,'again')", [op(), w.clinic, p.planId])), "CV409");
    const q2 = await draft(w.clinician, kid);
    await as(w.lead, (q) => q("select public.cancel_catchup_plan($1,$2,$3,'approver withdraws it')", [op(), w.clinic, q2.planId]));
  });

  it("does not touch the schedule engine: no evaluation change, no dose credit, no booking", async () => {
    const kid = await guardianChild(w.g2, "Engine Kid");
    const evalOf = async () => JSON.stringify(((await as(w.clinician, (q) => q<R>("select public.evaluate_child($1,$2,null) as r", [w.clinic, kid])))[0]!.r as { requirements?: unknown }).requirements ?? null);
    const before = { e: await evalOf(), credits: await count("select count(*) n from public.dose_credits"), appts: await count("select count(*) n from public.appointments"), revs: await count("select count(*) n from public.vaccination_revisions") };
    await approved(kid);
    expect(await evalOf()).toBe(before.e);
    expect(await count("select count(*) n from public.dose_credits")).toBe(before.credits);
    expect(await count("select count(*) n from public.appointments")).toBe(before.appts);
    expect(await count("select count(*) n from public.vaccination_revisions")).toBe(before.revs);
  });

  it("guardians see only the approved plan, without the clinical reasoning; others see nothing; the family is told once", async () => {
    const kid = await guardianChild(w.g1, "Family Kid");
    expect(await guardianPlan(w.g1, kid)).toBeNull();
    const p = await draft(w.clinician, kid);
    await submit(w.clinician, p.planId as string);
    expect(await guardianPlan(w.g1, kid)).toBeNull(); // not approved yet
    await review(w.lead, p.planId as string, "approve");
    const view = (await guardianPlan(w.g1, kid))!;
    expect(view.status).toBe("approved");
    expect(view.items.map((i) => i.label)).toContain("Second planned dose");
    expect(JSON.stringify(view)).not.toMatch(/Missed visits|Clinic advice note|rationale|policyReference|statusNote/);
    expect(await guardianPlan(w.g2, kid)).toBeNull();
    await admin("select private.process_outbox(200)");
    await admin("select private.process_outbox(200)");
    const box = (await as(w.g1, (q) => q<R>("select public.my_messages(100) as r", [])))[0]!.r as { items: { title: string; body: string }[] };
    expect(box.items.filter((m) => m.title === "Care plan from the clinic" && m.body.includes("Family Kid"))).toHaveLength(1);
    await expectCode(as(null, (q) => q("select public.guardian_get_catchup_plan($1)", [kid])), "42501");
    for (const t of ["public.catchup_plans", "public.catchup_plan_items"]) await expectCode(as(w.g1, (q) => q(`select * from ${t}`)), "42501");
  });

  it("the review list shows only submitted plans, to approvers only", async () => {
    const kid = await guardianChild(w.g1, "Queue Kid");
    const p = await draft(w.clinician, kid);
    const list = () => as(w.lead2, (q) => q<R>("select public.list_catchup_reviews($1) as r", [w.clinic])).then((x) => x[0]!.r as unknown as { planId: string; childName: string }[]);
    expect((await list()).map((x) => x.planId)).not.toContain(p.planId);
    await submit(w.clinician, p.planId as string);
    expect((await list()).find((x) => x.planId === p.planId)).toMatchObject({ childName: expect.stringContaining("Queue Kid") });
    await expectCode(as(w.clinician, (q) => q("select public.list_catchup_reviews($1)", [w.clinic])), "CV403");
    await expectCode(as(w.otherClinicStaff, (q) => q("select public.list_catchup_reviews($1)", [w.clinic])), "CV403");
  });
});

describe("staffed check-ins (F20)", () => {
  const NOTICE = "This form is not watched around the clock. If your child seems very unwell, go to the nearest emergency service.";
  let kid: string;
  const checkin = (a: Actor, child: string, cat = "question", msg = "Can we change our visit day?") => as(a, (q) => q<R>("select public.create_checkin($1,$2,$3,$4) as r", [op(), child, cat, msg])).then((x) => x[0]!.r);
  const policy = (a: Actor, enabled: boolean, notice: string | null = NOTICE) => as(a, (q) => q("select public.set_checkin_policy($1,$2,$3,$4)", [op(), w.clinic, enabled, notice]));
  const listOpen = (a: Actor, st = "open") => as(a, (q) => q<R>("select public.list_checkins($1,$2) as r", [w.clinic, st])).then((x) => x[0]!.r as unknown as { id: string; category: string; message: string; childName: string; status: string; answer: string | null }[]);
  const answer = (a: Actor, id: string, text = "Yes, please come on Tuesday.") => as(a, (q) => q("select public.answer_checkin($1,$2,$3,$4)", [op(), w.clinic, id, text]));

  it("is off until the clinical lead records the safety notice; nothing has default wording", async () => {
    kid = await guardianChild(w.g1, "Checkin Kid");
    await expectCode(checkin(w.g1, kid), "CV409");
    expect((await as(w.lead, (q) => q<R>("select public.get_checkin_policy($1) as r", [w.clinic])))[0]!.r).toEqual({ enabled: false, safetyNotice: "" });
    await expectCode(policy(w.assistant, true), "CV403");
    await expectCode(policy(w.clinician, true), "CV403");
    await expectCode(policy(w.lead, true, "too short"), "CV422");
    await expectCode(policy(w.lead, true, null), "CV422");
    await policy(w.lead, true);
    expect((await as(w.lead, (q) => q<R>("select public.get_checkin_policy($1) as r", [w.clinic])))[0]!.r).toEqual({ enabled: true, safetyNotice: NOTICE });
    expect((await as(w.g1, (q) => q<R>("select public.my_checkins($1) as r", [kid])))[0]!.r).toMatchObject({ enabled: true, safetyNotice: NOTICE, items: [] });
  });

  it("a linked guardian can ask; the clinic's own safety notice comes back with the receipt; input is validated and limited", async () => {
    const r = await checkin(w.g1, kid, "after_vaccination", "Our baby has a red arm since yesterday.");
    expect(r).toMatchObject({ safetyNotice: NOTICE });
    await expectCode(checkin(w.g1, kid, "emergency", "x y z"), "CV422");
    await expectCode(checkin(w.g1, kid, "question", " "), "CV422");
    await expectCode(checkin(w.g2, kid), "CV404"); // not this child's guardian
    await expectCode(as(null, (q) => q("select public.create_checkin($1,$2,'question','hello')", [op(), kid])), "42501");
    await checkin(w.g1, kid);
    await checkin(w.g1, kid);
    await expectCode(checkin(w.g1, kid), "CV409"); // at most three waiting
  });

  it("staff see them (vaccination-related first, no automatic triage), audited; only clinical staff may", async () => {
    const open = await listOpen(w.clinician);
    expect(open[0]).toMatchObject({ category: "after_vaccination", message: "Our baby has a red arm since yesterday." });
    expect(open.every((x) => x.answer === null && x.status === "open")).toBe(true);
    for (const a of [w.assistant, w.inventory, w.g1, w.otherClinicStaff]) await expectCode(listOpen(a), "CV403");
    await expectCode(listOpen(w.clinician, "weird"), "CV422");
    expect(await count("select count(*) n from private.audit_logs where action = 'checkin.list'")).toBeGreaterThan(0);
    const backlog = (await as(w.lead, (q) => q<R>("select public.report_backlog($1) as r", [w.clinic])))[0]!.r as { openCheckins: number; plansAwaitingReview: number };
    expect(backlog.openCheckins).toBe(open.length);
    expect(backlog.plansAwaitingReview).toBeGreaterThanOrEqual(0);
  });

  it("a person answers; the reply reaches the guardian only; it cannot be answered twice", async () => {
    const [first] = await listOpen(w.clinician);
    await expectCode(answer(w.assistant, first!.id), "CV403");
    await expectCode(answer(w.clinician, first!.id, " "), "CV422");
    await expectCode(answer(w.clinician, first!.id, "x".repeat(501)), "CV422");
    await answer(w.clinician, first!.id, "Please bring your child to the clinic today so a nurse can look.");
    await expectCode(answer(w.lead, first!.id), "CV409");
    const mine = ((await as(w.g1, (q) => q<R>("select public.my_checkins($1) as r", [kid])))[0]!.r as { items: { status: string; answer: string | null }[] }).items;
    expect(mine.find((x) => x.status === "answered")!.answer).toContain("bring your child");
    const box = (await as(w.g1, (q) => q<R>("select public.my_messages(50) as r", [])))[0]!.r as { items: { title: string; body: string }[] };
    expect(box.items.some((m) => m.title === "The clinic replied" && m.body.includes("Checkin Kid"))).toBe(true);
    expect(await as(w.g2, (q) => q<R>("select public.my_checkins($1) as r", [kid])).then((x) => x[0]!.r)).toBeNull();
    const other = (await as(w.g2, (q) => q<R>("select public.my_messages(100) as r", [])))[0]!.r as { items: { title: string }[] };
    expect(other.items.some((m) => m.title === "The clinic replied")).toBe(false);
  });

  it("turning it off stops new questions but keeps the history; the tables are protected and undeletable", async () => {
    await policy(w.lead, false, null);
    await expectCode(checkin(w.g1, kid), "CV409");
    expect(((await as(w.g1, (q) => q<R>("select public.my_checkins($1) as r", [kid])))[0]!.r as { enabled: boolean; items: unknown[] })).toMatchObject({ enabled: false });
    expect(((await as(w.g1, (q) => q<R>("select public.my_checkins($1) as r", [kid])))[0]!.r as { items: unknown[] }).items.length).toBeGreaterThan(1);
    await expectCode(as(w.g1, (q) => q("select * from public.checkins")), "42501");
    await expectCode(admin("delete from public.checkins"), "CV403");
  });
});
