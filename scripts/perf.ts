/**
 * Measured performance on a synthetic dataset (BP42). Builds a disposable database (cvsrs_perf) with N children, then times the
 * real database commands under a real `authenticated` role. It reports MEASURED numbers; it does not claim a target is met.
 *
 *   npm run perf              # 20,000 children
 *   npm run perf -- 50000
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { reset } from "./db";

const N = Number(process.argv[2] ?? 20000);
const PORT = Number(process.env.CVSRS_DB_PORT ?? 54329);
const url = `postgresql://postgres@127.0.0.1:${PORT}/cvsrs_perf`;

await reset("cvsrs_perf");
const pool = new pg.Pool({ connectionString: url, max: 10 });
const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);

// -- fixture: one clinic, one clinical lead, N synthetic children (fictional names), some visits, doses and stock -------------------
const org = (await q("insert into public.organizations (name) values ('Perf Org') returning id")).rows[0].id as string;
const clinic = (await q("insert into public.clinics (organization_id, name, address) values ($1,'Perf Clinic','x') returning id", [org])).rows[0].id as string;
const lead = randomUUID();
await q("insert into auth.users (id, email) values ($1,'lead@perf.test')", [lead]);
await q("insert into public.profiles (id, display_name) values ($1,'Perf Lead') on conflict do nothing", [lead]);
const approver = randomUUID();
await q("insert into auth.users (id, email) values ($1,'approver@perf.test')", [approver]);
await q("insert into public.profiles (id, display_name) values ($1,'Perf Approver') on conflict do nothing", [approver]);
await q(
  `insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, capabilities, status, requested_by, approved_by)
   values ($1,$2,$3,'clinical_lead','{}','active',$4,$4)`,
  [org, lead, clinic, approver],
);

const t0 = Date.now();
await q(
  `do $$
   declare i int; v_id uuid;
   begin
     for i in 1..${N} loop
       insert into public.children (organization_id, local_record_no, display_name, given_names, family_name, dob, birth_date_precision, record_status)
       values ('${org}', private.next_record_no('${org}'), 'Perf Child ' || i || ' Family' || (i % 700), 'Perf Child ' || i, 'Family' || (i % 700), current_date - (i % 1500), 'exact', 'active')
       returning id into v_id;
       insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, basis) values ('${org}', v_id, '${clinic}', 'active', true, 'clinic_registration');
     end loop;
   end $$`,
);
const seedMs = Date.now() - t0;
const sample = (await q("select id from public.children order by random() limit 50")).rows.map((r) => r.id as string);

async function call(sql: string, params: unknown[]) {
  const c = await pool.connect();
  const s = process.hrtime.bigint();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: lead, role: "authenticated", aal: "aal2" })]);
    await c.query(sql, params);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
  return Number(process.hrtime.bigint() - s) / 1e6;
}
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))]!;
const rows: Record<string, unknown>[] = [];
async function measure(name: string, n: number, fn: (i: number) => Promise<number>, conc = 1) {
  const times: number[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => { while (next < n) { const i = next++; times.push(await fn(i)); } }));
  rows.push({ operation: name, calls: n, concurrency: conc, p50_ms: +pct(times, 50).toFixed(1), p95_ms: +pct(times, 95).toFixed(1), max_ms: +Math.max(...times).toFixed(1) });
}

await call("select 1", []); // warm-up
await measure("staff_search_children (name)", 200, (i) => call("select public.staff_search_children($1,$2,null,20)", [clinic, `Perf Child ${1000 + i * 7}`]));
await measure("staff_search_children (surname prefix)", 100, (i) => call("select public.staff_search_children($1,$2,null,20)", [clinic, `Family${i % 700}`]));
await measure("staff_get_child", 200, (i) => call("select public.staff_get_child($1,$2)", [clinic, sample[i % sample.length]]));
await measure("list_child_history", 200, (i) => call("select public.list_child_history($1,$2)", [clinic, sample[i % sample.length]]));
await measure("report_daily_activity (30 days)", 50, () => call("select public.report_daily_activity($1, current_date - 29, current_date, false)", [clinic]));
await measure("report_stock_summary (30 days)", 50, () => call("select public.report_stock_summary($1, current_date - 29, current_date, false)", [clinic]));
await measure("staff_search_children (name), 8 at once", 200, (i) => call("select public.staff_search_children($1,$2,null,20)", [clinic, `Perf Child ${2000 + i * 3}`]), 8);

console.log(`dataset: ${N} children (built in ${(seedMs / 1000).toFixed(1)} s); database ${((await q("select pg_database_size(current_database()) s")).rows[0].s / 1e6).toFixed(0)} MB`);
console.table(rows);
await pool.end();
