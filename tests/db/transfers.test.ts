import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, newUser, op, pool, type Actor } from "./helpers";
import { clinicalWorld, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let inv2: Actor; // inventory clerk at the OTHER clinic
let hybrid: Actor; // inventory clerk who also holds inventory.approve at the main clinic
let fridgeA: string;
let quarantineA: string;
let fridgeB: string;
let quarantineB: string;
type R = { r: Record<string, unknown> };
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);

const mkLoc = async (a: Actor, clinic: string, name: string, kind: string) => (await as(a, (q) => q<R>("select public.create_stock_location($1,$2,$3,$4) as r", [op(), clinic, name, kind])))[0]!.r.locationId as string;
async function lotWithStock(code: string, units: number) {
  const lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], code, "2099-12-31"])))[0]!.r.lotId as string;
  await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,$5,'DR-TR')", [op(), w.clinic, fridgeA, lot, units]));
  return lot;
}
const send = (a: Actor, lot: string, qty: number, to = w.otherClinic, from = w.clinic, loc = fridgeA, key = op()) =>
  as(a, (q) => q<R>("select public.send_stock_transfer($1,$2,$3,$4,$5,$6,'test shipment') as r", [key, from, to, loc, lot, qty])).then((x) => x[0]!.r);
const receive = (a: Actor, id: string, qty: number, loc = fridgeB, accepted = true, clinic = w.otherClinic) =>
  as(a, (q) => q<R>("select public.receive_stock_transfer($1,$2,$3,$4,$5,$6,null) as r", [op(), clinic, id, loc, qty, accepted])).then((x) => x[0]!.r);
const onHand = async (lot: string, loc: string) => Number((await admin<{ v: string }>("select coalesce(sum(on_hand),0) v from public.stock_balances where lot_id = $1 and location_id = $2", [lot, loc]))[0]!.v);
const transitOf = async (clinic: string) => (await admin<{ id: string }>("select id from public.stock_locations where clinic_id = $1 and kind = 'in_transit'", [clinic]))[0]!.id;
const reading = (a: Actor, loc: string, min: number, max: number, at = new Date().toISOString(), clinic = w.clinic) =>
  as(a, (q) => q<R>("select public.record_temperature($1,$2,$3,$4,$5,$6,null) as r", [op(), clinic, loc, at, min, max])).then((x) => x[0]!.r);

beforeAll(async () => {
  w = await clinicalWorld();
  inv2 = await newUser("inv2");
  hybrid = await newUser("hybrid");
  await grant(w.org, w.otherClinic, inv2, "inventory");
  await grant(w.org, w.clinic, hybrid, "inventory", ["inventory.approve"]);
  fridgeA = await mkLoc(w.inventory, w.clinic, "Fridge A", "usable");
  quarantineA = await mkLoc(w.inventory, w.clinic, "Quarantine A", "quarantine");
  fridgeB = await mkLoc(inv2, w.otherClinic, "Fridge B", "usable");
  quarantineB = await mkLoc(inv2, w.otherClinic, "Quarantine B", "quarantine");
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("sending stock (F13)", () => {
  it("moves stock into the sender's in-transit location; nothing leaves the books and the transaction nets to zero", async () => {
    const lot = await lotWithStock("TR-1", 10);
    const r = await send(w.inventory, lot, 4);
    expect(r).toMatchObject({ status: "in_transit", reference: expect.stringMatching(/^TR-/) });
    const transit = await transitOf(w.clinic);
    expect(await onHand(lot, fridgeA)).toBe(6);
    expect(await onHand(lot, transit)).toBe(4);
    const net = await admin<{ s: string }>("select sum(m.quantity_delta) s from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id where t.source_reference = $1 group by t.id", [r.reference]);
    expect(net.map((x) => Number(x.s))).toEqual([0]);
    expect(await count("select count(*) n from private.audit_logs where action = 'transfer.sent' and entity_id = $1", [r.transferId])).toBe(1);
  });

  it("refuses what cannot be sent, and anyone without the capability at the sending clinic", async () => {
    const lot = await lotWithStock("TR-2", 3);
    await expectCode(send(w.inventory, lot, 4), "CV409"); // more than on hand
    await expectCode(send(w.inventory, lot, 0), "CV422");
    await expectCode(send(w.inventory, lot, 1, w.clinic), "CV422"); // same clinic
    await expectCode(send(w.inventory, lot, 1, crypto.randomUUID()), "CV422");
    await expectCode(send(w.inventory, lot, 1, w.otherClinic, w.clinic, quarantineA), "CV422"); // not a usable location
    for (const a of [w.assistant, w.clinician, w.otherClinicStaff, inv2, w.g1]) await expectCode(send(a, lot, 1), "CV403");
    await expectCode(send({ ...w.inventory, aal: "aal1" }, lot, 1), "CV403");
    await as(w.inventory, (q) => q("select public.set_lot_disposition($1,$2,$3,'quarantined','suspect')", [op(), w.clinic, lot]));
    await expectCode(send(w.inventory, lot, 1), "CV409");
    expect(await onHand(lot, fridgeA)).toBe(3);
  });

  it("is idempotent, including two concurrent sends with the same key", async () => {
    const lot = await lotWithStock("TR-3", 5);
    const key = op();
    const [a, b] = await Promise.all([send(w.inventory, lot, 2, w.otherClinic, w.clinic, fridgeA, key), send(w.inventory, lot, 2, w.otherClinic, w.clinic, fridgeA, key)]);
    expect(a.transferId).toBe(b.transferId);
    expect(await onHand(lot, fridgeA)).toBe(3);
  });
});

describe("receiving and custody", () => {
  it("only the receiving clinic can receive; the stock lands in its location and transit empties", async () => {
    const lot = await lotWithStock("TR-4", 6);
    const t = await send(w.inventory, lot, 5);
    const id = t.transferId as string;
    await expectCode(receive(w.inventory, id, 5, fridgeA, true, w.clinic), "CV404"); // sender's clinic is not the destination
    await expectCode(receive(w.inventory, id, 5, fridgeB, true, w.otherClinic), "CV403"); // no capability at the destination
    await expectCode(receive(inv2, id, 6), "CV422"); // more than sent
    await expectCode(receive(inv2, id, 5, fridgeA), "CV404"); // a location of another clinic
    const r = await receive(inv2, id, 5);
    expect(r).toMatchObject({ status: "received", shortfall: 0 });
    expect(await onHand(lot, fridgeB)).toBe(5);
    expect(await onHand(lot, await transitOf(w.clinic))).toBe(0);
    expect(await onHand(lot, fridgeA)).toBe(1);
    await expectCode(receive(inv2, id, 5), "CV409");
    await expectCode(as(w.inventory, (q) => q("select public.cancel_stock_transfer($1,$2,$3,'too late')", [op(), w.clinic, id])), "CV409");
  });

  it("stock that is not accepted goes to quarantine, never to usable stock", async () => {
    const lot = await lotWithStock("TR-5", 2);
    const t = await send(w.inventory, lot, 2);
    const r = await receive(inv2, t.transferId as string, 2, fridgeB, false);
    expect(r.locationId).toBe(quarantineB);
    expect(await onHand(lot, quarantineB)).toBe(2);
    expect(await onHand(lot, fridgeB)).toBe(0);
  });

  it("cancelling before receipt puts the stock back", async () => {
    const lot = await lotWithStock("TR-6", 4);
    const t = await send(w.inventory, lot, 3);
    await expectCode(as(w.inventory, (q) => q("select public.cancel_stock_transfer($1,$2,$3,' ')", [op(), w.clinic, t.transferId])), "CV422");
    await expectCode(as(inv2, (q) => q("select public.cancel_stock_transfer($1,$2,$3,'not mine')", [op(), w.otherClinic, t.transferId])), "CV404");
    await as(w.inventory, (q) => q("select public.cancel_stock_transfer($1,$2,$3,'sent by mistake')", [op(), w.clinic, t.transferId]));
    expect(await onHand(lot, fridgeA)).toBe(4);
    expect(await onHand(lot, await transitOf(w.clinic))).toBe(0);
    await expectCode(receive(inv2, t.transferId as string, 3), "CV409");
  });
});

describe("short deliveries need a person's decision", () => {
  it("a short delivery keeps the missing units visibly in transit and opens a review case", async () => {
    const lot = await lotWithStock("TR-7", 10);
    const t = await send(w.inventory, lot, 5);
    const r = await receive(inv2, t.transferId as string, 3);
    expect(r).toMatchObject({ status: "received_short", shortfall: 2 });
    expect(await onHand(lot, await transitOf(w.clinic))).toBe(2);
    expect(await count("select count(*) n from public.record_review_cases where kind = 'stock' and clinic_id = $1 and evidence ->> 'transferId' = $2 and status = 'open'", [w.clinic, t.transferId])).toBe(1);
  });

  it("write-off books wastage from transit; the sender cannot resolve their own shipment", async () => {
    const lot = await lotWithStock("TR-8", 10);
    const t = await send(hybrid, lot, 5);
    const id = t.transferId as string;
    await receive(inv2, id, 4);
    await expectCode(as(hybrid, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'write_off','lost in transit',null)", [op(), w.clinic, id])), "CV403"); // sender cannot resolve their own shipment
    await expectCode(as(w.inventory, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'write_off','lost in transit',null)", [op(), w.clinic, id])), "CV403"); // no inventory.approve
    await expectCode(as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'shrug','x',null)", [op(), w.clinic, id])), "CV422");
    await expectCode(as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'write_off',' ',null)", [op(), w.clinic, id])), "CV422");
    await as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'write_off','courier reported a broken box',null)", [op(), w.clinic, id]));
    expect(await onHand(lot, await transitOf(w.clinic))).toBe(0);
    expect(await count("select count(*) n from public.stock_transactions where type = 'wastage' and source_reference = (select reference from public.stock_transfers where id = $1)", [id])).toBe(1);
    expect((await admin<{ status: string }>("select status from public.record_review_cases where evidence ->> 'transferId' = $1", [id]))[0]!.status).toBe("resolved");
    await expectCode(as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'return','again',null)", [op(), w.clinic, id])), "CV409");
  });

  it("return puts the missing units back into a usable location", async () => {
    const lot = await lotWithStock("TR-9", 10);
    const t = await send(w.inventory, lot, 5);
    await receive(inv2, t.transferId as string, 1);
    await expectCode(as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'return','back',$4)", [op(), w.clinic, t.transferId, quarantineA])), "CV422");
    await as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'return','found at the depot',$4)", [op(), w.clinic, t.transferId, fridgeA]));
    expect(await onHand(lot, fridgeA)).toBe(9);
    expect(await onHand(lot, await transitOf(w.clinic))).toBe(0);
  });
});

describe("the books stay true across clinics", () => {
  it("both clinics reconcile (projection = ledger) and the stock report agrees after every kind of transfer", async () => {
    for (const [clinic, actor] of [[w.clinic, w.lead], [w.otherClinic, w.otherClinicStaff]] as const) {
      const rec = (await as(actor === w.lead ? w.lead : inv2, (q) => q<R>("select public.reconcile_stock($1,$2,false) as r", [op(), clinic]).catch(() => [{ r: { mismatches: [] } }] as R[])))[0]!.r;
      expect(rec.mismatches).toEqual([]);
    }
    const from = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10);
    for (const [clinic, actor] of [[w.clinic, w.lead], [w.otherClinic, w.otherClinicStaff]] as const) {
      const rep = (await as(actor, (q) => q<R>("select public.report_stock_summary($1,$2,$3,false) as r", [clinic, from, to])))[0]!.r as { rows: { lot: string; reconciles: boolean }[] };
      expect(rep.rows.length).toBeGreaterThan(0);
      expect(rep.rows.filter((x) => !x.reconciles)).toEqual([]);
    }
  });

  it("transfers, their movements and lists are protected", async () => {
    await expectCode(as(w.g1, (q) => q("select * from public.stock_transfers")), "42501");
    await expectCode(admin("delete from public.stock_transfers"), "CV403");
    const mine = (await as(w.inventory, (q) => q<R>("select public.list_stock_transfers($1) as r", [w.clinic])))[0]!.r as { outgoing: unknown[]; incoming: unknown[]; clinics: { id: string }[] };
    expect(mine.outgoing.length).toBeGreaterThan(3);
    expect(mine.incoming).toHaveLength(0);
    expect(mine.clinics.map((c) => c.id)).toEqual([w.otherClinic]);
    const theirs = (await as(inv2, (q) => q<R>("select public.list_stock_transfers($1) as r", [w.otherClinic])))[0]!.r as { incoming: unknown[] };
    expect(theirs.incoming.length).toBeGreaterThan(3);
    await expectCode(as(w.assistant, (q) => q("select public.list_stock_transfers($1)", [w.clinic])), "CV403");
  });
});

describe("temperature logs (F14)", () => {
  it("readings are kept but not judged until an approver records cold-chain limits with a policy reference", async () => {
    const r = await reading(w.inventory, fridgeA, 3, 7);
    expect(r.status).toBe("no_limits");
    await expectCode(as(w.inventory, (q) => q("select public.set_cold_chain_limits($1,$2,2,8,'clinic cold chain SOP v1')", [op(), w.clinic])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.set_cold_chain_limits($1,$2,2,8,'')", [op(), w.clinic])), "CV422");
    await expectCode(as(w.lead, (q) => q("select public.set_cold_chain_limits($1,$2,8,2,'clinic cold chain SOP v1')", [op(), w.clinic])), "CV422");
    await as(w.lead, (q) => q("select public.set_cold_chain_limits($1,$2,2,8,'clinic cold chain SOP v1')", [op(), w.clinic]));
    expect((await reading(w.inventory, fridgeA, 3, 7)).status).toBe("within_limits");
    expect((await reading(w.inventory, fridgeA, 1.5, 7)).status).toBe("excursion");
    expect((await reading(w.inventory, fridgeA, 3, 9)).status).toBe("excursion");
  });

  it("validates readings and who may log them", async () => {
    const now = Date.now();
    await expectCode(reading(w.inventory, fridgeA, 9, 3), "CV422");
    await expectCode(reading(w.inventory, fridgeA, -90, 3), "CV422");
    await expectCode(reading(w.inventory, fridgeA, 3, 7, new Date(now + 3_600_000).toISOString()), "CV422");
    await expectCode(reading(w.inventory, fridgeA, 3, 7, new Date(now - 15 * 864e5).toISOString()), "CV422");
    await expectCode(reading(w.inventory, await transitOf(w.clinic), 3, 7), "CV422");
    await expectCode(reading(w.assistant, fridgeA, 3, 7), "CV403");
    await expectCode(reading(w.inventory, fridgeB, 3, 7), "CV404"); // a location of another clinic
    await expectCode(reading(inv2, fridgeA, 3, 7), "CV403");
  });

  it("an excursion stays open until a different approver records what was done; nothing is quarantined automatically", async () => {
    const lot = await lotWithStock("TR-T1", 2);
    const r = await reading(w.inventory, fridgeA, 0, 6);
    expect(r.status).toBe("excursion");
    expect((await admin<{ d: string }>("select global_disposition d from public.vaccine_lots where id = $1", [lot]))[0]!.d).toBe("usable");
    const open = async () => Number(((await as(w.inventory, (q) => q<R>("select public.list_temperature($1,14) as r", [w.clinic])))[0]!.r as { openExcursions: number }).openExcursions);
    await expectCode(as(w.inventory, (q) => q("select public.review_temperature_excursion($1,$2,$3,'no_action','fine')", [op(), w.clinic, r.readingId])), "CV403"); // no inventory.approve
    const own = await reading(hybrid, fridgeA, 0, 6);
    await expectCode(as(hybrid, (q) => q("select public.review_temperature_excursion($1,$2,$3,'no_action','I did it')", [op(), w.clinic, own.readingId])), "CV403"); // cannot review their own reading
    const before = await open();
    await expectCode(as(w.lead, (q) => q("select public.review_temperature_excursion($1,$2,$3,'shrug','x')", [op(), w.clinic, r.readingId])), "CV422");
    await expectCode(as(w.lead, (q) => q("select public.review_temperature_excursion($1,$2,$3,'no_action',' ')", [op(), w.clinic, r.readingId])), "CV422");
    await as(w.lead, (q) => q("select public.review_temperature_excursion($1,$2,$3,'lots_quarantined','vials quarantined pending manufacturer advice')", [op(), w.clinic, r.readingId]));
    expect(await open()).toBe(before - 1);
    await expectCode(as(w.lead, (q) => q("select public.review_temperature_excursion($1,$2,$3,'no_action','again')", [op(), w.clinic, r.readingId])), "CV409");
    const okReading = await reading(w.inventory, fridgeA, 4, 5);
    await expectCode(as(w.lead, (q) => q("select public.review_temperature_excursion($1,$2,$3,'no_action','not an excursion')", [op(), w.clinic, okReading.readingId])), "CV409");
  });

  it("readings and limits are immutable, keep the limits in force when they were taken, and are protected", async () => {
    const r = await reading(w.inventory, fridgeA, 3, 7);
    await as(w.lead, (q) => q("select public.set_cold_chain_limits($1,$2,1,9,'revised SOP v2')", [op(), w.clinic]));
    const row = (await admin<{ limit_min_c: string; limit_max_c: string }>("select limit_min_c, limit_max_c from public.temperature_readings where id = $1", [r.readingId]))[0]!;
    expect([Number(row.limit_min_c), Number(row.limit_max_c)]).toEqual([2, 8]);
    await expectCode(admin("update public.temperature_readings set status = 'within_limits'"), "CV403");
    await expectCode(admin("delete from public.temperature_readings"), "CV403");
    await expectCode(admin("update public.cold_chain_limits set max_c = 30"), "CV403");
    await expectCode(admin("truncate public.temperature_reviews"), "CV403");
    await expectCode(as(w.g1, (q) => q("select * from public.temperature_readings")), "42501");
    await expectCode(as(w.assistant, (q) => q("select public.list_temperature($1,14)", [w.clinic])), "CV403");
    const list = (await as(w.inventory, (q) => q<R>("select public.list_temperature($1,14) as r", [w.clinic])))[0]!.r as { limits: { minC: string; policyReference: string }; readings: unknown[] };
    expect(Number(list.limits.minC)).toBe(1);
    expect(list.limits.policyReference).toBe("revised SOP v2");
    expect(list.readings.length).toBeGreaterThan(3);
  });
});

describe("work waiting for a person shows in the backlog report", () => {
  it("counts unreviewed excursions, short deliveries and transfers still in transit", async () => {
    const lot = await lotWithStock("TR-BK", 9);
    const t = await send(w.inventory, lot, 4);
    const short = await send(w.inventory, lot, 3);
    await receive(inv2, short.transferId as string, 1);
    const bad = await reading(w.inventory, fridgeA, -20, 20);
    const b = (await as(w.lead, (q) => q<R>("select public.report_backlog($1) as r", [w.clinic])))[0]!.r as { openTemperatureExcursions: number; transfersNeedingDecision: number; transfersInTransit: number };
    expect(b.openTemperatureExcursions).toBeGreaterThanOrEqual(1);
    expect(b.transfersNeedingDecision).toBeGreaterThanOrEqual(1);
    expect(b.transfersInTransit).toBeGreaterThanOrEqual(1);
    await as(w.lead, (q) => q("select public.review_temperature_excursion($1,$2,$3,'no_action','instrument check showed a faulty probe')", [op(), w.clinic, bad.readingId]));
    await as(w.lead, (q) => q("select public.resolve_transfer_shortfall($1,$2,$3,'write_off','lost in transit',null)", [op(), w.clinic, short.transferId]));
    await as(w.inventory, (q) => q("select public.cancel_stock_transfer($1,$2,$3,'done with test')", [op(), w.clinic, t.transferId]));
    const a = (await as(w.lead, (q) => q<R>("select public.report_backlog($1) as r", [w.clinic])))[0]!.r as typeof b;
    expect(a.openTemperatureExcursions).toBe(b.openTemperatureExcursions - 1);
    expect(a.transfersNeedingDecision).toBe(b.transfersNeedingDecision - 1);
    expect(a.transfersInTransit).toBe(b.transfersInTransit - 1);
  });
});
