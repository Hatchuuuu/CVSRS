import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let main: string;
let seq = 0;
type R = { r: Record<string, unknown> };
const T = (n: number) => isoDaysFromToday(n);

const lotOf = async (product: string, code: string, days = 200) =>
  (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5) as r", [op(), w.clinic, w.products[product], code, T(days)])))[0]!.r.lotId as string;
const stock = (lot: string, n: number) => as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,$5,'DR-ADM')", [op(), w.clinic, main, lot, n]));
const onHand = async (lot: string) => Number((await admin<{ v: string }>("select coalesce(sum(on_hand),0) v from public.stock_balances where lot_id = $1", [lot]))[0]!.v);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);

/** A staff-registered, identity-confirmed child. */
async function child(daysOld: number | null, name = "Adm Kid") {
  const [{ r }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, ...(daysOld === null ? {} : { dob: T(-daysOld) }) })]));
  return r.childId as string;
}
/** Walk the child through the real queue to an OPEN encounter. */
async function openEncounter(childId: string) {
  const ci = (await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'test walk-in') as r", [op(), w.clinic, childId])))[0]!.r;
  const called = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, ci.version])))[0]!.r;
  const started = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'in_service',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, called.version])))[0]!.r;
  return { encounterId: started.encounterId as string, entryId: ci.queueEntryId as string, version: started.version as number };
}
const record = (actor: Actor, enc: string, a: Record<string, unknown>, key = op()) =>
  as(actor, (q) => q<R>("select public.record_administration($1,$2,$3,$4) as r", [key, w.clinic, enc, JSON.stringify(a)]));
const args = (lot: string, extra: Record<string, unknown> = {}) => ({ lotId: lot, locationId: main, route: "IM", site: "left thigh", assessmentReference: "AS-1", consentReference: "CN-1", ...extra });

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "adm-v1");
  const loc = async (n: string, k: string) => (await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,$3,$4) as r", [op(), w.clinic, n, k])))[0]!.r.locationId as string;
  main = await loc("Main fridge", "usable");
  await loc("Quarantine shelf", "quarantine");
  await as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: T(0), startTime: "00:00", endTime: "23:59", totalCapacity: 200, onlineCapacity: 0, walkinCapacity: 200 })]));
});
afterAll(async () => {
  await admin("drop trigger if exists fail_after_movement on public.stock_movements").catch(() => undefined);
  await setDemoMode(false);
  await pool.end();
});

describe("normal recording is one atomic transaction (T03)", () => {
  it("commits event, signed revision, exactly one stock issue, credit, outbox, audit and receipt together", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADM-1");
    await stock(lot, 10);
    const kid = await child(40);
    const enc = await openEncounter(kid);
    const res = (await record(w.clinician, enc.encounterId, args(lot)))[0]!.r;
    expect(res.creditedRequirements).toEqual(["A1"]);
    expect(await onHand(lot)).toBe(9);
    const rev = await admin<{ verification_status: string; source: string; administered_by: string; lot_id: string; product_id: string; signed_at: string | null; quantity: string; route: string }>(
      "select verification_status, source, administered_by, lot_id, product_id, signed_at, quantity, route from public.vaccination_revisions where id = $1", [res.revisionId]);
    expect(rev[0]).toMatchObject({ verification_status: "verified", source: "clinic_administered", administered_by: w.clinician.id, lot_id: lot, route: "IM" });
    expect(rev[0]!.signed_at).toBeTruthy();
    expect(await count("select count(*) n from public.stock_transactions where event_id = $1 and type = 'issue_administration'", [(await admin<{ event_id: string }>("select event_id from public.vaccination_revisions where id = $1", [res.revisionId]))[0]!.event_id])).toBe(1);
    expect(await count("select count(*) n from private.outbox_jobs where dedupe_key = $1", ["vax-recorded:" + (await admin<{ event_id: string }>("select event_id from public.vaccination_revisions where id = $1", [res.revisionId]))[0]!.event_id])).toBe(1);
    expect(await count("select count(*) n from private.audit_logs where action = 'vaccination.recorded' and entity_id = (select event_id from public.vaccination_revisions where id = $1)", [res.revisionId])).toBe(1);
    const encRow = await admin<{ assessment_reference: string; consent_reference: string }>("select assessment_reference, consent_reference from public.encounters where id = $1", [enc.encounterId]);
    expect(encRow[0]).toEqual({ assessment_reference: "AS-1", consent_reference: "CN-1" });
    const evals = await admin("select 1 from public.schedule_evaluations e join public.dose_credits c on c.evaluation_id = e.id where e.id = $1 and c.vaccination_revision_id = $2", [res.evaluationId, res.revisionId]);
    expect(evals).toHaveLength(1);
  });

  it("is limited to vaccinators with a valid open visit for a verified child; other roles and clinics are refused", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADM-2");
    await stock(lot, 5);
    const kid = await child(40);
    const enc = await openEncounter(kid);
    await expectCode(record(w.assistant, enc.encounterId, args(lot)), "CV403");
    await expectCode(record(w.inventory, enc.encounterId, args(lot)), "CV403");
    await expectCode(record(w.otherClinicStaff, enc.encounterId, args(lot)), "CV403");
    await expectCode(record({ ...w.clinician, aal: "aal1" }, enc.encounterId, args(lot)), "CV403");
    await expectCode(as(w.g1, (q) => q("select public.record_administration($1,$2,$3,$4)", [op(), w.clinic, enc.encounterId, JSON.stringify(args(lot))])), "CV403");
    await expectCode(record(w.clinician, crypto.randomUUID(), args(lot)), "CV404");
    expect(await onHand(lot)).toBe(5);
    // provisional identity must be confirmed first
    const [{ r }] = await as(w.g1, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Prov Kid", dob: T(-40) })]));
    await as(w.assistant, (q) => q("select public.check_in($1,$2,$3,null,'x1')", [op(), w.clinic, r.childId]));
    const ci = await admin<{ id: string; version: number }>("select id, version from public.queue_entries where child_id = $1", [r.childId]);
    const c1 = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4,'S1') as r", [op(), w.clinic, ci[0]!.id, ci[0]!.version])))[0]!.r;
    const st = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'in_service',$4,'S1') as r", [op(), w.clinic, ci[0]!.id, c1.version])))[0]!.r;
    await expectCode(record(w.clinician, st.encounterId as string, args(lot)), "CV409");
  });

  it("closed visits cannot receive care", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADM-3");
    await stock(lot, 3);
    const kid = await child(40);
    const enc = await openEncounter(kid);
    await as(w.assistant, (q) => q("select public.queue_transition($1,$2,$3,'completed',$4,null,null,'no_service')", [op(), w.clinic, enc.entryId, enc.version]));
    await expectCode(record(w.clinician, enc.encounterId, args(lot)), "CV409");
  });

  it("validates vaccinator authority, product/lot agreement, future time and lot usability", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADM-4");
    await stock(lot, 5);
    const kid = await child(40);
    const enc = await openEncounter(kid);
    await expectCode(record(w.clinician, enc.encounterId, args(lot, { administeredBy: w.assistant.id })), "CV422"); // not a vaccinator
    await expectCode(record(w.clinician, enc.encounterId, args(lot, { productId: w.products["DEMO-P-GAMMA"] })), "CV422");
    await expectCode(record(w.clinician, enc.encounterId, args(lot, { administeredAt: new Date(Date.now() + 3_600_000).toISOString() })), "CV422");
    await expectCode(record(w.clinician, enc.encounterId, { route: "IM" }), "CV422"); // no lot
    await as(w.inventory, (q) => q("select public.set_lot_disposition($1,$2,$3,'quarantined','hold')", [op(), w.clinic, lot]));
    await expectCode(record(w.clinician, enc.encounterId, args(lot)), "CV409");
    expect(await onHand(lot)).toBe(5);
    expect(await count("select count(*) n from public.vaccination_events where encounter_id = $1", [enc.encounterId])).toBe(0);
    // a different named vaccinator who IS authorised is accepted and attributed
    const lot2 = await lotOf("DEMO-P-ALPHA", "ADM-4B");
    await stock(lot2, 2);
    const r = (await record(w.clinician, enc.encounterId, args(lot2, { administeredBy: w.lead.id })))[0]!.r;
    const row = await admin<{ administered_by: string; created_by: string }>("select administered_by, created_by from public.vaccination_revisions where id = $1", [r.revisionId]);
    expect(row[0]).toEqual({ administered_by: w.lead.id, created_by: w.clinician.id }); // vaccinator and recorder stay distinct
  });

  it("multi-dose presentations cannot be recorded until the vial workflow exists", async () => {
    const [{ r }] = await as(w.techAdmin, (q) => q<R>("select public.create_vaccine_product($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ code: "ADM-MULTI", name: "Ten-dose (fictional)", presentation: "vial", stockUnit: "vial", dosesPerContainer: 10, administrationUnit: "dose", antigenCodes: ["DEMO-GAMMA"] })]));
    await as(w.lead, (q) => q("select public.set_master_status($1,$2,'product',$3,'active')", [op(), w.clinic, r.productId]));
    w.products["ADM-MULTI"] = r.productId as string;
    const lot = await lotOf("ADM-MULTI", "MULTI-ADM");
    await stock(lot, 2);
    const enc = await openEncounter(await child(40));
    await expectCode(record(w.clinician, enc.encounterId, args(lot)), "CV422");
    expect(await onHand(lot)).toBe(2);
  });
});

describe("idempotency and atomic rollback (T04-T06)", () => {
  it("same key replays the original receipt; changed payload conflicts; concurrent duplicates create one event and one stock issue", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "IDEM-ADM");
    await stock(lot, 5);
    const enc = await openEncounter(await child(40));
    const key = op();
    const calls = await Promise.allSettled([record(w.clinician, enc.encounterId, args(lot), key), record(w.clinician, enc.encounterId, args(lot), key), record(w.clinician, enc.encounterId, args(lot), key)]);
    const ok = calls.filter((c) => c.status === "fulfilled") as PromiseFulfilledResult<R[]>[];
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((x) => x.value[0]!.r.eventId)).size).toBe(1);
    expect(await onHand(lot)).toBe(4);
    expect(await count("select count(*) n from public.vaccination_events where source_operation_id = $1", [key])).toBe(1);
    await expectCode(record(w.clinician, enc.encounterId, args(lot, { site: "right thigh" }), key), "CV409");
  });

  it("a stock failure rolls the clinical record back too (no partial save)", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "EMPTY-ADM"); // registered but never received: no stock
    const enc = await openEncounter(await child(40));
    const key = op();
    await expectCode(record(w.clinician, enc.encounterId, args(lot), key), "CV409");
    expect(await count("select count(*) n from public.vaccination_events where encounter_id = $1", [enc.encounterId])).toBe(0);
    expect(await count("select count(*) n from public.vaccination_revisions r join public.vaccination_events e on e.id = r.event_id where e.encounter_id = $1", [enc.encounterId])).toBe(0);
    expect(await count("select count(*) n from private.command_receipts where operation_key = $1", [key])).toBe(0);
    expect(await count("select count(*) n from private.outbox_jobs where dedupe_key like 'vax-recorded:%' and payload ->> 'clinicId' = $1 and aggregate_id in (select id from public.vaccination_events where encounter_id = $2)", [w.clinic, enc.encounterId])).toBe(0);
  });

  it("an injected database fault after the event insert leaves nothing behind (T04)", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "FAULT-ADM");
    await stock(lot, 3);
    const enc = await openEncounter(await child(40));
    await admin(`create or replace function public.__fail_after_movement() returns trigger language plpgsql as $$ begin if new.movement_key like 'issue:%' then raise exception 'injected fault' using errcode = 'XX000'; end if; return new; end $$`);
    await admin("create trigger fail_after_movement after insert on public.stock_movements for each row execute function public.__fail_after_movement()");
    try {
      const key = op();
      await expect(record(w.clinician, enc.encounterId, args(lot), key)).rejects.toMatchObject({ code: "XX000" });
      expect(await count("select count(*) n from public.vaccination_events where encounter_id = $1", [enc.encounterId])).toBe(0);
      expect(await onHand(lot)).toBe(3);
      expect(await count("select count(*) n from private.command_receipts where operation_key = $1", [key])).toBe(0);
    } finally {
      await admin("drop trigger if exists fail_after_movement on public.stock_movements");
      await admin("drop function if exists public.__fail_after_movement()");
    }
    // and after the fault is cleared the same recording works
    expect((await record(w.clinician, enc.encounterId, args(lot)))[0]!.r.eventId).toBeTruthy();
  });
});

describe("timing and eligibility per the approved schedule (T07, T08)", () => {
  it("backdated eligibility ignores later verified doses and later holds", async () => {
    const kid = await child(90);
    const [event] = await admin<{ id: string }>("insert into public.vaccination_events (organization_id, original_child_id, origin) values ($1,$2,'external') returning id", [w.org, kid]);
    await admin(`insert into public.vaccination_revisions
      (organization_id,event_id,revision_no,child_id,product_id,administered_on,date_precision,source,verification_status,approved_by)
      values ($1,$2,1,$3,$4,$5,'exact','external_documented','verified',$6)`,
      [w.org, event!.id, kid, w.products["DEMO-P-ALPHA"], T(1), w.lead.id]);
    // Supply the same clinic provenance as place_clinical_hold so dates are clinic-local.
    await admin("insert into public.clinical_holds (organization_id, child_id, placed_clinic_id, reason_code, starts_at) values ($1,$2,$3,'review',now() + interval '1 day')", [w.org, kid, w.clinic]);
    const [row] = await admin<{ r: { blocked: boolean; credited: string[]; reasons: unknown[] } }>(
      "select private.check_planned_dose($1,$2,$3) as r", [kid, w.products["DEMO-P-ALPHA"], T(0)]);
    expect(row!.r.blocked).toBe(false);
    expect(row!.r.credited).toContain("A1");
  });
  it("a dose the schedule does not allow is blocked with an explanation and writes nothing", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "EARLY-1");
    await stock(lot, 3);
    const enc = await openEncounter(await child(3)); // 3 days old: below the rule's minimum age
    await expect(record(w.clinician, enc.encounterId, args(lot))).rejects.toMatchObject({ code: "CV422", message: expect.stringMatching(/approved schedule.*given_before_minimum_age/) });
    expect(await onHand(lot)).toBe(3);
    expect(await count("select count(*) n from public.vaccination_events where encounter_id = $1", [enc.encounterId])).toBe(0);
  });

  it("a child without an exact birth date or with an active hold cannot be vaccinated on the planned path", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "NODOB-1");
    await stock(lot, 3);
    const encNoDob = await openEncounter(await child(null));
    await expect(record(w.clinician, encNoDob.encounterId, args(lot))).rejects.toMatchObject({ code: "CV422", message: expect.stringMatching(/birth_date_not_exact/) });
    const held = await child(40);
    await admin("insert into public.clinical_holds (organization_id, child_id, reason_code) values ($1,$2,'review')", [w.org, held]);
    const encHeld = await openEncounter(held);
    await expect(record(w.clinician, encHeld.encounterId, args(lot))).rejects.toMatchObject({ code: "CV422", message: expect.stringMatching(/clinical_hold/) });
    expect(await onHand(lot)).toBe(3);
  });

  it("a combination product uses one physical dose and earns a credit per antigen (T08)", async () => {
    const lot = await lotOf("DEMO-P-COMBO", "COMBO-ADM");
    await stock(lot, 4);
    const enc = await openEncounter(await child(90));
    const r = (await record(w.clinician, enc.encounterId, args(lot)))[0]!.r;
    expect((r.creditedRequirements as string[]).sort()).toEqual(["A1", "B1"]);
    expect(await onHand(lot)).toBe(3);
    expect(await count("select count(*) n from public.stock_movements where lot_id = $1 and quantity_delta < 0", [lot])).toBe(1);
  });

  it("a possible duplicate needs explicit confirmation; a genuine repeat still has to satisfy the schedule or use the exception path", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "DUP-ADM");
    await stock(lot, 5);
    const kid = await child(60);
    const enc = await openEncounter(kid);
    await record(w.clinician, enc.encounterId, args(lot));
    await expectCode(record(w.clinician, enc.encounterId, args(lot)), "CV409"); // similar record exists
    // confirmed, but a same-day repeat is too early for the next dose in the approved schedule -> explained refusal
    await expect(record(w.clinician, enc.encounterId, args(lot, { confirmRepeat: true }))).rejects.toMatchObject({ code: "CV422" });
    expect(await onHand(lot)).toBe(4);
    // the real repeat is preserved through the exception path as a separate event, uncredited until reviewed
    const rep = (await as(w.clinician, (q) => q<R>("select public.record_administration_exception($1,$2,$3,$4,$5,'genuine repeat dose given') as r", [op(), w.clinic, kid, enc.encounterId, JSON.stringify({ lotId: lot, locationId: main, administeredAt: new Date().toISOString() })])))[0]!.r;
    expect(rep.verificationStatus).toBe("pending_verification");
    expect(await onHand(lot)).toBe(3);
    expect(await count("select count(*) n from public.vaccination_events where original_child_id = $1", [kid])).toBe(2);
  });
});

describe("exception intake for care already given (T15)", () => {
  const exc = (actor: Actor, child_: string, enc: string | null, a: Record<string, unknown>, reason = "given before we could enter it") =>
    as(actor, (q) => q<R>("select public.record_administration_exception($1,$2,$3,$4,$5,$6) as r", [op(), w.clinic, child_, enc, JSON.stringify(a), reason]));

  it("preserves a too-early dose as pending evidence, posts the stock that really was used, opens review, and grants no credit", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "EXC-1");
    await stock(lot, 4);
    const kid = await child(3);
    const enc = await openEncounter(kid);
    const res = (await exc(w.clinician, kid, enc.encounterId, { lotId: lot, locationId: main, administeredAt: new Date().toISOString() }))[0]!.r;
    expect(res).toMatchObject({ verificationStatus: "pending_verification", stockPosted: true, credited: false });
    expect((res.problems as string[]).join(" ")).toMatch(/timing_or_eligibility/);
    expect(await onHand(lot)).toBe(3); // the dose physically left the fridge
    const ev = (await as(w.clinician, (q) => q<{ r: { requirements: { requirement: string; creditedDoseId: string | null }[] } }>("select public.evaluate_child($1,$2) as r", [w.clinic, kid])))[0]!.r;
    expect(ev.requirements.every((x) => x.creditedDoseId === null)).toBe(true); // engine credits only verified revisions
    expect(await count("select count(*) n from public.record_review_cases where vaccination_event_id = $1 and kind = 'clinical' and status = 'open'", [res.eventId])).toBe(1);
    // recorder cannot accept; a lead can, and acceptance still cannot force credit for an early dose
    await expectCode(as(w.clinician, (q) => q("select public.resolve_administration_exception($1,$2,$3,'accept','ok')", [op(), w.clinic, res.eventId])), "CV403");
    await as(w.lead, (q) => q("select public.resolve_administration_exception($1,$2,$3,'accept','fact confirmed by nurse and card')", [op(), w.clinic, res.eventId]));
    const after = (await as(w.clinician, (q) => q<{ r: { requirements: { requirement: string; status: string; creditedDoseId: string | null }[] } }>("select public.evaluate_child($1,$2) as r", [w.clinic, kid])))[0]!.r;
    expect(after.requirements.find((x) => x.requirement === "A1")).toMatchObject({ status: "staff_review_needed", creditedDoseId: null });
    const revs = await admin<{ revision_no: number; verification_status: string }>("select revision_no, verification_status from public.vaccination_revisions where event_id = $1 order by revision_no", [res.eventId]);
    expect(revs.map((x) => x.verification_status)).toEqual(["pending_verification", "verified"]);
  });

  it("never invents stock: an unknown lot or a recalled lot records the care and opens a stock reconciliation item", async () => {
    const kid = await child(40);
    const enc = await openEncounter(kid);
    const before = await count("select count(*) n from public.stock_movements");
    const unknown = (await exc(w.clinician, kid, enc.encounterId, { productId: w.products["DEMO-P-ALPHA"], lotText: "SMUDGED-LOT-7", administeredAt: new Date().toISOString() }, "vial card smudged"))[0]!.r;
    expect(unknown).toMatchObject({ stockPosted: false, verificationStatus: "pending_verification" });
    expect(await count("select count(*) n from public.stock_movements")).toBe(before);
    expect(await count("select count(*) n from public.record_review_cases where vaccination_event_id = $1 and kind = 'stock'", [unknown.eventId])).toBe(1);

    const lot = await lotOf("DEMO-P-ALPHA", "EXC-RECALL");
    await stock(lot, 2);
    await as(w.lead, (q) => q("select public.set_lot_disposition($1,$2,$3,'recalled','maker notice')", [op(), w.clinic, lot]));
    const kid2 = await child(40);
    const rec = (await exc(w.clinician, kid2, null, { lotId: lot, locationId: main, administeredAt: new Date().toISOString() }, "used before recall was known"))[0]!.r;
    expect(rec.stockPosted).toBe(false);
    expect(await onHand(lot)).toBe(2); // no fake deduction from a blocked lot
    expect((rec.problems as string[]).join(" ")).toMatch(/lot_recalled/);
  });

  it("with only a description of the vaccine it is kept but cannot be accepted until mapped to a product", async () => {
    const kid = await child(40);
    const res = (await exc(w.clinician, kid, null, { productText: "vaccine named on a torn card", administeredAt: new Date(Date.now() - 86_400_000).toISOString() }))[0]!.r;
    await expectCode(as(w.lead, (q) => q("select public.resolve_administration_exception($1,$2,$3,'accept','try')", [op(), w.clinic, res.eventId])), "CV422");
    await as(w.lead, (q) => q("select public.resolve_administration_exception($1,$2,$3,'reject','cannot identify the vaccine')", [op(), w.clinic, res.eventId]));
    const cur = await admin<{ verification_status: string; event_status: string }>("select verification_status, event_status from private.current_revisions where event_id = $1", [res.eventId]);
    expect(cur[0]).toEqual({ verification_status: "rejected", event_status: "voided" });
  });

  it("requires a reason, a real time, an identified vaccine, scope and the recording capability", async () => {
    const kid = await child(40);
    const a = { productId: w.products["DEMO-P-ALPHA"], administeredAt: new Date().toISOString() };
    await expectCode(exc(w.clinician, kid, null, a, ""), "CV422");
    await expectCode(exc(w.clinician, kid, null, { productId: w.products["DEMO-P-ALPHA"] }), "CV422");
    await expectCode(exc(w.clinician, kid, null, { administeredAt: new Date().toISOString() }), "CV422");
    await expectCode(exc(w.clinician, kid, null, { ...a, administeredAt: new Date(Date.now() + 3_600_000).toISOString() }), "CV422");
    await expectCode(exc(w.assistant, kid, null, a), "CV403");
    await expectCode(exc(w.otherClinicStaff, kid, null, a), "CV403");
  });
});

describe("corrections keep history and reconcile stock only when physical facts change (T16)", () => {
  async function recorded(lotCode: string, stockQty = 5) {
    const lot = await lotOf("DEMO-P-ALPHA", lotCode);
    await stock(lot, stockQty);
    const kid = await child(40);
    const enc = await openEncounter(kid);
    const r = (await record(w.clinician, enc.encounterId, args(lot)))[0]!.r;
    return { lot, kid, eventId: r.eventId as string };
  }
  const request = (actor: Actor, eventId: string, kind: string, proposal: object, reason = "entered wrong") =>
    as(actor, (q) => q<R>("select public.request_correction($1,$2,$3,$4,$5,$6) as r", [op(), w.clinic, eventId, kind, JSON.stringify(proposal), reason]));
  const approve = (actor: Actor, caseId: string) => as(actor, (q) => q<R>("select public.approve_correction($1,$2,$3,'reviewed') as r", [op(), w.clinic, caseId]));

  it("a wrong lot is fixed by compensating movements: old lot restored, correct lot charged, original revision preserved", async () => {
    const a = await recorded("CORR-A");
    const b = await lotOf("DEMO-P-ALPHA", "CORR-B");
    await stock(b, 3);
    expect(await onHand(a.lot)).toBe(4);
    const c = (await request(w.clinician, a.eventId, "correct_details", { lotId: b, locationId: main }, "wrong vial selected"))[0]!.r;
    await expectCode(approve(w.clinician, c.caseId as string), "CV403"); // proposer has no approval authority
    const done = (await approve(w.lead, c.caseId as string))[0]!.r;
    expect(done.revisionNo).toBe(2);
    expect(await onHand(a.lot)).toBe(5); // returned: the dose was never taken from it
    expect(await onHand(b)).toBe(2); // charged instead
    const revs = await admin<{ revision_no: number; lot_id: string }>("select revision_no, lot_id from public.vaccination_revisions where event_id = $1 order by revision_no", [a.eventId]);
    expect(revs.map((x) => x.lot_id)).toEqual([a.lot, b]);
    const types = await admin<{ type: string }>("select type from public.stock_transactions where event_id = $1 order by created_at", [a.eventId]);
    expect(types.map((t) => t.type)).toEqual(["issue_administration", "reversal", "issue_administration"]);
    expect(Number((await admin<{ n: string }>("select sum(quantity_delta) n from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id where t.event_id = $1", [a.eventId]))[0]!.n)).toBe(-1); // total physical use unchanged
  });

  it("refuses a lot correction the correct lot cannot supply, with nothing partly applied", async () => {
    const a = await recorded("CORR-C");
    const empty = await lotOf("DEMO-P-ALPHA", "CORR-EMPTY");
    const c = (await request(w.clinician, a.eventId, "correct_details", { lotId: empty, locationId: main }))[0]!.r;
    await expectCode(approve(w.lead, c.caseId as string), "CV409");
    expect(await onHand(a.lot)).toBe(4);
    expect(await count("select count(*) n from public.vaccination_revisions where event_id = $1", [a.eventId])).toBe(1);
    expect((await admin<{ status: string }>("select status from public.record_review_cases where id = $1", [c.caseId]))[0]!.status).toBe("open");
  });

  it.each(["correct_again", "return_to_stock", "wastage"])("reverses the current issue after a lot correction: %s", async (next) => {
    const a = await recorded(`CHAIN-A-${next}`);
    const b = await lotOf("DEMO-P-ALPHA", `CHAIN-B-${next}`);
    const c = await lotOf("DEMO-P-ALPHA", `CHAIN-C-${next}`);
    await stock(b, 3);
    await stock(c, 3);
    const first = (await request(w.clinician, a.eventId, "correct_details", { lotId: b, locationId: main }))[0]!.r;
    await approve(w.lead, first.caseId as string);
    const second = (await request(w.clinician, a.eventId, next === "correct_again" ? "correct_details" : "void_duplicate",
      next === "correct_again" ? { lotId: c, locationId: main } : { stockEffect: next }))[0]!.r;
    const key = op();
    const finish = () => as(w.lead, (q) => q<R>("select public.approve_correction($1,$2,$3,'reviewed') r", [key, w.clinic, second.caseId]));
    const done = await finish();
    expect(await finish()).toEqual(done);
    expect(await onHand(a.lot)).toBe(5);
    expect(await onHand(b)).toBe(next === "wastage" ? 2 : 3);
    expect(await onHand(c)).toBe(next === "correct_again" ? 2 : 3);
    const reversals = await admin<{ lot_id: string }>(
      "select m.lot_id from public.stock_transactions reversal join public.stock_movements m on m.transaction_id=reversal.reverses_id where reversal.event_id=$1 and reversal.type='reversal' order by reversal.created_at, reversal.id", [a.eventId],
    );
    expect(reversals.map((r) => r.lot_id)).toEqual([a.lot, b]);
    const revisions = await admin<{ lot_id: string; event_status: string }>(
      "select lot_id,event_status from public.vaccination_revisions where event_id=$1 order by revision_no", [a.eventId],
    );
    expect(revisions.map((r) => r.lot_id)).toEqual([a.lot, b, next === "correct_again" ? c : b]);
    expect(revisions[2]!.event_status).toBe(next === "correct_again" ? "active" : "voided");
    const balances = await admin<{ on_hand: string; ledger: string }>(
      "select balance.on_hand,(select sum(m.quantity_delta) from public.stock_movements m where m.lot_id=balance.lot_id and m.location_id=balance.location_id) ledger from public.stock_balances balance where balance.location_id=$1 and balance.lot_id=any($2::uuid[])", [main, [a.lot, b, c]],
    );
    expect(balances).toHaveLength(3);
    expect(balances.every((r) => Number(r.on_hand) === Number(r.ledger))).toBe(true);
  });

  it("documentation-only corrections change no stock; the proposer can never approve; stale and duplicate requests are refused", async () => {
    const a = await recorded("CORR-D");
    const c = (await request(w.clinician, a.eventId, "correct_details", { route: "SC", site: "right arm" }))[0]!.r;
    await expectCode(request(w.clinician, a.eventId, "correct_details", { route: "IM" }), "CV409"); // one open correction per record
    // lead2 both proposes and tries to approve someone else's, and their own
    await approve(w.lead, c.caseId as string);
    expect(await onHand(a.lot)).toBe(4);
    const cur = await admin<{ route: string; site: string; revision_no: number }>("select route, site, revision_no from private.current_revisions where event_id = $1", [a.eventId]);
    expect(cur[0]).toEqual({ route: "SC", site: "right arm", revision_no: 2 });
    const own = (await request(w.lead2, a.eventId, "correct_details", { site: "left arm" }))[0]!.r;
    await expectCode(approve(w.lead2, own.caseId as string), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.reject_correction($1,$2,$3,'')", [op(), w.clinic, own.caseId])), "CV422");
    await as(w.lead, (q) => q("select public.reject_correction($1,$2,$3,'not supported by the card')", [op(), w.clinic, own.caseId]));
    // a request based on an older revision goes stale
    const stale = (await request(w.clinician, a.eventId, "correct_details", { site: "thigh" }))[0]!.r;
    await admin("update public.record_review_cases set evidence = jsonb_set(evidence, '{baseRevision}', '1') where id = $1", [stale.caseId]);
    await expectCode(approve(w.lead, stale.caseId as string), "CV409");
  });

  it("wrong child: the fact moves to the correct child, credits are recalculated for both, original attribution is preserved", async () => {
    const a = await recorded("CORR-E");
    const other = await child(40, "Right Kid");
    const c = (await request(w.clinician, a.eventId, "reattribute_child", { toChildId: other }, "wrong child selected at the desk"))[0]!.r;
    await approve(w.lead, c.caseId as string);
    const hist = (kid: string) => as(w.clinician, (q) => q<{ r: { eventId: string }[] }>("select public.list_child_history($1,$2) as r", [w.clinic, kid]));
    expect((await hist(a.kid))[0]!.r).toHaveLength(0);
    expect((await hist(other))[0]!.r.map((h) => h.eventId)).toEqual([a.eventId]);
    const first = await admin<{ child_id: string }>("select child_id from public.vaccination_revisions where event_id = $1 and revision_no = 1", [a.eventId]);
    expect(first[0]!.child_id).toBe(a.kid); // immutable history keeps who it was first attributed to
    await expectCode(request(w.clinician, a.eventId, "reattribute_child", {}), "CV422");
    expect(await count("select count(*) n from public.record_review_cases where vaccination_event_id=$1 and kind='correction' and status in ('open','in_review')", [a.eventId])).toBe(0);
    const unchanged = (await request(w.clinician, a.eventId, "reattribute_child", { toChildId: other }))[0]!.r;
    await expectCode(approve(w.lead, unchanged.caseId as string), "CV422");
    expect((await admin<{ child_id: string }>("select child_id from private.current_revisions where event_id=$1", [a.eventId]))[0]!.child_id).toBe(other);
    expect((await admin<{ status: string }>("select status from public.record_review_cases where id=$1", [unchanged.caseId]))[0]!.status).toBe("open");
    await as(w.lead, (q) => q("select public.reject_correction($1,$2,$3,'Already belongs to this child')", [op(), w.clinic, unchanged.caseId]));
    const restored = (await request(w.clinician, a.eventId, "reattribute_child", { toChildId: a.kid }))[0]!.r;
    await approve(w.lead, restored.caseId as string);
    expect((await hist(a.kid))[0]!.r.map((h) => h.eventId)).toEqual([a.eventId]);
    expect((await hist(other))[0]!.r).toHaveLength(0);
    const revisions = await admin<{ child_id: string }>("select child_id from public.vaccination_revisions where event_id=$1 order by revision_no", [a.eventId]);
    expect(revisions.map((r) => r.child_id)).toEqual([a.kid, other, a.kid]);
    expect(await onHand(a.lot)).toBe(4); // stock untouched
  });

  it("voiding a data duplicate returns the unit to stock; a dose that was really wasted is reclassified as wastage instead", async () => {
    const ret = await recorded("VOID-RET");
    const c1 = (await request(w.clinician, ret.eventId, "void_duplicate", { stockEffect: "return_to_stock" }, "typed twice"))[0]!.r;
    await approve(w.lead, c1.caseId as string);
    expect(await onHand(ret.lot)).toBe(5);
    const cur = await admin<{ event_status: string }>("select event_status from private.current_revisions where event_id = $1", [ret.eventId]);
    expect(cur[0]!.event_status).toBe("voided");

    const waste = await recorded("VOID-WASTE");
    const c2 = (await request(w.clinician, waste.eventId, "void_duplicate", { stockEffect: "wastage" }, "vial dropped, not given"))[0]!.r;
    await approve(w.lead, c2.caseId as string);
    expect(await onHand(waste.lot)).toBe(4); // NOT returned to usable stock
    const types = await admin<{ type: string }>("select type from public.stock_transactions where event_id = $1 order by created_at", [waste.eventId]);
    expect(types.map((t) => t.type)).toEqual(["issue_administration", "reversal", "wastage"]);
    await expectCode(request(w.clinician, waste.eventId, "void_duplicate", { stockEffect: "none" }), "CV409"); // already voided
    // the void removes the credit: schedule re-evaluated without it
    const ev = (await as(w.clinician, (q) => q<{ r: { requirements: { requirement: string; creditedDoseId: string | null }[] } }>("select public.evaluate_child($1,$2) as r", [w.clinic, waste.kid])))[0]!.r;
    expect(ev.requirements.find((x) => x.requirement === "A1")!.creditedDoseId).toBeNull();
  });

  it("validates the request: type, reason, scope, and what happened to the vaccine", async () => {
    const a = await recorded("CORR-F");
    await expectCode(request(w.clinician, a.eventId, "erase", {}), "CV422");
    await expectCode(request(w.clinician, a.eventId, "correct_details", {}, ""), "CV422");
    await expectCode(request(w.clinician, a.eventId, "void_duplicate", {}), "CV422");
    await expectCode(request(w.clinician, a.eventId, "reattribute_child", {}), "CV422");
    await expectCode(request(w.assistant, a.eventId, "correct_details", { route: "x" }), "CV403");
    await expectCode(request(w.otherClinicStaff, a.eventId, "correct_details", { route: "x" }), "CV403");
  });
});

describe("visit lookup and lot tracing", () => {
  it("get_open_encounter finds the current visit only for clinic staff of that child's clinic", async () => {
    const kid = await child(40);
    const enc = await openEncounter(kid);
    const got = (await as(w.clinician, (q) => q<{ r: { encounterId: string } }>("select public.get_open_encounter($1,$2) as r", [w.clinic, kid])))[0]!.r;
    expect(got.encounterId).toBe(enc.encounterId);
    expect((await as(w.otherClinicStaff, (q) => q<{ r: unknown }>("select public.get_open_encounter($1,$2) as r", [w.otherClinic, kid])))[0]!.r).toBeNull();
    await expectCode(as(w.g1, (q) => q("select public.get_open_encounter($1,$2)", [w.clinic, kid])), "CV403");
  });

  it("a lot can be traced to the children who received it, by an authorised lead only, and the trace is audited", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "TRACE-1");
    await stock(lot, 5);
    const kids = [await child(40), await child(41)];
    for (const k of kids) await record(w.clinician, (await openEncounter(k)).encounterId, args(lot));
    const trace = (await as(w.lead, (q) => q<{ r: { childId: string; status: string }[] }>("select public.trace_lot_use($1,$2) as r", [w.clinic, lot])))[0]!.r;
    expect(trace.map((t) => t.childId).sort()).toEqual([...kids].sort());
    await expectCode(as(w.inventory, (q) => q("select public.trace_lot_use($1,$2)", [w.clinic, lot])), "CV403");
    await expectCode(as(w.clinician, (q) => q("select public.trace_lot_use($1,$2)", [w.clinic, lot])), "CV403");
    expect(await count("select count(*) n from private.audit_logs where action = 'lot.traced' and entity_id = $1", [lot])).toBe(1);
  });
});

it("saves nurse care instructions atomically with the dose and shares nurse/BHW notes only with verified family", async () => {
 const lot=await lotOf('DEMO-P-ALPHA','CARE-SUMMARY'); await stock(lot,5);
 const [{r:created}]=await as(w.g1,q=>q<{r:{childId:string}}>('select public.create_child_provisional($1,$2,$3) r',[op(),w.clinic,JSON.stringify({displayName:'Family Care Summary Child',dob:T(-40)})]));
 const kid=created.childId;
 const [{version}]=await admin<{version:number}>('select version from public.children where id=$1',[kid]);
 await as(w.assistant,q=>q('select public.confirm_child_identity($1,$2,$3,$4)',[op(),w.clinic,kid,version]));
 const [{id:relationship}]=await admin<{id:string}>('select r.id from public.guardian_child_relationships r join public.guardians g on g.id=r.guardian_id where r.child_id=$1 and g.profile_id=$2',[kid,w.g1.id]);
 await as(w.assistant,q=>q("select public.verify_relationship($1,$2,$3,'in_person_id')",[op(),w.clinic,relationship]));
 const enc=await openEncounter(kid);
 await expectCode(record(w.clinician,enc.encounterId,args(lot,{care:{warningSigns:'x'.repeat(501)}})),'CV422');
 expect(await onHand(lot)).toBe(5);
 const care={medicines:'No medicine given',expectedEffects:'Side effects discussed at the clinic',observations:'Observation recorded by nurse',aftercare:'Home care explained to family',warningSigns:'Escalation instructions explained',followUp:'Return instructions recorded'};
 const key=op(); const [{r}]=await record(w.clinician,enc.encounterId,args(lot,{care}),key);
 expect((await record(w.clinician,enc.encounterId,args(lot,{care}),key))[0].r).toEqual(r);
 expect(await onHand(lot)).toBe(4);
 expect(await count('select count(*) n from public.child_staff_notes where event_id=$1 and administration_summary',[r.eventId])).toBe(1);
 const family=()=>as(w.g1,q=>q<{r:{note:string;authorRole:string;eventId:string}[]}>('select public.guardian_child_notes($1) r',[kid]));
 const [{r:notes}]=await family();
 expect(notes[0]).toMatchObject({authorRole:'clinical_staff',eventId:r.eventId});
 for(const value of Object.values(care)) expect(notes[0].note).toContain(value);
 expect(notes[0].note).toContain('Vaccine given:');
 await expectCode(as(w.g2,q=>q('select public.guardian_child_notes($1)',[kid])),'CV404');
 const bhw=await newUser('care-bhw'); await grant(w.org,w.clinic,bhw,'bhw');
 await expectCode(record(bhw,enc.encounterId,args(lot,{care})),'CV403');
 await as(bhw,q=>q("select public.add_child_note($1,$2,$3,'follow_up','Family follow-up recorded by BHW',true)",[op(),w.clinic,kid]));
 await as(bhw,q=>q("select public.add_child_note($1,$2,$3,'follow_up','Internal follow-up detail',false)",[op(),w.clinic,kid]));
 const [{r:shared}]=await family();
 expect(shared.some(note=>note.authorRole==='bhw'&&note.note==='Family follow-up recorded by BHW')).toBe(true);
 expect(shared.some(note=>note.note==='Internal follow-up detail')).toBe(false);
 const [{r:otherCreated}]=await as(w.g2,q=>q<{r:{childId:string}}>('select public.create_child_provisional($1,$2,$3) r',[op(),w.clinic,JSON.stringify({displayName:'Correct Care Recipient',dob:T(-40)})]));
 const other=otherCreated.childId;
 const [{version:otherVersion}]=await admin<{version:number}>('select version from public.children where id=$1',[other]);
 await as(w.assistant,q=>q('select public.confirm_child_identity($1,$2,$3,$4)',[op(),w.clinic,other,otherVersion]));
 const [{id:otherRelationship}]=await admin<{id:string}>('select r.id from public.guardian_child_relationships r join public.guardians g on g.id=r.guardian_id where r.child_id=$1 and g.profile_id=$2',[other,w.g2.id]);
 await as(w.assistant,q=>q("select public.verify_relationship($1,$2,$3,'in_person_id')",[op(),w.clinic,otherRelationship]));
 const [{r:correction}]=await as(w.clinician,q=>q<{r:{caseId:string}}>("select public.request_correction($1,$2,$3,'reattribute_child',$4,'Wrong child selected at recording') r",[op(),w.clinic,r.eventId,JSON.stringify({toChildId:other})]));
 await as(w.lead,q=>q("select public.approve_correction($1,$2,$3,'Recipient reviewed')",[op(),w.clinic,correction.caseId]));
 const [{r:originalNotes}]=await family();
 expect(originalNotes.some(note=>note.eventId===r.eventId)).toBe(false);
 expect(originalNotes.some(note=>note.note==='Family follow-up recorded by BHW')).toBe(true);
 const [{r:correctNotes}]=await as(w.g2,q=>q<{r:{note:string;authorRole:string;eventId:string}[]}>('select public.guardian_child_notes($1) r',[other]));
 expect(correctNotes).toHaveLength(1);
 expect(correctNotes[0]).toMatchObject({authorRole:'clinical_staff',eventId:r.eventId,note:notes[0].note});

 expect((await record(w.clinician,enc.encounterId,args(lot,{care}),key))[0].r).toEqual(r);

});
