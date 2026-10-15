import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let main: string;
let seq = 0;
type R = { r: Record<string, unknown> };
const T = (n: number) => isoDaysFromToday(n);
const jr = async (a: Actor | null, sql: string, p: unknown[] = []) => (await as(a, (q) => q<R>(sql, p)))[0]!.r as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function child(name = "Rpt Kid") {
  const [{ r }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, dob: T(-60) })]));
  return r.childId as string;
}
async function openEncounter(childId: string) {
  const ci = (await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'report test') as r", [op(), w.clinic, childId])))[0]!.r;
  const called = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, ci.version])))[0]!.r;
  const st = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'in_service',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, called.version])))[0]!.r;
  return { enc: st.encounterId as string, entry: ci.queueEntryId as string, version: st.version as number };
}
async function lotWithStock(product: string, code: string, units: number) {
  const lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5) as r", [op(), w.clinic, w.products[product], code, T(200)])))[0]!.r.lotId as string;
  await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,$5,'DR-RPT')", [op(), w.clinic, main, lot, units]));
  return lot;
}
async function give(lot: string) {
  const { enc } = await openEncounter(await child());
  const res = (await as(w.clinician, (q) => q<R>("select public.record_administration($1,$2,$3,$4) as r", [op(), w.clinic, enc, JSON.stringify({ lotId: lot, locationId: main, route: "IM", site: "left thigh", assessmentReference: "A", consentReference: "C" })])))[0]!.r;
  return (await admin<{ event_id: string }>("select event_id from public.vaccination_revisions where id = $1", [res.revisionId]))[0]!.event_id;
}
const daily = (a: Actor | null, from = T(0), to = T(0), exp = false) => jr(a, "select public.report_daily_activity($1,$2,$3,$4) as r", [w.clinic, from, to, exp]);
const byProduct = (a: Actor | null, from = T(0), to = T(0), exp = false) => jr(a, "select public.report_vaccinations_by_product($1,$2,$3,$4) as r", [w.clinic, from, to, exp]);
const stockRpt = (a: Actor | null, from = T(0), to = T(0)) => jr(a, "select public.report_stock_summary($1,$2,$3,false) as r", [w.clinic, from, to]);
const tally = (a: Actor, date: string, product: string, n: number, note: string | null = null) =>
  as(a, (q) => q("select public.record_paper_tally($1,$2,$3,$4,$5,$6)", [op(), w.clinic, date, w.products[product], n, note]));
const paper = (a: Actor, from = T(0), to = T(0)) => jr(a, "select public.report_paper_reconciliation($1,$2,$3,false) as r", [w.clinic, from, to]);

let lotA: string;
let voided: string;

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "rpt-v1");
  main = (await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,'Main fridge','usable') as r", [op(), w.clinic])))[0]!.r.locationId as string;
  await as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: T(0), startTime: "00:00", endTime: "23:59", totalCapacity: 200, onlineCapacity: 50, walkinCapacity: 150 })]));
  lotA = await lotWithStock("DEMO-P-ALPHA", "RPT-A", 10);
  await give(lotA);
  await give(lotA);
  voided = await give(lotA);
  const k = (await as(w.clinician, (q) => q<R>("select public.request_correction($1,$2,$3,'void_duplicate',$4,'entered twice') as r", [op(), w.clinic, voided, JSON.stringify({ stockEffect: "return_to_stock" })])))[0]!.r;
  await as(w.lead, (q) => q("select public.approve_correction($1,$2,$3,'ok')", [op(), w.clinic, k.caseId]));
});
afterAll(async () => {
  await admin("update private.settings set value = '0'::jsonb where key = 'report_small_cell_threshold'");
  await setDemoMode(false);
  await pool.end();
});

describe("who can run reports", () => {
  it("needs report.run at that clinic with MFA; every other role and clinic is refused", async () => {
    for (const a of [w.assistant, w.clinician, w.inventory, w.g1, w.techAdmin, w.otherClinicStaff, { ...w.lead, aal: "aal1" as const }]) await expectCode(daily(a), "CV403");
    await expectCode(as(null, (q) => q("select public.report_daily_activity($1,$2,$3,false)", [w.clinic, T(0), T(0)])), "42501");
    expect((await daily(w.lead)).report).toBe("daily_activity");
  });

  it("validates the period", async () => {
    await expectCode(daily(w.lead, T(0), T(-1)), "CV422");
    await expectCode(daily(w.lead, T(-400), T(0)), "CV422");
    await expectCode(as(w.lead, (q) => q("select public.report_daily_activity($1,null,$2,false)", [w.clinic, T(0)])), "CV422");
    expect((await daily(w.lead, T(-365), T(0))).rows).toHaveLength(366);
  });
});

describe("what the numbers mean (F33)", () => {
  it("daily activity counts arrivals and vaccinations from the same facts as the care screens; voided events are not counted", async () => {
    const d = await daily(w.lead);
    const row = d.rows[0];
    expect(row.date).toBe(T(0));
    expect(row.vaccinationsGiven).toBe(2);
    expect(row.arrivals).toBeGreaterThanOrEqual(3);
    expect(row.walkIns).toBe(row.arrivals);
    expect(d.totals.vaccinationsGiven).toBe(2);
    const direct = Number((await admin<{ n: string }>("select count(*) n from private.current_revisions where clinic_id = $1 and source = 'clinic_administered' and event_status = 'active' and administered_on = $2", [w.clinic, T(0)]))[0]!.n);
    expect(direct).toBe(2);
    expect(d.definitions.version).toBe("r1");
    expect(Object.keys(d.definitions.terms)).toEqual(expect.arrayContaining(["vaccinationsGiven", "arrivals", "booked"]));
  });

  it("counts bookings, cancellations and no-shows by session date", async () => {
    const kid = await child("Booked");
    await admin("update public.children set record_status = 'active' where id = $1 and record_status <> 'active'", [kid]);
    const slot = (await admin<{ id: string }>("select id from public.clinic_sessions where clinic_id = $1 and service_date = $2 limit 1", [w.clinic, T(0)]))[0]!.id;
    const before = (await daily(w.lead)).rows[0];
    const [g] = await Promise.all([Promise.resolve(w.g1)]);
    const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: `Bk ${++seq}`, dob: T(-50) })]));
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [g.id, r.childId]);
    await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
    const a1 = (await as(g, (q) => q<R>("select public.book_appointment($1,$2,$3,null) as r", [op(), r.childId, slot])))[0]!.r;
    expect((await daily(w.lead)).rows[0].booked).toBe(before.booked + 1);
    await as(g, (q) => q("select public.cancel_appointment($1,$2,'plans changed')", [op(), a1.appointmentId]));
    const after = (await daily(w.lead)).rows[0];
    expect(after.booked).toBe(before.booked);
    expect(after.cancelled).toBe(before.cancelled + 1);
    expect(kid).toBeTruthy();
  });

  it("vaccinations by product totals match the daily figure", async () => {
    const p = await byProduct(w.lead);
    expect(p.rows).toEqual([{ productCode: "DEMO-P-ALPHA", product: expect.any(String), count: 2 }]);
    expect(p.total).toBe(2);
  });

  it("stock summary shows the ledger movements, corrections and a reconciliation check", async () => {
    await as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,1,'breakage')", [op(), w.clinic, main, lotA]));
    const s = await stockRpt(w.lead);
    const lot = s.rows.find((x: { lot: string }) => x.lot === "RPT-A");
    expect(lot).toMatchObject({ received: 10, issued: 2, wastage: 1, adjustments: 0, onHand: 7, ledgerTotal: 7, reconciles: true });
    // a corrupted projection is exposed, not hidden
    await admin("update public.stock_balances set on_hand = on_hand + 1 where lot_id = $1", [lotA]);
    expect((await stockRpt(w.lead)).rows.find((x: { lot: string }) => x.lot === "RPT-A").reconciles).toBe(false);
    await admin("update public.stock_balances set on_hand = on_hand - 1 where lot_id = $1", [lotA]);
    expect((await stockRpt(w.lead)).rows.find((x: { lot: string }) => x.lot === "RPT-A").reconciles).toBe(true);
  });

  it("contains no names or identifiers", async () => {
    const text = JSON.stringify([await daily(w.lead), await byProduct(w.lead), await stockRpt(w.lead), await paper(w.lead)]);
    expect(text).not.toMatch(/Rpt Kid|Bk \d|Booked \d/);
    expect(text).not.toMatch(/CV-\d{6}/);
  });
});

describe("small-cell suppression applies to exports (BP27)", () => {
  it("withholds counts below the threshold and their totals in exports only", async () => {
    await admin("update private.settings set value = '5'::jsonb where key = 'report_small_cell_threshold'");
    const exp = await daily(w.lead, T(0), T(0), true);
    expect(exp.rows[0].vaccinationsGiven).toBeNull();
    expect(exp.totals).toBeNull();
    expect(exp.suppressed).toBe(true);
    const p = await byProduct(w.lead, T(0), T(0), true);
    expect(p.rows[0].count).toBeNull();
    expect(p.total).toBeNull();
    expect((await daily(w.lead)).rows[0].vaccinationsGiven).toBe(2); // the on-screen view for authorised staff stays exact
    await admin("update private.settings set value = '0'::jsonb where key = 'report_small_cell_threshold'");
    expect((await daily(w.lead, T(0), T(0), true)).rows[0].vaccinationsGiven).toBe(2);
  });

  it("exports are audited and limited to known reports", async () => {
    const before = Number((await admin<{ n: string }>("select count(*) n from private.audit_logs where action = 'report.exported' and entity_id = $1", [w.clinic]))[0]!.n);
    await daily(w.lead, T(0), T(0), true);
    await byProduct(w.lead, T(0), T(0), true);
    await jr(w.lead, "select public.report_stock_summary($1,$2,$3,true) as r", [w.clinic, T(0), T(0)]);
    await jr(w.lead, "select public.report_paper_reconciliation($1,$2,$3,true) as r", [w.clinic, T(0), T(0)]);
    expect(Number((await admin<{ n: string }>("select count(*) n from private.audit_logs where action = 'report.exported' and entity_id = $1", [w.clinic]))[0]!.n)).toBe(before + 4);
    // The superseded stand-alone export recorder (0018) is no longer executable by API roles (0040, I4-04): exports are audited only
    // by the report functions' p_export flag above, so a caller cannot write an export audit row without receiving the export.
    await expectCode(as(w.lead, (q) => q("select public.record_report_export($1,$2,'daily_activity',$3,$4)", [op(), w.clinic, T(-7), T(0)])), "42501");
    await expectCode(as(w.clinician, (q) => q("select public.record_report_export($1,$2,'daily_activity',$3,$4)", [op(), w.clinic, T(-7), T(0)])), "42501");
    expect(Number((await admin<{ n: string }>("select count(*) n from private.audit_logs where action = 'report.exported' and entity_id = $1", [w.clinic]))[0]!.n)).toBe(before + 4);
  });
});

describe("paper reconciliation", () => {
  it("allows a clinical on-screen view but requires report.run and suppresses all paper export inferences", async () => {
    await tally(w.clinician, T(0), "DEMO-P-ALPHA", 1, "Patient Jane Doe attended");
    const screen = await paper(w.clinician);
    expect(screen.rows[0]).toMatchObject({ paperCount: 1, systemCount: 2, difference: 1, status: "system_higher", note: "Patient Jane Doe attended" });
    await expectCode(jr(w.clinician, "select public.report_paper_reconciliation($1,$2,$3,true) as r", [w.clinic, T(0), T(0)]), "CV403");
    await admin("update private.settings set value = '5'::jsonb where key = 'report_small_cell_threshold'");
    const exported = await jr(w.lead, "select public.report_paper_reconciliation($1,$2,$3,true) as r", [w.clinic, T(0), T(0)]);
    expect(exported.suppressed).toBe(true);
    expect(exported.unresolved).toBeNull();
    expect(exported.rows[0]).toMatchObject({ paperCount: null, systemCount: null, difference: null, status: null });
    expect(exported.rows[0]).not.toHaveProperty("note");
    expect(JSON.stringify(exported)).not.toContain("Jane Doe");
    await admin("update private.settings set value = '0'::jsonb where key = 'report_small_cell_threshold'");
  });
  it("compares later-entered paper tallies with the system; the latest entry counts and nothing is edited", async () => {
    await tally(w.clinician, T(0), "DEMO-P-ALPHA", 3, "paper log page 4");
    let row = (await paper(w.lead)).rows.find((x: { productCode: string }) => x.productCode === "DEMO-P-ALPHA");
    expect(row).toMatchObject({ paperCount: 3, systemCount: 2, difference: -1, status: "paper_higher", note: "paper log page 4" });
    await tally(w.lead, T(0), "DEMO-P-ALPHA", 2, "recounted");
    row = (await paper(w.lead)).rows.find((x: { productCode: string }) => x.productCode === "DEMO-P-ALPHA");
    expect(row).toMatchObject({ paperCount: 2, difference: 0, status: "matches" });
    expect((await paper(w.lead)).unresolved).toBe(0);
    await tally(w.lead, T(0), "DEMO-P-ALPHA", 1);
    expect((await paper(w.lead)).rows[0]).toMatchObject({ status: "system_higher", difference: 1 });
    expect(Number((await admin<{ n: string }>("select count(*) n from public.paper_tallies where clinic_id = $1", [w.clinic]))[0]!.n)).toBe(4);
    await expectCode(admin("update public.paper_tallies set paper_count = 0"), "CV403");
    await expectCode(admin("delete from public.paper_tallies"), "CV403");
    expect((await daily(w.lead)).rows[0].vaccinationsGiven).toBe(2);
  });

  it("flags system activity that has no paper tally, and enforces who may enter tallies", async () => {
    const noTally = (await paper(w.lead, T(0), T(0))).rows.filter((x: { status: string }) => x.status === "no_paper_tally");
    expect(noTally).toHaveLength(0); // today has a tally already
    await expectCode(tally(w.assistant, T(0), "DEMO-P-ALPHA", 1), "CV403");
    await expectCode(tally(w.otherClinicStaff, T(0), "DEMO-P-ALPHA", 1), "CV403");
    await expectCode(tally(w.lead, T(1), "DEMO-P-ALPHA", 1), "CV422");
    await expectCode(tally(w.lead, T(0), "DEMO-P-ALPHA", -1), "CV422");
    await expectCode(as(w.lead, (q) => q("select public.record_paper_tally($1,$2,$3,$4,1,null)", [op(), w.clinic, T(0), crypto.randomUUID()])), "CV422");
    await expectCode(paper(w.assistant), "CV403");
  });

  it("is idempotent per operation key", async () => {
    const key = op();
    const call = () => as(w.lead, (q) => q("select public.record_paper_tally($1,$2,$3,$4,2,'same')", [key, w.clinic, T(0), w.products["DEMO-P-ALPHA"]]));
    await Promise.all([call(), call()]);
    expect(Number((await admin<{ n: string }>("select count(*) n from public.paper_tallies where operation_id = $1", [key]))[0]!.n)).toBe(1);
  });
});

describe("backlog", () => {
  it("counts what still needs a person, without identifying anyone", async () => {
    const [{ r }] = await as(w.g2, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Backlog Kid", dob: T(-40) })]));
    const before = await jr(w.lead, "select public.report_backlog($1) as r", [w.clinic]);
    expect(before.provisionalChildren).toBeGreaterThanOrEqual(1);
    expect(before.pendingGuardianLinks).toBeGreaterThanOrEqual(1);
    await as(w.clinician, (q) => q("select public.record_outside_dose_staff($1,$2,$3,$4,$5,false)", [op(), w.clinic, r.childId, JSON.stringify({ productText: "DEMO-P-GAMMA", administeredOn: T(-10), provider: "Elsewhere" }), w.products["DEMO-P-GAMMA"]]));
    const after = await jr(w.lead, "select public.report_backlog($1) as r", [w.clinic]);
    expect(after.pendingOutsideDoses).toBe(before.pendingOutsideDoses + 1);
    expect(after.pendingCertificates).toBe(0);
    expect(JSON.stringify(after)).not.toContain("Backlog Kid");
    await expectCode(as(w.assistant, (q) => q("select public.report_backlog($1)", [w.clinic])), "CV403");
  });
});
