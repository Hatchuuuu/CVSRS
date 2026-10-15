import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { admin, as, expectCode, grant, newUser, op, pool, TEST_URL, type Actor } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let approver: Actor;
let otherInventory: Actor;
let lot: string;
type R = { r: Record<string, unknown> };

const location = async (clinic = w.clinic, actor = w.inventory) => (await as(actor, (q) => q<R>(
  "select public.create_stock_location($1,$2,$3,'usable') r", [op(), clinic, `Location ${op()}`],
)))[0]!.r.locationId as string;
const close = (id: string) => as(w.inventory, (q) => q(
  "select public.close_stock_location($1,$2,$3,'Retired empty fridge')", [op(), w.clinic, id],
));
const count = (id: string, actor = approver) => as(actor, (q) => q<R>(
  "select public.propose_stock_adjustment($1,$2,$3,$4,5,'COUNT-CLOSED','Physical count') r",
  [op(), w.clinic, id, lot],
));

beforeAll(async () => {
  w = await clinicalWorld();
  approver = await newUser("location-approver");
  await grant(w.org, w.clinic, approver, "inventory", ["inventory.approve"]);
  otherInventory = await newUser("location-other-inventory");
  await grant(w.org, w.otherClinic, otherInventory, "inventory");
  await admin("update private.settings set value = '0'::jsonb where key = 'adjustment_auto_approve_units'");
  lot = (await as(w.inventory, (q) => q<R>(
    "select public.register_lot($1,$2,$3,'LOCATION-LIFECYCLE',$4) r",
    [op(), w.clinic, w.products["DEMO-P-ALPHA"], isoDaysFromToday(100)],
  )))[0]!.r.lotId as string;
});

afterAll(async () => { await setDemoMode(false); await pool.end(); });

describe("closed stock locations", () => {
  it("refuses both immediate and pending counts against a closed location", async () => {
    const id = await location();
    await close(id);
    await expectCode(count(id), "CV409");
    await expectCode(count(id, w.inventory), "CV409");
    expect((await admin("select * from public.stock_movements where location_id = $1", [id]))).toHaveLength(0);
  });

  it("cannot approve a count proposed before the empty location was closed", async () => {
    const id = await location();
    const result = await count(id, w.inventory);
    expect(result[0]!.r.status).toBe("pending_approval");
    await close(id);
    await expectCode(as(approver, (q) => q(
      "select public.approve_stock_adjustment($1,$2,$3)", [op(), w.clinic, result[0]!.r.caseId],
    )), "CV409");
    expect((await admin<{ status: string }>("select status from public.record_review_cases where id = $1", [result[0]!.r.caseId]))[0]!.status).toBe("open");
  });

  it.each(["receipt", "transfer"])("serializes a %s behind an uncommitted location closure", async (kind) => {
    const clinic = kind === "transfer" ? w.otherClinic : w.clinic;
    const actor = kind === "transfer" ? otherInventory : w.inventory;
    const id = await location(clinic, actor);
    let transfer: string | undefined;
    if (kind === "transfer") {
      const source = await location();
      await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,5,'TRANSFER-SOURCE')", [op(), w.clinic, source, lot]));
      transfer = (await as(w.inventory, (q) => q<R>(
        "select public.send_stock_transfer($1,$2,$3,$4,$5,5) r", [op(), w.clinic, clinic, source, lot],
      )))[0]!.r.transferId as string;
    }
    const closing = new pg.Client({ connectionString: TEST_URL });
    const receiving = new pg.Client({ connectionString: TEST_URL });
    await Promise.all([closing.connect(), receiving.connect()]);
    const prepare = async (c: pg.Client) => {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: actor.id, role: "authenticated", aal: "aal2" })]);
    };
    try {
      await Promise.all([prepare(closing), prepare(receiving)]);
      await closing.query("select public.close_stock_location($1,$2,$3,'Retired empty fridge')", [op(), clinic, id]);
      const pid = (await receiving.query("select pg_backend_pid() pid")).rows[0].pid as number;
      const request = kind === "transfer"
        ? receiving.query("select public.receive_stock_transfer($1,$2,$3,$4,5)", [op(), clinic, transfer, id])
        : receiving.query("select public.receive_stock($1,$2,$3,$4,5,'RACE-RECEIPT')", [op(), clinic, id, lot]);
      const outcome = request
        .then(() => "posted", (error: { code: string }) => error.code);
      let waiting = false;
      const deadline = Date.now() + 2000;
      while (!waiting && Date.now() < deadline) {
        waiting = (await admin<{ waiting: boolean }>(
          "select exists(select 1 from pg_locks where pid = $1 and locktype = 'advisory' and not granted) waiting", [pid],
        ))[0]!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await closing.query("commit");
      const result = await outcome;
      expect(waiting).toBe(true);
      expect(["CV404", "CV409"]).toContain(result);
      expect((await admin("select * from public.stock_movements where location_id = $1", [id]))).toHaveLength(0);
    } finally {
      await Promise.all([closing.query("rollback"), receiving.query("rollback")]);
      await Promise.all([closing.end(), receiving.end()]);
    }
  });
});
