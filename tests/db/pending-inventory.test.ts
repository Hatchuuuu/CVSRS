import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, newUser, op, pool, type Actor } from "./helpers";
import { clinicalWorld, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let receiver: Actor;
let location: string;
type Reading = { id: string; recordedBy: string; reviewed: boolean };
type Temperature = { openExcursions: number; readings: Reading[] };
type Transfer = { id: string; status: string; sentBy: string };
type Transfers = { outgoing: Transfer[]; incoming: Transfer[] };

beforeAll(async () => {
  w = await clinicalWorld();
  receiver = await newUser("pending-receiver");
  await grant(w.org, w.otherClinic, receiver, "inventory");
  const [row] = await as(w.inventory, q => q<{ r: { locationId: string } }>("select public.create_stock_location($1,$2,'Pending test fridge','usable') as r", [op(), w.clinic]));
  location = row!.r.locationId;
});
afterAll(async () => { await setDemoMode(false); await pool.end(); });

describe("inventory work remains actionable beyond history windows", () => {
  it("keeps an old unresolved excursion visible until a different approver reviews it", async () => {
    // Insert historical fixtures directly: normal entry correctly rejects readings older than 14 days.
    const [old] = await admin<{ id: string }>(
      "insert into public.temperature_readings(organization_id,clinic_id,location_id,observed_at,min_c,max_c,status,recorded_by,operation_id) values ($1,$2,$3,now()-interval '20 days',0,10,'excursion',$4,$5) returning id",
      [w.org, w.clinic, location, w.inventory.id, op()],
    );
    const list = async () => (await as(w.lead, q => q<{ r: Temperature }>("select public.list_temperature($1,14) as r", [w.clinic])))[0]!.r;
    const pending = await list();
    expect(pending.openExcursions).toBe(1);
    expect(pending.readings).toContainEqual(expect.objectContaining({ id: old!.id, recordedBy: w.inventory.id, reviewed: false }));
    await as(w.lead, q => q("select public.review_temperature_excursion($1,$2,$3,'no_action','Historical probe failure reviewed')", [op(), w.clinic, old!.id]));
    const completed = await list();
    expect(completed.openExcursions).toBe(0);
    expect(completed.readings.some(row => row.id === old!.id)).toBe(false);
  });

  it("retains old in-transit and short transfers beyond 50 closed records in both clinic views", async () => {
    const [lot] = await as(w.inventory, q => q<{ r: { lotId: string } }>("select public.register_lot($1,$2,$3,'PENDING-HISTORY','2099-12-31') as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"]]));
    const [transit] = await admin<{ id: string }>("select private.transit_location($1,$2) as id", [w.org, w.clinic]);
    // Historical rows model elapsed time without changing immutable movement history.
    const insert = async (status: string, reference: string, age: number) => (await admin<{ id: string }>(
      `insert into public.stock_transfers(organization_id,from_clinic_id,to_clinic_id,lot_id,from_location_id,transit_location_id,quantity_sent,quantity_received,status,reference,sent_by,sent_at)
       values ($1,$2,$3,$4,$5,$6,2,case when $7='received_short' then 1 when $7='received' then 2 else null end,$7,$8,$9,now()-make_interval(days=>$10)) returning id`,
      [w.org, w.clinic, w.otherClinic, lot!.r.lotId, location, transit!.id, status, reference, w.inventory.id, age],
    ))[0]!.id;
    const pending = await insert("in_transit", "PENDING-OLD", 30);
    const short = await insert("received_short", "SHORT-OLD", 29);
    for (let i = 0; i < 55; i++) await insert("received", `CLOSED-${i}`, 1);
    const outgoing = (await as(w.inventory, q => q<{ r: Transfers }>("select public.list_stock_transfers($1) as r", [w.clinic])))[0]!.r.outgoing;
    const incoming = (await as(receiver, q => q<{ r: Transfers }>("select public.list_stock_transfers($1) as r", [w.otherClinic])))[0]!.r.incoming;
    for (const rows of [outgoing, incoming]) {
      expect(rows).toContainEqual(expect.objectContaining({ id: pending, status: "in_transit", sentBy: w.inventory.id }));
      expect(rows).toContainEqual(expect.objectContaining({ id: short, status: "received_short", sentBy: w.inventory.id }));
      expect(rows.filter(row => row.status === "received")).toHaveLength(50);
    }
  });

  it("does not broaden read access while preserving pending work", async () => {
    await expectCode(as(w.g1, q => q("select public.list_temperature($1,14)", [w.clinic])), "CV403");
    await expectCode(as(receiver, q => q("select public.list_stock_transfers($1)", [w.clinic])), "CV403");
  });
});
