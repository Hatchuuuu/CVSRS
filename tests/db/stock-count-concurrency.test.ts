import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { admin, as, expectCode, grant, newUser, op, pool, TEST_URL, type Actor } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let approver: Actor;
let lot: string;
type R = { r: Record<string, unknown> };

beforeAll(async () => {
  w = await clinicalWorld();
  approver = await newUser("count-approver");
  await grant(w.org, w.clinic, approver, "inventory", ["inventory.approve"]);
  await admin("update private.settings set value = '0'::jsonb where key = 'adjustment_auto_approve_units'");
  lot = (await as(w.inventory, (q) => q<R>(
    "select public.register_lot($1,$2,$3,'COUNT-RACE',$4) r",
    [op(), w.clinic, w.products["DEMO-P-ALPHA"], isoDaysFromToday(100)],
  )))[0]!.r.lotId as string;
});
afterAll(async () => { await setDemoMode(false); await pool.end(); });

const proposeSql = "select public.propose_stock_adjustment($1,$2,$3,$4,12,'COUNT-RACE','Physical count') r";

describe("physical count serialization", () => {
  it.each(["existing", "absent", "approval"])("serializes counts with an %s balance", async (kind) => {
    const location = (await as(w.inventory, (q) => q<R>(
      "select public.create_stock_location($1,$2,$3,'usable') r", [op(), w.clinic, `Count ${op()}`],
    )))[0]!.r.locationId as string;
    if (kind === "existing") await as(w.inventory, (q) => q(
      "select public.receive_stock($1,$2,$3,$4,10,'COUNT-SOURCE')", [op(), w.clinic, location, lot],
    ));
    const cases = kind === "approval" ? await Promise.all([1, 2].map(() => as(w.inventory, (q) => q<R>(
      proposeSql, [op(), w.clinic, location, lot],
    )).then((rows) => rows[0]!.r.caseId))) : [];
    // Pending cases created before migration 0045 can have no balance row yet.
    if (kind === "approval") await admin("delete from public.stock_balances where location_id=$1 and lot_id=$2 and on_hand=0", [location, lot]);
    const a = new pg.Client({ connectionString: TEST_URL, statement_timeout: 5000 });
    const b = new pg.Client({ connectionString: TEST_URL, statement_timeout: 5000 });
    await Promise.all([a.connect(), b.connect()]);
    const prepare = async (client: pg.Client) => {
      await client.query("begin");
      await client.query("set local role authenticated");
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: approver.id, role: "authenticated", aal: "aal2" })]);
    };
    try {
      await Promise.all([prepare(a), prepare(b)]);
      const sql = kind === "approval" ? "select public.approve_stock_adjustment($1,$2,$3) r" : proposeSql;
      const args = (index: number) => kind === "approval" ? [op(), w.clinic, cases[index]] : [op(), w.clinic, location, lot];
      await a.query(sql, args(0));
      const pid = (await b.query("select pg_backend_pid() pid")).rows[0].pid as number;
      const pending = b.query<R>(sql, args(1)).then((result) => ({ result }), (error: unknown) => ({ error }));
      let waiting = false;
      const deadline = Date.now() + 2000;
      while (!waiting && Date.now() < deadline) {
        waiting = (await admin<{ waiting: boolean }>(
          "select exists(select 1 from pg_stat_activity where pid=$1 and state='active' and wait_event_type='Lock') waiting", [pid],
        ))[0]!.waiting;
        if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
      }
      await a.query("commit");
      const outcome = await pending;
      if ("error" in outcome) throw outcome.error;
      await b.query("commit");
      expect(waiting).toBe(true);
      const balance = await admin<{ book: string; ledger: string }>(
        "select b.on_hand book, (select sum(quantity_delta) from public.stock_movements where location_id=$1 and lot_id=$2) ledger from public.stock_balances b where b.location_id=$1 and b.lot_id=$2", [location, lot],
      );
      expect(Number(balance[0]!.book)).toBe(12);
      expect(Number(balance[0]!.ledger)).toBe(12);
      expect(outcome.result.rows[0]!.r).toMatchObject(kind === "approval" ? { delta: 0 } : { status: "no_difference" });
    } finally {
      await Promise.allSettled([a.query("rollback"), b.query("rollback")]);
      await Promise.all([a.end(), b.end()]);
    }
  });

  it("refuses an unknown lot even for a zero count", async () => {
    const location = (await as(w.inventory, (q) => q<R>(
      "select public.create_stock_location($1,$2,$3,'usable') r", [op(), w.clinic, `Count ${op()}`],
    )))[0]!.r.locationId as string;
    await expectCode(as(approver, (q) => q(
      "select public.propose_stock_adjustment($1,$2,$3,$4,0,'ZERO','Physical count')", [op(), w.clinic, location, op()],
    )), "CV404");
  });
});
