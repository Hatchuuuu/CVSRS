import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
type R = { r: Record<string, unknown> };
type Req = { requirement: string; status: string; creditedOn: string | null; creditedDoseId: string | null; reasons: { code: string }[] };
type Sched = { status: string; evaluationId?: string; pendingEvidence: number; requirements: Req[]; versionLabel: string; isDemo: boolean };

const T = (n: number) => isoDaysFromToday(n);
let seq = 0;

/** Verified, clinic-enrolled child with exact DOB and (optionally) a verified guardian account. */
async function child(name: string, dobDaysAgo: number | null, guardian?: Actor, verifyGuardian = true) {
  const dob = dobDaysAgo === null ? undefined : T(-dobDaysAgo);
  let id: string;
  if (guardian) {
    const [{ r }] = await as(guardian, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, ...(dob ? { dob } : {}) })]));
    id = r.childId as string;
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, id]));
    if (verifyGuardian) {
      const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [guardian.id, id]);
      await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
    }
  } else {
    const [{ r }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, ...(dob ? { dob } : {}) })]));
    id = r.childId as string;
  }
  return id;
}
const evaluate = async (a: Actor, id: string, asOf?: string, clinic = w.clinic) =>
  (await as(a, (q) => q<{ r: Sched | null }>("select public.evaluate_child($1,$2,$3) as r", [clinic, id, asOf ?? null])))[0]!.r;
const status = (s: Sched, req: string) => s.requirements.find((x) => x.requirement === req)!.status;
const verifiedDose = (id: string, productCode: string, on: string) =>
  as(w.clinician, (q) => q<R>("select public.record_outside_dose_staff($1,$2,$3,$4,$5,true) as r", [op(), w.clinic, id, JSON.stringify({ productText: productCode, administeredOn: on, provider: "Demo Clinic X" }), w.products[productCode]]));

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "ev-v1");
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("evaluation access and honesty", () => {
  it("returns 'no active schedule' rather than inventing dates when nothing is approved", async () => {
    const w2 = await clinicalWorld(); // has master data but NO active schedule
    const [{ r }] = await as(w2.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w2.clinic, JSON.stringify({ displayName: "No Schedule Child", dob: T(-40) })]));
    const res = (await as(w2.clinician, (q) => q<{ r: Sched }>("select public.evaluate_child($1,$2) as r", [w2.clinic, r.childId])))[0]!.r;
    expect(res.status).toBe("no_active_schedule");
    expect(res.requirements).toBeUndefined();
  });

  it("requires child.read_clinical at the child's clinic; foreign-clinic children are indistinguishable from missing", async () => {
    const id = await child("Scope", 40);
    await expectCode(evaluate(w.assistant, id), "CV403");
    await expectCode(evaluate(w.inventory, id), "CV403");
    await expectCode(evaluate(w.otherClinicStaff, id), "CV403"); // member of another clinic only
    expect(await evaluate(w.otherClinicStaff, id, undefined, w.otherClinic)).toBeNull(); // child not enrolled there
    expect(await evaluate(w.clinician, crypto.randomUUID())).toBeNull();
    await expectCode(as({ ...w.clinician, aal: "aal1" }, (q) => q("select public.evaluate_child($1,$2)", [w.clinic, id])), "CV403");
  });

  it("marks everything for staff review when the birth date is not exact, instead of guessing", async () => {
    const id = await child("Unknown Dob", null);
    const res = (await evaluate(w.clinician, id))!;
    expect(res.requirements.every((x) => x.status === "staff_review_needed" && x.reasons[0]!.code === "birth_date_not_exact")).toBe(true);
  });

  it("computes statuses from the pinned schedule and labels demo rules", async () => {
    const id = await child("Basic", 40);
    const res = (await evaluate(w.clinician, id))!;
    expect(res.isDemo).toBe(true);
    expect(res.versionLabel).toBe("ev-v1");
    expect(status(res, "A1")).toBe("overdue");
    expect(status(res, "A2")).toBe("not_yet_eligible");
    expect(status(res, "G1")).toBe("due_now");
    expect(status(res, "B1")).toBe("upcoming");
  });
});

describe("determinism and pinned snapshots (BP16 step 6)", () => {
  it("same inputs -> same stored evaluation; new facts -> new evaluation; old one is retained", async () => {
    const id = await child("Determinism", 40);
    const a = (await evaluate(w.clinician, id))!;
    const b = (await evaluate(w.clinician, id))!;
    expect(b.evaluationId).toBe(a.evaluationId);
    await verifiedDose(id, "DEMO-P-ALPHA", T(-30));
    const c = (await evaluate(w.clinician, id))!;
    expect(c.evaluationId).not.toBe(a.evaluationId);
    expect(status(c, "A1")).toBe("completed");
    const n = await admin<{ n: string }>("select count(*) n from public.schedule_evaluations where child_id = $1", [id]);
    expect(Number(n[0]!.n)).toBe(2);
    // stored evaluation cannot be altered
    await expect(admin("update public.schedule_evaluations set result = '{}' where id = $1", [a.evaluationId])).rejects.toMatchObject({ code: "CV403" });
    await expect(admin("delete from public.dose_credits")).rejects.toMatchObject({ code: "CV403" });
  });
});

describe("outside evidence never becomes credit without verification (T09)", () => {
  it("guardian report is pending: no credit, no clinic-verified label; verification adds credit through a new revision", async () => {
    const id = await child("Evidence", 40, w.g1);
    const [{ r }] = await as(w.g1, (q) => q<R>("select public.report_outside_dose($1,$2,$3) as r", [op(), id, JSON.stringify({ productText: "shot given at private clinic", administeredOn: T(-30), provider: "Private clinic" })]));
    expect(r.verificationStatus).toBe("pending_verification");

    const before = (await evaluate(w.clinician, id))!;
    expect(before.pendingEvidence).toBe(1);
    expect(status(before, "A1")).toBe("overdue"); // the report earned nothing

    // assistants cannot verify; a clinician must map it to an approved product
    await expectCode(as(w.assistant, (q) => q("select public.verify_outside_dose($1,$2,$3,'verify',$4,null,null)", [op(), w.clinic, r.eventId, w.products["DEMO-P-ALPHA"]])), "CV403");
    await expectCode(as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'verify',null,null,null)", [op(), w.clinic, r.eventId])), "CV422");
    await expectCode(as(w.otherClinicStaff, (q) => q("select public.verify_outside_dose($1,$2,$3,'verify',$4,null,null)", [op(), w.otherClinic, r.eventId, w.products["DEMO-P-ALPHA"]])), "CV404");

    await as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'verify',$4,null,'certificate seen')", [op(), w.clinic, r.eventId, w.products["DEMO-P-ALPHA"]]));
    const after = (await evaluate(w.clinician, id))!;
    expect(after.pendingEvidence).toBe(0);
    expect(status(after, "A1")).toBe("completed");
    expect(after.requirements.find((x) => x.requirement === "A1")!.creditedOn).toBe(T(-30));

    // both revisions survive; the report is recoverable and the verifier is attributed
    const revs = await admin<{ revision_no: number; verification_status: string; approved_by: string | null; product_id: string | null }>(
      "select revision_no, verification_status, approved_by, product_id from public.vaccination_revisions where event_id = $1 order by revision_no", [r.eventId]);
    expect(revs.map((x) => x.verification_status)).toEqual(["pending_verification", "verified"]);
    expect(revs[1]!.approved_by).toBe(w.clinician.id);
    expect(revs[0]!.product_id).toBeNull();
    await expect(admin("update public.vaccination_revisions set verification_status = 'verified' where event_id = $1", [r.eventId])).rejects.toMatchObject({ code: "CV403" });
    await expect(admin("delete from public.vaccination_events where id = $1", [r.eventId])).rejects.toMatchObject({ code: "CV403" });
    // second decision conflicts
    await expectCode(as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'reject',null,null,'again')", [op(), w.clinic, r.eventId])), "CV409");
    // the resolved review case is closed
    expect(await admin("select 1 from public.record_review_cases where vaccination_event_id = $1 and status = 'open'", [r.eventId])).toHaveLength(0);
  });

  it("rejection needs a reason, grants nothing, and is recorded as a revision", async () => {
    const id = await child("Rejected", 40, w.g1);
    const [{ r }] = await as(w.g1, (q) => q<R>("select public.report_outside_dose($1,$2,$3) as r", [op(), id, JSON.stringify({ productText: "unclear card", administeredOn: T(-30) })]));
    await expectCode(as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'reject',null,null,null)", [op(), w.clinic, r.eventId])), "CV422");
    await as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'reject',null,null,'card unreadable')", [op(), w.clinic, r.eventId]));
    const res = (await evaluate(w.clinician, id))!;
    expect(status(res, "A1")).toBe("overdue");
    expect(res.pendingEvidence).toBe(0);
    const hist = await as(w.g1, (q) => q<{ r: { status: string }[] }>("select public.guardian_child_history($1) as r", [id]));
    expect(hist[0]!.r[0]!.status).toBe("not_accepted");
  });

  it("only the child's verified guardian can report; input is validated; retries are idempotent", async () => {
    const id = await child("Report Rules", 40, w.g1);
    await expectCode(as(w.g2, (q) => q("select public.report_outside_dose($1,$2,$3)", [op(), id, JSON.stringify({ productText: "x", administeredOn: T(-1) })])), "CV404");
    await expectCode(as(w.g1, (q) => q("select public.report_outside_dose($1,$2,$3)", [op(), id, JSON.stringify({ productText: "", administeredOn: T(-1) })])), "CV422");
    await expectCode(as(w.g1, (q) => q("select public.report_outside_dose($1,$2,$3)", [op(), id, JSON.stringify({ productText: "future", administeredOn: T(5) })])), "CV422");
    await expectCode(as(w.g1, (q) => q("select public.report_outside_dose($1,$2,$3)", [op(), id, JSON.stringify({ productText: "no date but precision exact", precision: "exact" })])), "CV422");
    const key = op();
    const call = () => as(w.g1, (q) => q<R>("select public.report_outside_dose($1,$2,$3) as r", [key, id, JSON.stringify({ productText: "once", administeredOn: T(-2) })]));
    const [a, b] = await Promise.all([call(), call()]);
    expect(a[0]!.r.eventId).toBe(b[0]!.r.eventId);
    expect(Number((await admin<{ n: string }>("select count(*) n from public.vaccination_events where original_child_id = $1", [id]))[0]!.n)).toBe(1);
  });

  it("a guardian whose relationship is unverified cannot report evidence or see the schedule", async () => {
    const id = await child("Unverified Guardian", 40, w.g2, false);
    await expectCode(as(w.g2, (q) => q("select public.report_outside_dose($1,$2,$3)", [op(), id, JSON.stringify({ productText: "x", administeredOn: T(-1) })])), "CV404");
    expect((await as(w.g2, (q) => q<{ r: unknown }>("select public.guardian_get_schedule($1) as r", [id])))[0]!.r).toBeNull();
  });

  it("staff can record and verify a documented outside dose in one step, but only with an approved product and exact date", async () => {
    const id = await child("Staff Outside", 40);
    await expectCode(as(w.clinician, (q) => q("select public.record_outside_dose_staff($1,$2,$3,$4,null,true)", [op(), w.clinic, id, JSON.stringify({ productText: "x", administeredOn: T(-30) })])), "CV422");
    await expectCode(as(w.clinician, (q) => q("select public.record_outside_dose_staff($1,$2,$3,$4,$5,true)", [op(), w.clinic, id, JSON.stringify({ productText: "x", precision: "month", administeredOn: T(-30) }), w.products["DEMO-P-ALPHA"]])), "CV422");
    await verifiedDose(id, "DEMO-P-ALPHA", T(-30));
    expect(status((await evaluate(w.clinician, id))!, "A1")).toBe("completed");
  });

  it("a verified dose with only month precision cannot be validated and needs staff review", async () => {
    const id = await child("Fuzzy", 40);
    // staff records a month-precision outside dose as pending; a later verify demands an exact date
    const [{ r }] = await as(w.clinician, (q) => q<R>("select public.record_outside_dose_staff($1,$2,$3,$4,null,false) as r", [op(), w.clinic, id, JSON.stringify({ productText: "somewhere last month", precision: "month", administeredOn: T(-30) })]));
    await expectCode(as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'verify',$4,null,null)", [op(), w.clinic, r.eventId, w.products["DEMO-P-ALPHA"]])), "CV422");
    await as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'verify',$4,$5,'date confirmed with card')", [op(), w.clinic, r.eventId, w.products["DEMO-P-ALPHA"], T(-30)]));
    expect(status((await evaluate(w.clinician, id))!, "A1")).toBe("completed");
  });
});

describe("credits, combinations and review states", () => {
  it("a combination dose earns one credit per antigen from a single physical event (T08)", async () => {
    const id = await child("Combo", 90);
    const [{ r }] = await verifiedDose(id, "DEMO-P-COMBO", T(-30));
    const res = (await evaluate(w.clinician, id))!;
    expect(status(res, "A1")).toBe("completed");
    expect(status(res, "B1")).toBe("completed");
    const credits = await admin<{ rule: string; rev: string }>(
      `select sr.requirement_code rule, dc.vaccination_revision_id rev from public.dose_credits dc join public.schedule_rules sr on sr.id = dc.rule_id where dc.evaluation_id = $1 and dc.credit_status = 'credited'`, [res.evaluationId]);
    expect(credits.map((c) => c.rule).sort()).toEqual(["A1", "B1"]);
    expect(new Set(credits.map((c) => c.rev)).size).toBe(1);
    const events = await admin<{ n: string }>("select count(*) n from public.vaccination_events where original_child_id = $1", [id]);
    expect(Number(events[0]!.n)).toBe(1);
    expect(r.eventId).toBeTruthy();
  });

  it("a dose given before the rule allows is preserved but never credited; it goes to staff review", async () => {
    const id = await child("Too Early", 40);
    await verifiedDose(id, "DEMO-P-ALPHA", T(-38)); // age 2 days < minimum
    const res = (await evaluate(w.clinician, id))!;
    expect(status(res, "A1")).toBe("staff_review_needed");
    expect(res.requirements.find((x) => x.requirement === "A1")!.reasons[0]!.code).toBe("dose_outside_rule_limits");
    const rows = await admin<{ credit_status: string; reason: string }>("select credit_status, reason from public.dose_credits where evaluation_id = $1", [res.evaluationId]);
    expect(rows).toEqual([{ credit_status: "not_credited", reason: "given_before_minimum_age" }]);
  });

  it("an active clinical hold forces staff review regardless of dates", async () => {
    const id = await child("Hold", 40);
    await admin("insert into public.clinical_holds (organization_id, child_id, reason_code) values ($1,$2,'demo-hold')", [w.org, id]);
    const res = (await evaluate(w.clinician, id))!;
    expect(res.requirements.every((x) => x.status === "staff_review_needed")).toBe(true);
  });

  it("merged records contribute their verified history to the survivor", async () => {
    const a = await child("Survivor", 40);
    const b = await child("Duplicate", 40);
    await verifiedDose(b, "DEMO-P-ALPHA", T(-30));
    await as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed same child by document')", [op(), w.clinic, a, b]));
    expect(status((await evaluate(w.clinician, a))!, "A1")).toBe("completed");
  });

  it("product presentation cannot change once history uses it", async () => {
    await expect(admin("update public.vaccine_products set doses_per_container = 10 where id = $1", [w.products["DEMO-P-ALPHA"]])).rejects.toMatchObject({ code: "CV409" });
    await admin("update public.vaccine_products set name = 'renamed for display' where id = $1", [w.products["DEMO-P-ALPHA"]]); // non-conversion fields remain editable
  });
});

describe("history views", () => {
  it("staff history requires child.read_clinical and denial is audited; guardian history keeps provenance visible", async () => {
    const id = await child("History", 40, w.g1);
    await as(w.g1, (q) => q("select public.report_outside_dose($1,$2,$3)", [op(), id, JSON.stringify({ productText: "elsewhere", administeredOn: T(-20) })]));
    await verifiedDose(id, "DEMO-P-ALPHA", T(-30));
    const staff = await as(w.clinician, (q) => q<{ r: { origin: string; verificationStatus: string }[] }>("select public.list_child_history($1,$2) as r", [w.clinic, id]));
    expect(staff[0]!.r).toHaveLength(2);
    await expectCode(as(w.assistant, (q) => q("select public.list_child_history($1,$2)", [w.clinic, id])), "CV403");
    expect((await as(w.otherClinicStaff, (q) => q<{ r: unknown }>("select public.list_child_history($1,$2) as r", [w.otherClinic, id])))[0]!.r).toBeNull();
    const g = await as(w.g1, (q) => q<{ r: { status: string; source: string }[] }>("select public.guardian_child_history($1) as r", [id]));
    expect(g[0]!.r.map((x) => x.status).sort()).toEqual(["pending_verification", "verified"]);
    expect(g[0]!.r.every((x) => x.source === "recorded_elsewhere")).toBe(true); // never presented as a clinic-administered dose
    expect((await as(w.g2, (q) => q<{ r: unknown }>("select public.guardian_child_history($1) as r", [id])))[0]!.r).toBeNull();
    const denied = await admin("select 1 from private.audit_logs where action = 'history.view' and outcome = 'denied'");
    expect(denied.length).toBeGreaterThan(0);
  });

  it("guardians get a limited schedule projection for today; anonymous callers are denied", async () => {
    const id = await child("Guardian View", 40, w.g1);
    const res = (await as(w.g1, (q) => q<{ r: Sched & { requirements: Record<string, unknown>[] } }>("select public.guardian_get_schedule($1) as r", [id])))[0]!.r;
    expect(res.status).toBe("evaluated");
    expect(res.isDemo).toBe(true);
    expect(Object.keys(res.requirements[0]!).sort()).toEqual(["creditedOn", "recommendedOn", "requirement", "status", "targetOn", "windowEnd", "windowStart"]);
    await expectCode(as(null, (q) => q("select public.guardian_get_schedule($1)", [id])), "42501");
    // guardian evaluation is computed on demand and persists nothing
    expect(await admin("select 1 from public.schedule_evaluations where child_id = $1", [id])).toHaveLength(0);
  });
});

describe("rule version changes (T31)", () => {
  it("pins a future version preview without changing the current assignment or earlier snapshots", async () => {
    const id = await child("Version Change", 40);
    const first = (await evaluate(w.clinician, id))!;
    const v2 = await activateDemoSchedule(w, "ev-v2", T(1));
    const stillOld = (await evaluate(w.clinician, id))!; // as of today the old version is still in force
    expect(stillOld.versionLabel).toBe("ev-v1");
    const tomorrow = (await evaluate(w.clinician, id, T(1)))!;
    expect(tomorrow.versionLabel).toBe("ev-v2");
    const progs = await admin<{ status: string; schedule_version_id: string }>("select status, schedule_version_id from public.child_programs where child_id = $1 order by created_at", [id]);
    expect(progs.map((p) => p.status)).toEqual(["active"]);
    expect(progs[0]!.schedule_version_id).not.toBe(v2);
    const old = await admin<{ result: { versionLabel: string } }>("select result from public.schedule_evaluations where id = $1", [first.evaluationId]);
    expect(old[0]!.result.versionLabel).toBe("ev-v1");
    const impact = await as(w.lead, (q) => q<{ r: { cohortChildren: number } }>("select public.preview_schedule_impact($1,$2) as r", [w.clinic, v2]));
    expect(impact[0]!.r.cohortChildren).toBeGreaterThan(0);
  });

  it("reconciles today's assignment even when its evaluation was already persisted", async () => {
    const world = await clinicalWorld();
    const version = await activateDemoSchedule(world, "cached-current-assignment");
    const [{ r }] = await as(world.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), world.clinic, JSON.stringify({ displayName: "Cached Assignment", dob: T(-40) })]));
    const evaluateCurrent = () => as(world.clinician, (q) => q<{ r: Sched }>("select public.evaluate_child($1,$2) as r", [world.clinic, r.childId]));
    const saved = (await evaluateCurrent())[0]!.r;
    // Model a saved evaluation with no current assignment, as when a persisted
    // future snapshot becomes current. This fixture never changes the clock.
    await admin("delete from public.child_programs where child_id=$1", [r.childId]);
    const replay = (await evaluateCurrent())[0]!.r;
    expect(replay.evaluationId).toBe(saved.evaluationId);
    const programs = await admin<{ schedule_version_id: string }>("select schedule_version_id from public.child_programs where child_id=$1 and status='active'", [r.childId]);
    expect(programs).toEqual([{ schedule_version_id: version }]);
  });
});

describe("retiring a schedule stops its use immediately", () => {
  it("evaluation reports no active schedule after retirement; a reason is required; it is audited", async () => {
    const w3 = await clinicalWorld();
    const v = await activateDemoSchedule(w3, "retire-me");
    const [{ r }] = await as(w3.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w3.clinic, JSON.stringify({ displayName: "Retire Probe", dob: T(-40) })]));
    const ev = () => as(w3.clinician, (q) => q<{ r: Sched }>("select public.evaluate_child($1,$2) as r", [w3.clinic, r.childId]));
    expect((await ev())[0]!.r.status).toBe("evaluated");
    await expectCode(as(w3.lead, (q) => q("select public.retire_schedule($1,$2,$3,'')", [op(), w3.clinic, v])), "CV422");
    await expectCode(as(w3.clinician, (q) => q("select public.retire_schedule($1,$2,$3,'defect found')", [op(), w3.clinic, v])), "CV403");
    await as(w3.lead, (q) => q("select public.retire_schedule($1,$2,$3,'defect found in review')", [op(), w3.clinic, v]));
    expect((await ev())[0]!.r.status).toBe("no_active_schedule");
    expect(await admin("select 1 from private.audit_logs where action = 'schedule.retired' and entity_id = $1", [v])).toHaveLength(1);
  });
});

describe("product picker", () => {
  it("lists only active products to roles that record or verify care", async () => {
    const list = await as(w.clinician, (q) => q<{ r: { code: string }[] }>("select public.list_active_products($1) as r", [w.clinic]));
    expect(list[0]!.r.map((p) => p.code).sort()).toEqual(["DEMO-P-ALPHA", "DEMO-P-COMBO", "DEMO-P-GAMMA"]);
    await expectCode(as(w.assistant, (q) => q("select public.list_active_products($1)", [w.clinic])), "CV403");
    await expectCode(as(w.g1, (q) => q("select public.list_active_products($1)", [w.clinic])), "CV403");
    await as(w.techAdmin, (q) => q("select public.create_antigen($1,$2,'DEMO-DRAFT','draft only')", [op(), w.clinic]));
    await as(w.techAdmin, (q) => q("select public.create_vaccine_product($1,$2,$3)", [op(), w.clinic, JSON.stringify({ code: "DEMO-P-DRAFT", name: "d", presentation: "p", stockUnit: "v", dosesPerContainer: 1, administrationUnit: "d", antigenCodes: ["DEMO-ALPHA"] })]));
    const again = await as(w.clinician, (q) => q<{ r: { code: string }[] }>("select public.list_active_products($1) as r", [w.clinic]));
    expect(again[0]!.r.map((p) => p.code)).not.toContain("DEMO-P-DRAFT"); // draft products are never offered for recording
  });
});
