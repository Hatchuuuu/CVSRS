/**
 * Upgrade drill (I4-07). Proves that a POPULATED database created at an older schema version upgrades cleanly to the current one:
 *
 *   1. creates the disposable database cvsrs_audit_upgrade on this project's local cluster (scripts/db.ts; the same guard as the
 *      DB tests: the connected server must be this project's data directory, and only that database name is ever dropped);
 *   2. applies supabase/bootstrap.sql and the migrations up to and including UPGRADE_FROM (0030);
 *   3. populates it through the real public commands under real role switches (authenticated + JWT claims, as PostgREST does):
 *      staff granted through the two-person workflow, a family account with a verified guardian relationship, a booked visit,
 *      stock received into a location, and a vaccination recorded in an open visit;
 *   4. records row counts of every table, applies the remaining migrations in order, and checks that no row was lost, that the
 *      records are still readable through the current read commands as the right roles, that a command still writes, and the
 *      catalog invariants (RLS on every public table, no table-wide writes for API roles, pinned search_path on SECURITY DEFINER
 *      functions, authenticated EXECUTE set = the application's RPC allowlist);
 *   5. drops the database. Exit code 1 on any failure.
 *
 *   npm run drill:upgrade
 *
 * Synthetic data only (fictional schedule from tests/fixtures/synthetic-schedule.ts; demo mode is switched on in this throwaway
 * database only). Never touches the Docker Supabase stacks or any remote database.
 */
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { ADMIN_URL, assertProjectCluster, disposableTestName, PORT, start } from "./db";
import { AUTHENTICATED_PRIVATE_EXECUTE_ALLOWLIST, loadRpcAllowlist } from "./build-supabase-install";
import { DEMO_ANTIGENS, DEMO_PRODUCTS, demoSchedule } from "../tests/fixtures/synthetic-schedule";

const ROOT = resolve(import.meta.dirname, "..");
const DB = disposableTestName("cvsrs_audit_upgrade");
const UPGRADE_FROM = "0030";
const DB_URL = `postgresql://postgres@127.0.0.1:${PORT}/${DB}`;

type Row = Record<string, unknown>;
type Q = <R = Row>(sql: string, params?: unknown[]) => Promise<R[]>;
interface Actor { id: string; label: string }

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  if (!ok) failures.push(what);
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};

async function recreate() {
  const adm = new pg.Client({ connectionString: ADMIN_URL });
  await adm.connect();
  try {
    await assertProjectCluster(adm);
    await adm.query(`drop database if exists ${DB} with (force)`);
    await adm.query(`create database ${DB}`);
  } finally {
    await adm.end();
  }
}

async function drop() {
  const adm = new pg.Client({ connectionString: ADMIN_URL });
  await adm.connect();
  try {
    await assertProjectCluster(adm);
    await adm.query(`drop database if exists ${DB} with (force)`);
  } finally {
    await adm.end();
  }
}

const migrationFiles = () => readdirSync(join(ROOT, "supabase", "migrations")).filter((f) => f.endsWith(".sql")).sort();

async function applyFiles(c: pg.Client, files: string[]) {
  for (const f of files) {
    try {
      await c.query(readFileSync(join(ROOT, "supabase", "migrations", f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
}

/** Runs fn in one transaction as the API role `authenticated` with the actor's JWT claims (aal2), like PostgREST. */
async function as<T>(pool: pg.Pool, actor: Actor, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor.id, role: "authenticated", aal: "aal2" })]);
    const out = await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows as never);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw new Error(`${actor.label}: ${(e as Error).message}`);
  } finally {
    client.release();
  }
}

/** Clinic-local (Asia/Manila, the default clinic timezone) date shifted by n days. */
const day = (n: number) => {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const d = new Date(local + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

interface World {
  org: string; clinic: string; admin: Actor; lead: Actor; nurse: Actor; clerk: Actor; guardian: Actor;
  familyChild: string; walkInChild: string; appointment: string; lot: string; location: string; revision: string; event: string;
}

async function populate(pool: pg.Pool): Promise<World> {
  const su: Q = async (sql, params) => (await pool.query(sql, params as unknown[])).rows as never;
  const user = async (label: string): Promise<Actor> => {
    const id = randomUUID();
    await su("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `${label}-${id.slice(0, 8)}@example.test`, JSON.stringify({ display_name: `Drill ${label}` })]);
    return { id, label };
  };
  const call = async <T = Row>(actor: Actor, sql: string, params: unknown[]): Promise<T> => (await as(pool, actor, (q) => q<{ r: T }>(sql, params)))[0]!.r;
  const op = () => randomUUID();

  // Operator bootstrap as it existed at 0030 (superuser SQL; the audited private.bootstrap_initial_staff arrived in 0034):
  // one organization, one clinic, a technical administrator and a clinical lead who approve each other.
  const [{ id: org }] = await su<{ id: string }>("insert into public.organizations (name) values ('Drill Health Office') returning id");
  const [{ id: clinic }] = await su<{ id: string }>("insert into public.clinics (organization_id, name) values ($1, 'Drill Health Center') returning id", [org]);
  const [adminU, lead, nurse, clerk, guardian] = await Promise.all(["admin", "lead", "nurse", "clerk", "guardian"].map(user));
  await su(`insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, requested_by, approved_by)
            values ($1,$2,$3,'tech_admin','active',$4,$4), ($1,$4,$3,'clinical_lead','active',$2,$2)`, [org, adminU.id, clinic, lead.id]);

  // Further staff through the two-person workflow: a clinical grant approved by the clinical lead, a technical one by the admin.
  const nurseReq = await call<{ membershipId: string }>(adminU, "select public.request_staff_membership($1,$2,$3,'clinical_staff') as r", [op(), clinic, nurse.id]);
  await call(lead, "select public.approve_staff_membership($1,$2,1) as r", [op(), nurseReq.membershipId]);
  const clerkReq = await call<{ membershipId: string }>(lead, "select public.request_staff_membership($1,$2,$3,'inventory') as r", [op(), clinic, clerk.id]);
  await call(adminU, "select public.approve_staff_membership($1,$2,1) as r", [op(), clerkReq.membershipId]);

  // Clinical master data and a governed (fictional) schedule: proposed by the nurse, approved and activated by the lead.
  await su("update private.settings set value = 'true'::jsonb where key = 'demo_mode'");
  for (const [code, name] of DEMO_ANTIGENS) {
    const a = await call<{ antigenId: string }>(adminU, "select public.create_antigen($1,$2,$3,$4) as r", [op(), clinic, code, name]);
    await call(lead, "select public.set_master_status($1,$2,'antigen',$3,'active') as r", [op(), clinic, a.antigenId]);
  }
  const products: Record<string, string> = {};
  for (const p of DEMO_PRODUCTS) {
    const r = await call<{ productId: string }>(adminU, "select public.create_vaccine_product($1,$2,$3) as r", [op(), clinic, JSON.stringify(p)]);
    await call(lead, "select public.set_master_status($1,$2,'product',$3,'active') as r", [op(), clinic, r.productId]);
    products[p.code] = r.productId;
  }
  const draft = await call<{ versionId: string }>(nurse, "select public.import_schedule_draft($1,$2,$3) as r", [op(), clinic, JSON.stringify(demoSchedule("drill-v1"))]);
  await call(nurse, "select public.submit_schedule_for_review($1,$2,$3) as r", [op(), clinic, draft.versionId]);
  await call(lead, "select public.approve_schedule($1,$2,$3) as r", [op(), clinic, draft.versionId]);
  await call(lead, "select public.activate_schedule($1,$2,$3,$4) as r", [op(), clinic, draft.versionId, day(0)]);

  // A family account adds a child; staff confirm the identity and verify the guardian relationship in person.
  const prov = await call<{ childId: string }>(guardian, "select public.create_child_provisional($1,$2,$3) as r", [op(), clinic, JSON.stringify({ displayName: "Drill Family Child", dob: day(-40) })]);
  await call(nurse, "select public.confirm_child_identity($1,$2,$3,1) as r", [op(), clinic, prov.childId]);
  const [rel] = await su<{ id: string }>(
    "select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [guardian.id, prov.childId]);
  await call(nurse, "select public.verify_relationship($1,$2,$3,'in_person_id') as r", [op(), clinic, rel!.id]);

  // Sessions: tomorrow (the family books online) and today (walk-ins for the vaccination).
  const session = (date: string, online: number) => call<{ sessionId: string }>(nurse, "select public.create_session($1,$2,$3) as r",
    [op(), clinic, JSON.stringify({ serviceDate: date, startTime: "00:00", endTime: "23:59", totalCapacity: 20, onlineCapacity: online, walkinCapacity: 20 - online })]);
  const tomorrow = await session(day(1), 10);
  const today = await session(day(0), 0);
  await su("update public.clinic_sessions set ends_at = greatest(ends_at, now() + interval '1 hour') where id = $1", [today.sessionId]);
  const appt = await call<{ appointmentId: string }>(guardian, "select public.book_appointment($1,$2,$3) as r", [op(), prov.childId, tomorrow.sessionId]);

  // Stock: a location, a lot, a received delivery.
  const loc = await call<{ locationId: string }>(clerk, "select public.create_stock_location($1,$2,'Drill fridge','usable') as r", [op(), clinic]);
  const lot = await call<{ lotId: string }>(clerk, "select public.register_lot($1,$2,$3,'DRILL-LOT-1',$4) as r", [op(), clinic, products["DEMO-P-ALPHA"], day(200)]);
  await call(clerk, "select public.receive_stock($1,$2,$3,$4,10,'DR-DRILL-1') as r", [op(), clinic, loc.locationId, lot.lotId]);

  // A walk-in child is checked in, called, seen, and vaccinated from that lot.
  const kid = await call<{ childId: string }>(nurse, "select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), clinic, JSON.stringify({ displayName: "Drill Walk-in Child", dob: day(-40) })]);
  const ci = await call<{ queueEntryId: string; version: number }>(nurse, "select public.check_in($1,$2,$3,null,'drill walk-in') as r", [op(), clinic, kid.childId]);
  const called = await call<{ version: number }>(nurse, "select public.queue_transition($1,$2,$3,'called',$4,'S1') as r", [op(), clinic, ci.queueEntryId, ci.version]);
  const started = await call<{ encounterId: string }>(nurse, "select public.queue_transition($1,$2,$3,'in_service',$4,'S1') as r", [op(), clinic, ci.queueEntryId, called.version]);
  const given = await call<{ revisionId: string }>(nurse, "select public.record_administration($1,$2,$3,$4) as r", [op(), clinic, started.encounterId,
    JSON.stringify({ lotId: lot.lotId, locationId: loc.locationId, route: "IM", site: "left thigh", assessmentReference: "AS-DRILL", consentReference: "CN-DRILL" })]);

  const [{ event_id: event }] = await su<{ event_id: string }>("select event_id from public.vaccination_revisions where id = $1", [given.revisionId]);
  return { org, clinic, admin: adminU, lead, nurse, clerk, guardian, familyChild: prov.childId, walkInChild: kid.childId, appointment: appt.appointmentId,
    lot: lot.lotId, location: loc.locationId, revision: given.revisionId, event };
}

async function counts(pool: pg.Pool) {
  const tables = (await pool.query(`select schemaname || '.' || relname t from pg_stat_user_tables where schemaname in ('public','private','auth') order by 1`)).rows.map((r) => r.t as string);
  const out: Record<string, number> = {};
  for (const t of tables) out[t] = Number((await pool.query(`select count(*) n from ${t}`)).rows[0].n);
  return out;
}

const KEY_TABLES = [
  "public.organizations", "public.clinics", "public.profiles", "public.staff_memberships", "public.children", "public.guardians",
  "public.guardian_child_relationships", "public.clinic_sessions", "public.appointments", "public.queue_entries", "public.encounters",
  "public.stock_locations", "public.vaccine_lots", "public.stock_movements", "public.stock_balances", "public.vaccination_events",
  "public.vaccination_revisions", "public.schedule_versions", "public.vaccine_products", "private.audit_logs", "private.command_receipts", "auth.users",
];

async function verifyAfter(pool: pg.Pool, w: World, before: Record<string, number>) {
  const after = await counts(pool);
  // Data preserved: every table that existed keeps at least its rows; the key tables keep exactly their rows.
  const lost = Object.keys(before).filter((t) => (after[t] ?? -1) < before[t]!);
  check(lost.length === 0, `no table lost rows (${Object.keys(before).length} tables compared)${lost.length ? ": " + lost.map((t) => `${t} ${before[t]}->${after[t] ?? "dropped"}`).join(", ") : ""}`);
  const changed = KEY_TABLES.filter((t) => before[t] !== after[t]);
  check(changed.length === 0 && KEY_TABLES.every((t) => (before[t] ?? 0) > 0),
    `key tables unchanged and populated (${KEY_TABLES.map((t) => `${t.split(".")[1]}=${after[t]}`).join(", ")})${changed.length ? " CHANGED: " + changed.join(", ") : ""}`);
  const grown = Object.keys(before).filter((t) => after[t]! > before[t]!);
  if (grown.length) console.log(`INFO  rows added by the later migrations (backfills): ${grown.map((t) => `${t} ${before[t]}->${after[t]}`).join(", ")}`);
  const added = Object.keys(after).filter((t) => !(t in before));
  console.log(`INFO  tables created by the later migrations: ${added.length ? added.join(", ") : "none"}`);

  // Records still readable through the current read commands, as the right roles.
  const read = <T = Row>(actor: Actor, sql: string, params: unknown[] = []) => as(pool, actor, (q) => q<{ r: T }>(sql, params)).then((x) => x[0]!.r);
  const staffView = await read<{ childId?: string; displayName?: string; identityStatus?: string }>(w.nurse, "select public.staff_get_child($1,$2) as r", [w.clinic, w.familyChild]);
  check(JSON.stringify(staffView).includes(w.familyChild) && JSON.stringify(staffView).includes("Drill Family Child"), "staff_get_child (clinical staff) still returns the family's child");
  const mine = await read<{ childId: string; accessScope: string }[]>(w.guardian, "select public.my_children() as r");
  check(mine.some((c) => c.childId === w.familyChild && c.accessScope === "full"), "my_children (guardian) still shows the child with full access");
  const appts = await read<unknown>(w.guardian, "select public.my_appointments() as r");
  check(JSON.stringify(appts).includes(w.appointment), "my_appointments (guardian) still shows the booked visit");
  const stock = await read<{ lots: { lotId: string; physicalOnHand: string | number }[] }>(w.clerk, "select public.list_stock($1) as r", [w.clinic]);
  const lotRow = stock.lots.find((l) => l.lotId === w.lot);
  check(Number(lotRow?.physicalOnHand) === 9, `list_stock (inventory clerk) still shows the lot with 9 on hand (got ${lotRow?.physicalOnHand})`);
  const history = await read<{ eventId: string }[]>(w.nurse, "select public.list_child_history($1,$2) as r", [w.clinic, w.walkInChild]);
  check(history.some((h) => h.eventId === w.event), "list_child_history (clinical staff) still shows the recorded vaccination");
  const staff = await read<{ profileId?: string }[]>(w.admin, "select public.list_staff_memberships($1) as r", [w.clinic]);
  check(Array.isArray(staff) && staff.length === 4, `list_staff_memberships (access administrator) lists the 4 staff (got ${Array.isArray(staff) ? staff.length : "?"})`);
  // A command still writes after the upgrade: the family moves the visit to a new session.
  const s = await read<{ sessionId: string }>(w.nurse, "select public.create_session($1,$2,$3) as r",
    [randomUUID(), w.clinic, JSON.stringify({ serviceDate: day(2), startTime: "00:00", endTime: "23:59", totalCapacity: 20, onlineCapacity: 10, walkinCapacity: 10 })]);
  const moved = await read<{ appointmentId: string; replaces: string }>(w.guardian, "select public.reschedule_appointment($1,$2,$3) as r", [randomUUID(), w.appointment, s.sessionId]);
  check(moved.replaces === w.appointment, "reschedule_appointment (guardian) writes after the upgrade");
  // The redefined commands are live on the upgraded data: the only clinical approver cannot be revoked (0040, I4-03).
  const [leadM] = (await pool.query("select id from public.staff_memberships where profile_id = $1 and clinic_id = $2", [w.lead.id, w.clinic])).rows as { id: string }[];
  const guard = await read(w.lead, "select public.revoke_staff_membership($1,$2,'drill check') as r", [randomUUID(), leadM!.id]).then(() => "succeeded", (e: Error) => e.message);
  check(/without two different people who can request and approve clinical access/.test(guard), "revoke_staff_membership refuses to remove the last clinical approver on upgraded data");
  // Operator break-glass (0040, I4-18): after an emergency suspension of the only clinical lead, the database owner restores a
  // confirmed account as clinical lead, and the ordinary two-person request/approve works again.
  const su = async <T = Row>(sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as T[];
  await su("select private.set_profile_status($1,'suspended','drill: emergency suspension of the clinical lead')", [w.lead.id]);
  const [replacement, hire] = [{ id: randomUUID(), label: "replacement-lead" }, { id: randomUUID(), label: "new-hire" }];
  for (const u of [replacement, hire]) await su("insert into auth.users (id, email) values ($1, $2)", [u.id, `drill-${u.label}-${u.id.slice(0, 8)}@example.test`]);
  const [{ r: restored }] = await su<{ r: { membershipId: string } }>("select private.restore_clinic_approver($1,$2,'clinical_lead','drill: only clinical lead suspended') as r",
    [w.clinic, `drill-replacement-lead-${replacement.id.slice(0, 8)}@example.test`]);
  const req = await read<{ membershipId: string }>(w.admin, "select public.request_staff_membership($1,$2,$3,'clinical_staff') as r", [randomUUID(), w.clinic, hire.id]);
  await read(replacement, "select public.approve_staff_membership($1,$2,1) as r", [randomUUID(), req.membershipId]);
  const [{ status: hired }] = await su<{ status: string }>("select status from public.staff_memberships where id = $1", [req.membershipId]);
  check(Boolean(restored.membershipId) && hired === "active", "restore_clinic_approver (database owner) reopens the two-person path on upgraded data");
  // Operator command to add a second health center to the upgraded organization (0040, QA-03); families see it in the directory.
  const [{ r: second }] = await su<{ r: { clinicId: string } }>("select private.add_clinic($1,'Drill Second Health Center','Asia/Manila','drill: second health center opened') as r", [w.org]);
  const directory = await read<{ id: string }[]>(w.guardian, "select public.list_public_clinics() as r");
  check(directory.some((c) => c.id === second.clinicId), "add_clinic (database owner) adds a health center that appears in list_public_clinics");

  // Catalog invariants of the final schema.
  const q = async <T = Row>(sql: string) => (await pool.query(sql)).rows as T[];
  const noRls = await q<{ t: string }>(`select c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity order by 1`);
  check(noRls.length === 0, `RLS enabled on every public table${noRls.length ? ": missing on " + noRls.map((r) => r.t).join(", ") : ""}`);
  const writes = await q<{ t: string }>(`select r.rolname || ' on ' || c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace,
      (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')
      and has_table_privilege(r.rolname, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE') order by 1`);
  check(writes.length === 0, `no table-wide INSERT/UPDATE/DELETE/TRUNCATE for anon/authenticated on public relations${writes.length ? ": " + writes.map((r) => r.t).join(", ") : ""}`);
  const cols = await q<{ t: string }>(`select r.rolname || ' on ' || c.relname || '.' || a.attname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped, (values ('anon'), ('authenticated')) r(rolname)
    where n.nspname = 'public' and c.relkind in ('r','p') and has_column_privilege(r.rolname, c.oid, a.attnum, 'INSERT, UPDATE')
      and not (r.rolname = 'authenticated' and c.relname = 'profiles' and a.attname in ('display_name','locale')) order by 1`);
  check(cols.length === 0, `column INSERT/UPDATE only on profiles(display_name, locale) for authenticated${cols.length ? ": " + cols.map((r) => r.t).join(", ") : ""}`);
  const unpinned = await q<{ f: string }>(`select n.nspname || '.' || p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef and not ('search_path=""' = any (coalesce(p.proconfig, '{}'::text[]))) order by 1`);
  check(unpinned.length === 0, `every SECURITY DEFINER function pins an empty search_path${unpinned.length ? ": " + unpinned.map((r) => r.f).join(", ") : ""}`);
  const executable = (await q<{ f: string }>(`select distinct p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`)).map((r) => r.f);
  const allow = loadRpcAllowlist();
  const extra = executable.filter((f) => !allow.includes(f));
  const missing = allow.filter((f) => !executable.includes(f));
  check(extra.length === 0 && missing.length === 0,
    `authenticated EXECUTE set on public equals the RPC allowlist (${allow.length})${extra.length ? "; not allow-listed: " + extra.join(", ") : ""}${missing.length ? "; not executable: " + missing.join(", ") : ""}`);
  const privateExec = (await q<{ f: string }>(`select distinct p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`)).map((r) => r.f);
  const privateExtra = privateExec.filter((f) => !(AUTHENTICATED_PRIVATE_EXECUTE_ALLOWLIST as readonly string[]).includes(f));
  check(privateExtra.length === 0, `authenticated EXECUTE on private only for the RLS helpers${privateExtra.length ? ": " + privateExtra.join(", ") : ""}`);
}

async function main() {
  start();
  const files = migrationFiles();
  const older = files.filter((f) => f.slice(0, 4) <= UPGRADE_FROM);
  const newer = files.filter((f) => f.slice(0, 4) > UPGRADE_FROM);
  if (older[older.length - 1]?.slice(0, 4) !== UPGRADE_FROM || newer.length === 0) throw new Error(`expected migrations up to ${UPGRADE_FROM} and at least one after it`);
  const t0 = Date.now();
  await recreate();
  const pool = new pg.Pool({ connectionString: DB_URL, max: 4 });
  try {
    const c = await pool.connect();
    try {
      await c.query(readFileSync(join(ROOT, "supabase", "bootstrap.sql"), "utf8"));
      await applyFiles(c as unknown as pg.Client, older);
    } finally {
      c.release();
    }
    console.log(`INFO  ${DB}: bootstrap + ${older.length} migrations (${older[0]!.slice(0, 4)}..${UPGRADE_FROM}) applied`);
    const w = await populate(pool);
    const before = await counts(pool);
    console.log(`INFO  populated through the real commands: ${KEY_TABLES.map((t) => `${t.split(".")[1]}=${before[t]}`).join(", ")}`);
    const c2 = await pool.connect();
    try {
      await applyFiles(c2 as unknown as pg.Client, newer);
    } finally {
      c2.release();
    }
    console.log(`INFO  upgraded with ${newer.length} migrations (${newer[0]!.slice(0, 4)}..${newer[newer.length - 1]!.slice(0, 4)})`);
    await verifyAfter(pool, w, before);
  } catch (e) {
    failures.push((e as Error).message);
    console.error(`FAIL  ${(e as Error).message}`);
  } finally {
    await pool.end();
    await drop();
  }
  console.log(`\nupgrade drill ${UPGRADE_FROM} -> ${files[files.length - 1]!.slice(0, 4)}: ${failures.length === 0 ? "PASSED" : `FAILED (${failures.length})`} in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${DB} dropped`);
  if (failures.length) process.exit(1);
}

await main();
