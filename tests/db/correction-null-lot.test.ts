import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, as, expectCode, op, pool } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld, location: string, lot: string, child: string;
type R = { r: Record<string, unknown> };
beforeAll(async () => {
  w = await clinicalWorld();
  location = (await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,'Audit fridge','usable') as r", [op(), w.clinic])))[0]!.r.locationId as string;
  lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'NULL-LOT-AUDIT',$4) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], isoDaysFromToday(100)])))[0]!.r.lotId as string;
  await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,10,'NULL-LOT-RECEIPT')", [op(), w.clinic, location, lot]));
  child = (await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: "Unknown lot child" })])))[0]!.r.childId as string;
});
afterAll(async () => { await setDemoMode(false); await pool.end(); });

async function correction(lotId: string) {
  const event = (await as(w.clinician, (q) => q<R>("select public.record_administration_exception($1,$2,$3,null,$4,'lot unknown at visit') as r", [op(), w.clinic, child, JSON.stringify({ productText: "Unmapped vaccine", administeredAt: new Date().toISOString() })])))[0]!.r.eventId as string;
  const caseId = (await as(w.clinician, (q) => q<R>("select public.request_correction($1,$2,$3,'correct_details',$4,'lot identified from paper record') as r", [op(), w.clinic, event, JSON.stringify({ lotId, locationId: location })])))[0]!.r.caseId as string;
  return { event, approve: () => as(w.lead, (q) => q<R>("select public.approve_correction($1,$2,$3,null) as r", [op(), w.clinic, caseId])) };
}

it("stores the identified lot/product and posts exactly one stock issue for a previously unknown lot", async () => {
  const c = await correction(lot);
  await c.approve();
  const [revision] = await admin("select lot_id,product_id,revision_no from private.current_revisions where event_id = $1", [c.event]);
  expect(revision).toMatchObject({ lot_id: lot, product_id: w.products["DEMO-P-ALPHA"], revision_no: 2 });
  const [{ n }] = await admin<{ n: string }>("select count(*) as n from public.stock_transactions where event_id=$1 and type='issue_administration'", [c.event]);
  expect(Number(n)).toBe(1);
  const [{ on_hand }] = await admin<{ on_hand: string }>("select on_hand from public.stock_balances where location_id=$1 and lot_id=$2", [location, lot]);
  expect(Number(on_hand)).toBe(9);
});

it("validates the new lot when the old lot was unknown instead of silently approving it", async () => {
  const c = await correction(op());
  await expectCode(c.approve(), "CV422");
  const [revision] = await admin("select lot_id,revision_no from private.current_revisions where event_id=$1", [c.event]);
  expect(revision).toMatchObject({ lot_id: null, revision_no: 1 });
});
