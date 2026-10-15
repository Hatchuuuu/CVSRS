import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { admin, as, expectCode, grant, newUser, op, pool, TEST_URL, type Actor } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let main: string, quarantine: string, otherLoc: string;
let stockManagerApprover: Actor; // holds inventory.manage AND inventory.approve
type R = { r: Record<string, unknown> };

const setting = (k: string, v: unknown) => admin("update private.settings set value = $2::jsonb where key = $1", [k, JSON.stringify(v)]);
const lotOf = async (product: string, code: string, expiresInDays = 200, actor = w.inventory) => {
  const [{ r }] = await as(actor, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5,'Demo Maker') as r", [op(), w.clinic, w.products[product], code, isoDaysFromToday(expiresInDays)]));
  return r.lotId as string;
};
const receive = (lot: string, qty: number, loc = main, ref = "DR-1", accepted = true, actor: Actor = w.inventory) =>
  as(actor, (q) => q<R>("select public.receive_stock($1,$2,$3,$4,$5,$6,$7) as r", [op(), w.clinic, loc, lot, qty, ref, accepted]));
const onHand = async (lot: string, loc = main) => Number((await admin<{ v: string }>("select coalesce(sum(on_hand),0) v from public.stock_balances where lot_id = $1 and location_id = $2", [lot, loc]))[0]!.v);
const ledgerSum = async (lot: string, loc = main) => Number((await admin<{ v: string }>("select coalesce(sum(quantity_delta),0) v from public.stock_movements where lot_id = $1 and location_id = $2", [lot, loc]))[0]!.v);
const movements = async (lot: string) => Number((await admin<{ n: string }>("select count(*) n from public.stock_movements where lot_id = $1", [lot]))[0]!.n);
const usableOf = async (lot: string, actor = w.inventory) => {
  const res = await as(actor, (q) => q<{ r: { lots: { lotId: string; usable: string; physicalOnHand: string }[] } }>("select public.list_stock($1) as r", [w.clinic]));
  const row = res[0]!.r.lots.find((l) => l.lotId === lot)!;
  return { usable: Number(row.usable), physical: Number(row.physicalOnHand) };
};

beforeAll(async () => {
  w = await clinicalWorld();
  stockManagerApprover = await newUser("stockboss");
  await grant(w.org, w.clinic, stockManagerApprover, "inventory", ["inventory.approve"]);
  await setting("adjustment_auto_approve_units", 0);
  await setting("expiry_last_day_usable", true);
  const loc = async (name: string, kind: string, clinic = w.clinic, actor = w.inventory) =>
    (await as(actor, (q) => q<R>("select public.create_stock_location($1,$2,$3,$4) as r", [op(), clinic, name, kind])))[0]!.r.locationId as string;
  main = await loc("Main fridge", "usable");
  quarantine = await loc("Quarantine shelf", "quarantine");
  // another clinic in the same org has its own location
  const invOther = await newUser("invother");
  await grant(w.org, w.otherClinic, invOther, "inventory");
  otherLoc = await loc("Other fridge", "usable", w.otherClinic, invOther);
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("who may do what", () => {
  it("only inventory.manage can create locations, register lots and receive; clinical roles cannot", async () => {
    await expectCode(as(w.assistant, (q) => q("select public.create_stock_location($1,$2,'x','usable')", [op(), w.clinic])), "CV403");
    await expectCode(as(w.clinician, (q) => q("select public.create_stock_location($1,$2,'x','usable')", [op(), w.clinic])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.register_lot($1,$2,$3,'L',current_date + 100)", [op(), w.clinic, w.products["DEMO-P-ALPHA"]])), "CV403"); // lead approves, does not manage
    await expectCode(as({ ...w.inventory, aal: "aal1" }, (q) => q("select public.create_stock_location($1,$2,'x','usable')", [op(), w.clinic])), "CV403");
    await expectCode(as(w.g1, (q) => q("select public.list_stock($1)", [w.clinic])), "CV403");
    await expectCode(as(w.assistant, (q) => q("select public.list_stock($1)", [w.clinic])), "CV403");
    await as(w.clinician, (q) => q("select public.list_stock($1)", [w.clinic])); // needs the picture to choose a lot
  });
  it("staff of another clinic cannot touch this clinic's stock or ledger, even in the same organization", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "SCOPE-1");
    await expectCode(receive(lot, 1, otherLoc), "CV404"); // other clinic's location
    await expectCode(as(w.otherClinicStaff, (q) => q("select public.list_lot_ledger($1,$2)", [w.clinic, lot])), "CV403");
    await expectCode(as(w.otherClinicStaff, (q) => q("select public.list_stock($1)", [w.clinic])), "CV403");
  });
  it("no API role can read or write inventory tables directly", async () => {
    for (const t of ["vaccine_lots", "stock_locations", "stock_transactions", "stock_movements", "stock_balances"]) {
      await expectCode(as(w.inventory, (q) => q(`select * from public.${t}`)), "42501");
      await expectCode(as(w.inventory, (q) => q(`delete from public.${t}`)), "42501");
    }
  });
});

describe("lots and receiving", () => {
  it("rejects expired lots, inactive products, duplicates and non-usable locations; lot identity is immutable", async () => {
    await expectCode(as(w.inventory, (q) => q("select public.register_lot($1,$2,$3,'EXP-1',$4)", [op(), w.clinic, w.products["DEMO-P-ALPHA"], isoDaysFromToday(-1)])), "CV422");
    const [{ r: draft }] = await as(w.techAdmin, (q) => q<R>("select public.create_vaccine_product($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ code: "DEMO-P-DRAFT2", name: "d", presentation: "p", stockUnit: "vial", dosesPerContainer: 1, administrationUnit: "dose", antigenCodes: ["DEMO-ALPHA"] })]));
    await expectCode(as(w.inventory, (q) => q("select public.register_lot($1,$2,$3,'D-1',$4)", [op(), w.clinic, draft.productId, isoDaysFromToday(100)])), "CV422");
    await lotOf("DEMO-P-ALPHA", "DUP-1");
    await expectCode(lotOf("DEMO-P-ALPHA", "DUP-1"), "23505");
    const [row] = await admin<{ id: string }>("select id from public.vaccine_lots where manufacturer_lot = 'DUP-1'");
    await expect(admin("update public.vaccine_lots set expires_on = expires_on + 1 where id = $1", [row!.id])).rejects.toMatchObject({ code: "CV409" });
    const lot = await lotOf("DEMO-P-ALPHA", "REC-LOC");
    await expectCode(receive(lot, 1, quarantine), "CV422"); // receive only into a usable location
  });

  it("validates quantity and delivery reference, and books unaccepted stock into quarantine, never usable", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "RECV-1");
    await expectCode(receive(lot, 0), "CV422");
    await expectCode(receive(lot, -3), "CV422");
    await expectCode(receive(lot, 5, main, "  "), "CV422");
    await receive(lot, 10, main, "DR-100");
    const bad = await receive(lot, 4, main, "DR-101", false);
    expect(bad[0]!.r.locationId).toBe(quarantine);
    const u = await usableOf(lot);
    expect(u).toEqual({ usable: 10, physical: 14 }); // physical and usable are different numbers
    expect(await onHand(lot, quarantine)).toBe(4);
  });

  it("replays idempotently and concurrently without double posting (T05)", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "IDEM-1");
    const key = op();
    const call = () => as(w.inventory, (q) => q<R>("select public.receive_stock($1,$2,$3,$4,5,'DR-IDEM') as r", [key, w.clinic, main, lot]));
    const rs = await Promise.all([call(), call(), call()]);
    expect(new Set(rs.map((x) => x[0]!.r.transactionId)).size).toBe(1);
    expect(await onHand(lot)).toBe(5);
    expect(await movements(lot)).toBe(1);
    await expectCode(as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,6,'DR-IDEM')", [key, w.clinic, main, lot])), "CV409"); // T06
  });
});

describe("ledger is the truth; projection is rebuildable", () => {
  it("serializes two repairs without a shared-to-exclusive lock upgrade", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", `REPAIR-PAIR-${op().slice(0, 8)}`);
    await receive(lot, 4);
    await admin("update public.stock_balances set on_hand = 2 where location_id = $1 and lot_id = $2", [main, lot]);
    const a = new pg.Client({ connectionString: TEST_URL });
    const b = new pg.Client({ connectionString: TEST_URL });
    await Promise.all([a.connect(), b.connect()]);
    const prepare = async (c: pg.Client) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: w.lead.id, role: "authenticated", aal: "aal2" })]);
    };
    try {
      await Promise.all([prepare(a), prepare(b)]);
      const first = await a.query("select public.reconcile_stock($1,$2,true)", [op(), w.clinic]);
      const pending = b.query("select public.reconcile_stock($1,$2,true)", [op(), w.clinic]);
      await a.query("commit");
      const second = await pending;
      await b.query("commit");
      expect(first.rows[0]).toBeDefined();
      expect(second.rows[0]).toBeDefined();
      expect(await onHand(lot)).toBe(4);
      expect(await ledgerSum(lot)).toBe(4);
    } finally {
      await Promise.allSettled([a.query("rollback"), b.query("rollback")]);
      await Promise.all([a.end(), b.end()]);
    }
  }, 10000);

  it("serializes repair against an uncommitted posting without losing the newer ledger total", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", `REPAIR-RACE-${op().slice(0, 8)}`);
    await receive(lot, 10);
    await admin("update public.stock_balances set on_hand = 15 where location_id = $1 and lot_id = $2", [main, lot]);
    const posting = new pg.Client({ connectionString: TEST_URL });
    const repair = new pg.Client({ connectionString: TEST_URL, application_name: "ledger-repair-race" });
    await Promise.all([posting.connect(), repair.connect()]);
    try {
      await posting.query("begin");
      await posting.query("set local role authenticated");
      await posting.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: w.inventory.id, role: "authenticated", aal: "aal2" })]);
      await posting.query("select public.receive_stock($1,$2,$3,$4,3,'RACE')", [op(), w.clinic, main, lot]);
      await repair.query("set application_name = 'ledger-repair-race'");
      await repair.query("begin");
      await repair.query("set local role authenticated");
      await repair.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: w.lead.id, role: "authenticated", aal: "aal2" })]);
      const pending = repair.query("select public.reconcile_stock($1,$2,true)", [op(), w.clinic]);
      let waiting = false;
      for (let i = 0; i < 100; i++) {
        const rows = await admin<{ wait_event_type: string | null }>("select wait_event_type from pg_stat_activity where application_name = 'ledger-repair-race' and state = 'active'");
        if (rows.some((r) => r.wait_event_type === "Lock")) { waiting = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(waiting).toBe(true);
      await posting.query("commit");
      await pending;
      await repair.query("commit");
      expect(await onHand(lot)).toBe(13);
      expect(await ledgerSum(lot)).toBe(13);
    } finally {
      await Promise.allSettled([posting.query("rollback"), repair.query("rollback")]);
      await Promise.all([posting.end(), repair.end()]);
    }
  }, 10000);

  it("movements are immutable, projection equals ledger, and reconcile detects and repairs projection drift", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "LEDGER-1");
    await receive(lot, 20, main, "DR-L1");
    await as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,3,'damaged','INC-1')", [op(), w.clinic, main, lot]));
    expect(await onHand(lot)).toBe(await ledgerSum(lot));
    expect(await onHand(lot)).toBe(17);
    const [mv] = await admin<{ id: string }>("select id from public.stock_movements where lot_id = $1 limit 1", [lot]);
    await expect(admin("update public.stock_movements set quantity_delta = 99 where id = $1", [mv!.id])).rejects.toMatchObject({ code: "CV403" });
    await expect(admin("delete from public.stock_movements where id = $1", [mv!.id])).rejects.toMatchObject({ code: "CV403" });
    // TRUNCATE skips row triggers; every append-only table needs its own statement guard.
    for (const t of ["public.stock_movements", "public.stock_transactions", "public.vaccination_revisions", "public.vaccination_events", "public.schedule_evaluations", "public.dose_credits", "private.audit_logs", "private.command_receipts"]) {
      await expect(admin(`truncate ${t} cascade`)).rejects.toMatchObject({ code: "CV403" });
    }

    await expectCode(as(w.inventory, (q) => q("select public.reconcile_stock($1,$2,false)", [op(), w.clinic])), "CV403");
    const clean = await as(w.lead, (q) => q<R>("select public.reconcile_stock($1,$2,false) as r", [op(), w.clinic]));
    expect(clean[0]!.r.mismatches).toEqual([]);

    await admin("update public.stock_balances set on_hand = on_hand + 5 where lot_id = $1 and location_id = $2", [lot, main]); // simulate drift
    const detect = await as(w.lead, (q) => q<R>("select public.reconcile_stock($1,$2,false) as r", [op(), w.clinic]));
    expect((detect[0]!.r.mismatches as { ledger: string; projection: string }[]).map((m) => [Number(m.ledger), Number(m.projection)])).toEqual([[17, 22]]);
    expect(await onHand(lot)).toBe(22); // detection alone changes nothing
    const fixed = await as(w.lead, (q) => q<R>("select public.reconcile_stock($1,$2,true) as r", [op(), w.clinic]));
    expect(fixed[0]!.r.repaired).toBe(true);
    expect(await onHand(lot)).toBe(17);
    expect(await ledgerSum(lot)).toBe(17); // the ledger was never touched
  });

  it("the projection cannot go negative even if a bug tried", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "NEG-1");
    await receive(lot, 1);
    await expect(admin("update public.stock_balances set on_hand = -1 where lot_id = $1", [lot])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("wastage", () => {
  it("cannot exceed stock, needs a valid reason, and leaves no partial write on failure", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "WASTE-1");
    await receive(lot, 2);
    const before = await movements(lot);
    await expectCode(as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,3,'damaged')", [op(), w.clinic, main, lot])), "CV409");
    await expectCode(as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,1,'because')", [op(), w.clinic, main, lot])), "CV422");
    await expectCode(as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,0,'damaged')", [op(), w.clinic, main, lot])), "CV422");
    expect(await movements(lot)).toBe(before);
    expect(await admin("select 1 from public.stock_transactions where type = 'wastage' and operation_id in (select operation_id from public.stock_transactions where false)")).toHaveLength(0);
    await as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,2,'expired','INC-2')", [op(), w.clinic, main, lot]));
    expect(await onHand(lot)).toBe(0);
  });
  it("failed wastage leaves no orphan transaction row (atomic rollback)", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "WASTE-ATOMIC");
    await receive(lot, 1);
    const key = op();
    const txBefore = Number((await admin<{ n: string }>("select count(*) n from public.stock_transactions"))[0]!.n);
    await expectCode(as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,5,'damaged')", [key, w.clinic, main, lot])), "CV409");
    expect(Number((await admin<{ n: string }>("select count(*) n from public.stock_transactions"))[0]!.n)).toBe(txBefore);
    expect(await admin("select 1 from private.command_receipts where operation_key = $1", [key])).toHaveLength(0); // retry is possible
  });
});

describe("physical count adjustments (BP19)", () => {
  it("above the threshold a count difference is only proposed; a different approver posts it against the CURRENT book balance", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADJ-1");
    await receive(lot, 10);
    const prop = await as(w.inventory, (q) => q<R>("select public.propose_stock_adjustment($1,$2,$3,$4,7,'COUNT-1','recount after delivery') as r", [op(), w.clinic, main, lot]));
    expect(prop[0]!.r).toMatchObject({ status: "pending_approval", delta: -3 });
    expect(await onHand(lot)).toBe(10); // nothing posted yet
    await as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,2,'breakage')", [op(), w.clinic, main, lot])); // stock moves meanwhile: book is now 8
    const caseId = prop[0]!.r.caseId as string;
    await expectCode(as(w.inventory, (q) => q("select public.approve_stock_adjustment($1,$2,$3)", [op(), w.clinic, caseId])), "CV403"); // no approval authority
    await expectCode(as(w.clinician, (q) => q("select public.approve_stock_adjustment($1,$2,$3)", [op(), w.clinic, caseId])), "CV403");
    const done = await as(w.lead, (q) => q<R>("select public.approve_stock_adjustment($1,$2,$3) as r", [op(), w.clinic, caseId]));
    expect(done[0]!.r).toMatchObject({ status: "posted", delta: -1 }); // 8 -> observed 7
    expect(await onHand(lot)).toBe(7);
    const tx = await admin<{ approved_by: string; created_by: string }>("select approved_by, created_by from public.stock_transactions where id = $1", [done[0]!.r.transactionId]);
    expect(tx[0]).toEqual({ approved_by: w.lead.id, created_by: w.inventory.id }); // proposer and approver both recorded
    await expectCode(as(w.lead, (q) => q("select public.approve_stock_adjustment($1,$2,$3)", [op(), w.clinic, caseId])), "CV409");
  });
  it("an actor who holds both manage and approve posts directly, with themselves recorded as approver; equal counts change nothing", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADJ-2");
    await receive(lot, 10);
    const r = await as(stockManagerApprover, (q) => q<R>("select public.propose_stock_adjustment($1,$2,$3,$4,12,'COUNT-2','found extra box') as r", [op(), w.clinic, main, lot]));
    expect(r[0]!.r).toMatchObject({ status: "posted", delta: 2 });
    expect(await onHand(lot)).toBe(12);
    const same = await as(stockManagerApprover, (q) => q<R>("select public.propose_stock_adjustment($1,$2,$3,$4,12,'COUNT-3','recount') as r", [op(), w.clinic, main, lot]));
    expect(same[0]!.r.status).toBe("no_difference");
    expect(await movements(lot)).toBe(2);
  });
  it("requires a count reference and reason, and a non-negative observed count", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ADJ-3");
    await expectCode(as(w.inventory, (q) => q("select public.propose_stock_adjustment($1,$2,$3,$4,-1,'C','reason ok')", [op(), w.clinic, main, lot])), "CV422");
    await expectCode(as(w.inventory, (q) => q("select public.propose_stock_adjustment($1,$2,$3,$4,1,'','reason ok')", [op(), w.clinic, main, lot])), "CV422");
    await expectCode(as(w.inventory, (q) => q("select public.propose_stock_adjustment($1,$2,$3,$4,1,'C','x')", [op(), w.clinic, main, lot])), "CV422");
  });
});

describe("lot disposition, usable vs physical (T13)", () => {
  it("quarantine keeps physical stock but removes it from usable; release and recall need approval authority", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "DISP-1");
    await receive(lot, 6);
    expect(await usableOf(lot)).toEqual({ usable: 6, physical: 6 });
    await expectCode(as(w.assistant, (q) => q("select public.set_lot_disposition($1,$2,$3,'quarantined','suspect storage')", [op(), w.clinic, lot])), "CV403");
    await as(w.inventory, (q) => q("select public.set_lot_disposition($1,$2,$3,'quarantined','possible cold-chain issue')", [op(), w.clinic, lot]));
    expect(await usableOf(lot)).toEqual({ usable: 0, physical: 6 });
    await expectCode(as(w.inventory, (q) => q("select public.set_lot_disposition($1,$2,$3,'usable','looks fine')", [op(), w.clinic, lot])), "CV403"); // release needs approval
    await expectCode(as(w.inventory, (q) => q("select public.set_lot_disposition($1,$2,$3,'recalled','maker notice')", [op(), w.clinic, lot])), "CV403");
    await as(w.lead, (q) => q("select public.set_lot_disposition($1,$2,$3,'recalled','manufacturer recall notice 42')", [op(), w.clinic, lot]));
    await expectCode(receive(lot, 1), "CV409"); // recalled lots cannot be received
    await expectCode(as(w.lead, (q) => q("select public.set_lot_disposition($1,$2,$3,'recalled','again')", [op(), w.clinic, lot])), "CV409");
    await as(w.lead2, (q) => q("select public.set_lot_disposition($1,$2,$3,'usable','recall withdrawn by manufacturer')", [op(), w.clinic, lot]));
    expect(await usableOf(lot)).toEqual({ usable: 6, physical: 6 });
    const audits = await admin<{ action: string }>("select action from private.audit_logs where entity_id = $1 and action in ('stock.lot_quarantined','stock.lot_recalled','stock.lot_usable') order by server_time", [lot]);
    expect(audits.map((a) => a.action)).toEqual(["stock.lot_quarantined", "stock.lot_recalled", "stock.lot_usable"]);
  });
  it("an expired lot's stock stays physical but is not usable; expiry-day handling follows the policy setting", async () => {
    // inserted directly: register_lot correctly refuses already-expired lots
    const [prod] = await admin<{ id: string }>("select id from public.vaccine_products where organization_id = $1 and code = 'DEMO-P-ALPHA'", [w.org]);
    const yesterday = isoDaysFromToday(-1);
    const [{ id: lot }] = await admin<{ id: string }>("insert into public.vaccine_lots (organization_id, product_id, manufacturer_lot, expires_on) values ($1,$2,'EXPIRED-1',$3) returning id", [w.org, prod!.id, yesterday]);
    await admin("insert into public.stock_transactions (organization_id, clinic_id, type, operation_id) values ($1,$2,'receipt',gen_random_uuid())", [w.org, w.clinic]);
    const [tx] = await admin<{ id: string }>("select id from public.stock_transactions order by created_at desc limit 1");
    await admin("insert into public.stock_movements (organization_id, transaction_id, location_id, lot_id, quantity_delta, unit, movement_key) values ($1,$2,$3,$4,4,'vial','seed-exp')", [w.org, tx!.id, main, lot]);
    expect(await usableOf(lot!)).toEqual({ usable: 0, physical: 4 });
    // a lot expiring today: usable when the last day counts, not usable otherwise (policy needs external validation)
    const today = isoDaysFromToday(0);
    const [{ id: lot2 }] = await admin<{ id: string }>("insert into public.vaccine_lots (organization_id, product_id, manufacturer_lot, expires_on) values ($1,$2,'EXPIRES-TODAY',$3) returning id", [w.org, prod!.id, today]);
    await admin("insert into public.stock_movements (organization_id, transaction_id, location_id, lot_id, quantity_delta, unit, movement_key) values ($1,$2,$3,$4,2,'vial','seed-today')", [w.org, tx!.id, main, lot2]);
    expect((await usableOf(lot2!)).usable).toBe(2);
    await setting("expiry_last_day_usable", false);
    try {
      expect((await usableOf(lot2!)).usable).toBe(0);
    } finally {
      await setting("expiry_last_day_usable", true);
    }
  });
});

describe("issue for administration (the primitive M06 will call)", () => {
  const issue = (lot: string, doses = 1, loc = main, event: string | null = null) =>
    admin<{ id: string }>("select private.issue_for_administration($1,$2,$3,$4,$5,$6,$7) id", [w.org, w.clinic, loc, lot, doses, event, op()]);

  it("one single-dose administration consumes exactly one unit and writes one immutable movement", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ISSUE-1");
    await receive(lot, 3);
    await issue(lot);
    expect(await onHand(lot)).toBe(2);
    const mv = await admin<{ quantity_delta: string; type: string }>("select m.quantity_delta, t.type from public.stock_movements m join public.stock_transactions t on t.id = m.transaction_id where m.lot_id = $1 and t.type = 'issue_administration'", [lot]);
    expect(mv.map((m) => Number(m.quantity_delta))).toEqual([-1]);
  });
  it("refuses quarantined, recalled, expired, wrong-location and multi-dose issues", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "ISSUE-2");
    await receive(lot, 2);
    await as(w.inventory, (q) => q("select public.set_lot_disposition($1,$2,$3,'quarantined','hold')", [op(), w.clinic, lot]));
    await expect(issue(lot)).rejects.toMatchObject({ code: "CV409" });
    await expect(issue(lot, 1, quarantine)).rejects.toBeDefined();
    const [{ r: multi }] = await as(w.techAdmin, (q) => q<R>("select public.create_vaccine_product($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ code: "DEMO-P-MULTI", name: "Demo ten-dose vial (fictional)", presentation: "10-dose vial", stockUnit: "vial", dosesPerContainer: 10, administrationUnit: "dose", antigenCodes: ["DEMO-GAMMA"] })]));
    await as(w.lead, (q) => q("select public.set_master_status($1,$2,'product',$3,'active')", [op(), w.clinic, multi.productId]));
    w.products["DEMO-P-MULTI"] = multi.productId as string;
    const mlot = await lotOf("DEMO-P-MULTI", "MULTI-1");
    await receive(mlot, 2);
    await expect(issue(mlot)).rejects.toMatchObject({ code: "CV422" }); // multi-dose workflow not enabled
    // exact unit conversion: numeric, never floating point
    const conv = await admin<{ q: string }>("select private.doses_to_stock_units($1, 3) q", [multi.productId]);
    expect(conv[0]!.q.replace(/0+$/, "").replace(/\.$/, "")).toBe("0.3");
  });
  it("two simultaneous issues of the last unit: exactly one succeeds, the other is refused (T14)", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "RACE-1");
    await receive(lot, 1);
    const results = await Promise.allSettled([issue(lot), issue(lot), issue(lot)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason.code === "CV409")).toBe(true);
    expect(await onHand(lot)).toBe(0);
    expect(await ledgerSum(lot)).toBe(0);
    expect(await movements(lot)).toBe(2); // one receipt, one issue
  });
  it("a wastage and an issue racing for the last unit cannot both succeed", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "RACE-2");
    await receive(lot, 1);
    const waste = as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,1,'damaged')", [op(), w.clinic, main, lot]));
    const results = await Promise.allSettled([issue(lot), waste]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await onHand(lot)).toBe(0);
  });
});

describe("read models", () => {
  it("list_stock separates physical, usable and quarantine; ledger view shows every movement with references", async () => {
    const lot = await lotOf("DEMO-P-ALPHA", "VIEW-1");
    await receive(lot, 8, main, "DR-VIEW");
    await receive(lot, 2, main, "DR-VIEW-BAD", false);
    await as(w.inventory, (q) => q("select public.record_wastage($1,$2,$3,$4,1,'spoiled','INC-9')", [op(), w.clinic, main, lot]));
    expect(await usableOf(lot)).toEqual({ usable: 7, physical: 9 });
    const led = await as(w.inventory, (q) => q<{ r: { type: string; delta: string; reference: string }[] }>("select public.list_lot_ledger($1,$2) as r", [w.clinic, lot]));
    expect(led[0]!.r.map((m) => [m.type, Number(m.delta), m.reference])).toEqual([["receipt", 8, "DR-VIEW"], ["receipt", 2, "DR-VIEW-BAD"], ["wastage", -1, "INC-9"]]);
  });
});
