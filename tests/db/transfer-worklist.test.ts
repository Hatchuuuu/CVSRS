import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, newUser, op, pool, type Actor } from "./helpers";
import { clinicalWorld, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let receiver: Actor;
let source: string, destination: string, lot: string;
let waiting: string, shortfall: string;
const history: string[] = [];
type R = { r: Record<string, unknown> };
interface Transfer { id: string; status: string; reference: string }
interface Transfers { incoming: Transfer[]; outgoing: Transfer[]; clinics: { id: string; name: string }[] }
const send = async (quantity = 1) => (await as(w.inventory, (q) => q<R>(
  "select public.send_stock_transfer($1,$2,$3,$4,$5,$6) r", [op(), w.clinic, w.otherClinic, source, lot, quantity],
)))[0]!.r.transferId as string;
const receive = (id: string, quantity = 1) => as(receiver, (q) => q(
  "select public.receive_stock_transfer($1,$2,$3,$4,$5)", [op(), w.otherClinic, id, destination, quantity],
));
const list = async (actor: Actor, clinic: string) => (await as(actor, (q) => q<{ r: Transfers }>(
  "select public.list_stock_transfers($1) r", [clinic],
)))[0]!.r;

beforeAll(async () => {
  w = await clinicalWorld();
  receiver = await newUser("transfer-worklist-receiver");
  await grant(w.org, w.otherClinic, receiver, "inventory");
  source = (await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,'Worklist source','usable') r", [op(), w.clinic])))[0]!.r.locationId as string;
  destination = (await as(receiver, (q) => q<R>("select public.create_stock_location($1,$2,'Worklist destination','usable') r", [op(), w.otherClinic])))[0]!.r.locationId as string;
  lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'TRANSFER-WORKLIST','2099-12-31') r", [op(), w.clinic, w.products["DEMO-P-ALPHA"]])))[0]!.r.lotId as string;
  await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,200,'WORKLIST-RECEIPT')", [op(), w.clinic, source, lot]));
  waiting = await send();
  shortfall = await send(2);
  await receive(shortfall, 1);
  // Use the full custody workflow so terminal history has real stock movements.
  for (let i = 0; i < 51; i++) {
    const id = await send();
    await receive(id);
    history.push(id);
  }
});
afterAll(async () => { await setDemoMode(false); await pool.end(); });

describe("stock transfer action lists", () => {
  it("retains old incoming arrivals and outgoing shortfalls beyond fifty newer completed transfers", async () => {
    const outgoing = (await list(w.inventory, w.clinic)).outgoing;
    const incoming = (await list(receiver, w.otherClinic)).incoming;
    for (const items of [outgoing, incoming]) {
      expect(items.find((item) => item.id === waiting)?.status).toBe("in_transit");
      expect(items.find((item) => item.id === shortfall)?.status).toBe("received_short");
      expect(items.filter((item) => item.status === "received")).toHaveLength(50);
      expect(items).toHaveLength(52);
      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
      expect(items.map((item) => item.id)).not.toContain(history[0]);
      expect(items.map((item) => item.id)).toContain(history[50]);
    }
  });

  it("retains every actionable transfer even when more than fifty remain open", async () => {
    const additional: string[] = [];
    for (let i = 0; i < 51; i++) additional.push(await send());
    for (const items of [(await list(w.inventory, w.clinic)).outgoing, (await list(receiver, w.otherClinic)).incoming]) {
      const pending = items.filter((item) => ["in_transit", "received_short"].includes(item.status));
      expect(new Set(pending.map((item) => item.id))).toEqual(new Set([waiting, shortfall, ...additional]));
      expect(items.filter((item) => item.status === "received")).toHaveLength(50);
      expect(items).toHaveLength(103);
    }
  });

  it("preserves the clinic directory and permission checks", async () => {
    const result = await list(w.lead, w.clinic);
    expect(result.clinics).toEqual([{ id: w.otherClinic, name: "Other Clinic" }]);
    expect(result.incoming).toEqual([]);
    await expectCode(list(receiver, w.clinic), "CV403");
    await expectCode(list(w.g1, w.clinic), "CV403");
    expect((await admin<{ n: string }>("select count(*) n from public.stock_transfers where from_clinic_id = $1", [w.clinic]))[0]!.n).toBe("104");
  });
});
