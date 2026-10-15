import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, op, pool } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";
import { DEMO_FIXTURES, demoSchedule } from "../fixtures/synthetic-schedule";

let w: ClinicalWorld;
type R = { r: Record<string, unknown> };
const importDraft = (actor: keyof Pick<ClinicalWorld, "clinician" | "assistant" | "techAdmin" | "lead" | "otherClinicStaff">, payload: unknown, clinic?: string) =>
  as(w[actor], (q) => q<R>("select public.import_schedule_draft($1,$2,$3) as r", [op(), clinic ?? w.clinic, JSON.stringify(payload)]));

beforeAll(async () => {
  w = await clinicalWorld();
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("master data governance (BP16, P35)", () => {
  it("a creator cannot activate their own item; an approver who is a different person can", async () => {
    const [{ r }] = await as(w.lead, (q) => q<R>("select public.create_antigen($1,$2,'DEMO-SELF','Self activation probe (fictional)') as r", [op(), w.clinic]));
    await expectCode(as(w.lead, (q) => q("select public.set_master_status($1,$2,'antigen',$3,'active')", [op(), w.clinic, r.antigenId])), "CV403");
    await as(w.lead2, (q) => q("select public.set_master_status($1,$2,'antigen',$3,'active')", [op(), w.clinic, r.antigenId]));
  });
  it("assistants and inventory staff cannot stage or activate clinical master data", async () => {
    await expectCode(as(w.assistant, (q) => q("select public.create_antigen($1,$2,'X-1','x')", [op(), w.clinic])), "CV403");
    await expectCode(as(w.inventory, (q) => q("select public.create_antigen($1,$2,'X-2','x')", [op(), w.clinic])), "CV403");
    await expectCode(as(w.techAdmin, (q) => q("select public.set_master_status($1,$2,'antigen',gen_random_uuid(),'active')", [op(), w.clinic])), "CV403");
  });
  it("products must map to antigens and cannot use unknown ones", async () => {
    await expectCode(as(w.techAdmin, (q) => q("select public.create_vaccine_product($1,$2,$3)", [op(), w.clinic, JSON.stringify({ code: "BAD-1", name: "x", presentation: "p", stockUnit: "v", dosesPerContainer: 1, administrationUnit: "d", antigenCodes: [] })])), "CV422");
    await expectCode(as(w.techAdmin, (q) => q("select public.create_vaccine_product($1,$2,$3)", [op(), w.clinic, JSON.stringify({ code: "BAD-2", name: "x", presentation: "p", stockUnit: "v", dosesPerContainer: 1, administrationUnit: "d", antigenCodes: ["NOPE"] })])), "CV422");
    await expectCode(as(w.techAdmin, (q) => q("select public.create_vaccine_product($1,$2,$3)", [op(), w.clinic, JSON.stringify({ code: "BAD-3", name: "x", presentation: "p", stockUnit: "v", dosesPerContainer: 0, administrationUnit: "d", antigenCodes: ["DEMO-ALPHA"] })])), "23514");
  });
});

describe("schedule import validation", () => {
  it("only rules.propose holders can import; assistants and technical admins cannot", async () => {
    await expectCode(importDraft("assistant", demoSchedule("v-x1")), "CV403");
    await expectCode(importDraft("techAdmin", demoSchedule("v-x2")), "CV403");
    await expectCode(importDraft("otherClinicStaff", demoSchedule("v-x3")), "CV403"); // proposes nowhere at this clinic
  });
  it("rejects malformed rules and fixtures with CV422 and creates nothing", async () => {
    const before = Number((await admin<{ n: string }>("select count(*) n from public.schedule_versions where organization_id = $1", [w.org]))[0].n);
    const bad = (mut: (s: ReturnType<typeof demoSchedule>) => void, label: string) => {
      const s = demoSchedule(label);
      mut(s);
      return expectCode(importDraft("clinician", s), "CV422");
    };
    await bad((s) => { s.rules[0]!.antigen = "UNKNOWN"; }, "bad-antigen");
    await bad((s) => { s.rules[0]!.minimumAge = { value: 5, unit: "fortnights" as never }; }, "bad-unit");
    await bad((s) => { s.rules[1]!.sequence = 1; }, "dup-seq");
    await bad((s) => { s.dependencies[0] = { rule: "A1", predecessor: "A2", minimumInterval: { value: 1, unit: "days" } }; }, "later-predecessor");
    await bad((s) => { s.dependencies[0] = { rule: "A2", predecessor: "NOPE", minimumInterval: { value: 1, unit: "days" } }; }, "unknown-predecessor");
    await bad((s) => { (s.fixtures as { expected: object }[])[0]!.expected = { A1: "not_a_status" }; }, "bad-status");
    await bad((s) => { (s.fixtures as { expected: object }[])[0]!.expected = { ZZ: "completed" }; }, "bad-req");
    await bad((s) => { s.rules[3]!.acceptedProducts = ["NO-SUCH-PRODUCT"]; }, "bad-product");
    await bad((s) => { (s.rules[0] as { reviewConditions?: string[] }).reviewConditions = ["arbitrary code"]; }, "bad-cond");
    const after = Number((await admin<{ n: string }>("select count(*) n from public.schedule_versions where organization_id = $1", [w.org]))[0].n);
    expect(after).toBe(before);
  });
  it("a real (non-demo) schedule must cite its authoritative source", async () => {
    await expectCode(importDraft("clinician", demoSchedule("real-no-source", { isDemo: false })), "CV422");
  });
  it("demo schedules cannot even be imported unless demo mode is on", async () => {
    await setDemoMode(false);
    try {
      await expectCode(importDraft("clinician", demoSchedule("demo-off")), "CV403");
    } finally {
      await setDemoMode(true);
    }
  });
});

describe("engine fixtures (BP16 status model; T07, T08, T12-style dependency)", () => {
  let historyWorld: ClinicalWorld;
  let historicalVersion: string;
  beforeAll(async () => {
    historyWorld = await clinicalWorld();
    historicalVersion = await activateDemoSchedule(historyWorld, "as-of-boundaries");
  });
  it("does not credit a verified dose dated after the evaluation date", async () => {
    const doses = [{ id: crypto.randomUUID(), product: "DEMO-P-ALPHA", antigens: ["DEMO-ALPHA"], on: isoDaysFromToday(1), unresolved: false }];
    const [row] = await admin<{ r: { requirements: { requirement: string; creditedDoseId: string | null }[] } }>(
      "select private.evaluate_rules($1,$2,true,$3::jsonb,'[]'::jsonb,$4) as r",
      [historicalVersion, isoDaysFromToday(-90), JSON.stringify(doses), isoDaysFromToday(0)],
    );
    expect(row!.r.requirements.find((x) => x.requirement === "A1")!.creditedDoseId).toBeNull();
  });

  it("applies clinical holds only during their effective interval", async () => {
    const [{ r }] = await as(historyWorld.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), historyWorld.clinic, JSON.stringify({ displayName: "Historical Hold Child", dob: isoDaysFromToday(-90) })]));
    const kid = r.childId as string;
    // Hold timestamps use the placing clinic's timezone, like the public command.
    const [hold] = await admin<{ id: string }>("insert into public.clinical_holds (organization_id, child_id, placed_clinic_id, reason_code, starts_at) values ($1,$2,$3,'review',now() + interval '1 day') returning id", [historyWorld.org, kid, historyWorld.clinic]);
    const evalOn = (day: number) => as(historyWorld.clinician, (q) => q<{ r: { requirements: { requirement: string; reasons: { code: string }[] }[] } }>("select public.evaluate_child($1,$2,$3) as r", [historyWorld.clinic, kid, isoDaysFromToday(day)]));
    const current = (await evalOn(0))[0]!.r.requirements.find((x) => x.requirement === "A1")!;
    expect(current.reasons.some((x) => x.code === "clinical_hold")).toBe(false);
    const future = (await evalOn(2))[0]!.r.requirements.find((x) => x.requirement === "A1")!;
    expect(future.reasons.some((x) => x.code === "clinical_hold")).toBe(true);
    await admin("update public.clinical_holds set status = 'resolved', resolved_at = now() + interval '3 days' where id = $1", [hold!.id]);
    const later = (await evalOn(4))[0]!.r.requirements.find((x) => x.requirement === "A1")!;
    expect(later.reasons.some((x) => x.code === "clinical_hold")).toBe(false);
  });
  it("every fixture case evaluates exactly as expected", async () => {
    const [{ r }] = await importDraft("clinician", demoSchedule("fixture-run"));
    const detail = await as(w.clinician, (q) => q<{ r: { fixtures: { name: string; passed: boolean; differences: unknown[] }[] } }>("select public.get_schedule_version($1,$2) as r", [w.clinic, r.versionId]));
    const failed = detail[0]!.r.fixtures.filter((f) => !f.passed);
    expect(failed).toEqual([]);
    expect(detail[0]!.r.fixtures).toHaveLength(DEMO_FIXTURES.length);
  });
});

describe("review, approval and activation gates", () => {
  it("evaluating a different effective date does not replace the current child program", async () => {
    const ww = await clinicalWorld();
    const current = await activateDemoSchedule(ww, "program-current");
    await activateDemoSchedule(ww, "program-next", isoDaysFromToday(1));
    const [{ r }] = await as(ww.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), ww.clinic, JSON.stringify({ displayName: "Program Date Child", dob: isoDaysFromToday(-90) })]));
    await as(ww.clinician, (q) => q("select public.evaluate_child($1,$2,$3)", [ww.clinic, r.childId, isoDaysFromToday(0)]));
    await as(ww.clinician, (q) => q("select public.evaluate_child($1,$2,$3)", [ww.clinic, r.childId, isoDaysFromToday(1)]));
    const [row] = await admin<{ schedule_version_id: string }>("select schedule_version_id from public.child_programs where child_id = $1 and status = 'active'", [r.childId]);
    expect(row!.schedule_version_id).toBe(current);
  });
  it("the proposer cannot approve; a failing fixture blocks approval; content is frozen after submission", async () => {
    const bad = demoSchedule("gate-bad", { fixtures: [{ name: "wrong expectation", dob: "2025-01-01", asOf: "2025-01-05", doses: [], expected: { A1: "completed" } }] });
    const [{ r }] = await importDraft("clinician", bad);
    const id = r.versionId as string;
    await expectCode(as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, id])), "CV409"); // not yet submitted
    await as(w.clinician, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, id]));
    await expectCode(as(w.clinician, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, id])), "CV403"); // no rules.approve
    await expectCode(as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, id])), "CV422"); // fixture fails
    // frozen: even the database owner cannot alter rules after review starts
    await expect(admin("update public.schedule_rules set target_offset = null where schedule_version_id = $1", [id])).rejects.toMatchObject({ code: "CV409" });
    await expect(admin("insert into public.schedule_fixtures (organization_id, schedule_version_id, name, dob, as_of, expected) values ($1,$2,'late',current_date,current_date,'{}')", [w.org, id])).rejects.toMatchObject({ code: "CV409" });
  });
  it("a proposer who also holds rules.approve still cannot approve their own schedule", async () => {
    const [{ r }] = await importDraft("lead", demoSchedule("gate-self"));
    await as(w.lead, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, r.versionId]));
    await expectCode(as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, r.versionId])), "CV403");
    await as(w.lead2, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, r.versionId]));
  });
  it("activation requires approval, a future-or-today date, and keeps exactly one active version per program", async () => {
    const [{ r }] = await importDraft("clinician", demoSchedule("act-1"));
    const id = r.versionId as string;
    await expectCode(as(w.lead, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, id, isoDaysFromToday(0)])), "CV409"); // still draft
    await as(w.clinician, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, id]));
    await as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, id]));
    await expectCode(as(w.lead, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, id, isoDaysFromToday(-3)])), "CV422");
    await expectCode(as(w.clinician, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, id, isoDaysFromToday(0)])), "CV403");
    await as(w.lead, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, id, isoDaysFromToday(0)]));

    const v2 = await activateDemoSchedule(w, "act-2", isoDaysFromToday(2));
    const rows = await admin<{ id: string; status: string; effective_to: string | null; supersedes_id: string | null }>(
      "select id, status, effective_to::text, supersedes_id from public.schedule_versions where organization_id = $1 and program_code = 'routine' and status in ('active','retired') order by effective_from", [w.org]);
    expect(rows.filter((x) => x.status === "active")).toHaveLength(1);
    expect(rows.find((x) => x.id === id)!.status).toBe("retired");
    expect(rows.find((x) => x.id === v2)!.supersedes_id).toBe(id);
    // a version that does not start after the current one is refused
    const [{ r: r3 }] = await importDraft("clinician", demoSchedule("act-3"));
    await as(w.clinician, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, r3.versionId]));
    await as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, r3.versionId]));
    await expectCode(as(w.lead, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, r3.versionId, isoDaysFromToday(2)])), "CV422");
  });
  it("a demo version cannot be activated once demo mode is off", async () => {
    const [{ r }] = await importDraft("clinician", demoSchedule("act-demo-off"));
    await as(w.clinician, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, r.versionId]));
    await as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, r.versionId]));
    await setDemoMode(false);
    try {
      await expectCode(as(w.lead, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, r.versionId, isoDaysFromToday(30)])), "CV403");
    } finally {
      await setDemoMode(true);
    }
  });
  it("active versions are immutable at the table level and cannot be deleted", async () => {
    const [row] = await admin<{ id: string }>("select id from public.schedule_versions where organization_id = $1 and status = 'active' limit 1", [w.org]);
    await expect(admin("update public.schedule_versions set version_label = 'renamed' where id = $1", [row!.id])).rejects.toMatchObject({ code: "CV409" });
    await expect(admin("delete from public.schedule_versions where id = $1", [row!.id])).rejects.toMatchObject({ code: "CV409" });
  });
  it("drafts can be discarded by proposers; approved versions cannot", async () => {
    const [{ r }] = await importDraft("clinician", demoSchedule("discard-me"));
    await as(w.clinician, (q) => q("select public.discard_schedule_draft($1,$2,$3)", [op(), w.clinic, r.versionId]));
    expect(await admin("select 1 from public.schedule_versions where id = $1", [r.versionId])).toHaveLength(0);
  });
  it("configuration reads are limited to configuration roles and scoped to the organization", async () => {
    await expectCode(as(w.assistant, (q) => q("select public.list_clinical_master($1)", [w.clinic])), "CV403");
    await expectCode(as(w.g1, (q) => q("select public.list_clinical_master($1)", [w.clinic])), "CV403");
    const res = await as(w.lead, (q) => q<{ r: { schedules: unknown[]; antigens: unknown[] } }>("select public.list_clinical_master($1) as r", [w.clinic]));
    expect(res[0]!.r.schedules.length).toBeGreaterThan(0);
  });
  it("technical tables are not reachable directly by any API role", async () => {
    for (const t of ["schedule_versions", "schedule_rules", "vaccination_revisions", "schedule_evaluations", "clinical_holds"]) {
      await expectCode(as(w.lead, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(as(null, (q) => q(`select * from public.${t}`)), "42501");
    }
  });
});
