/**
 * Backup and restore drill (BP43). Dumps a source database, restores it into a fresh database and PROVES the copy is usable:
 * row counts, stock ledger = projection, certificate snapshot hashes and stored document checksums, immutability triggers,
 * RLS, and the exact set of privileges API roles hold. Local project cluster only; never touches a remote database.
 *
 *   npm run drill:restore                # source cvsrs_test (rich test data) or, if absent, cvsrs_dev
 *   npm run drill:restore -- cvsrs_dev
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { assertProjectCluster, pgExecutable, PORT } from "./db";
import { invalidCertificates } from "./backup-integrity";

const ROOT = resolve(import.meta.dirname, "..");
const url = (db: string) => `postgresql://postgres@127.0.0.1:${PORT}/${db}`;
const exe = pgExecutable;
const TARGET = "cvsrs_drill_restore";

async function exists(db: string) {
  const c = new pg.Client({ connectionString: url("postgres") });
  await c.connect();
  const r = await c.query("select 1 from pg_database where datname = $1", [db]);
  await c.end();
  return r.rowCount === 1;
}

async function facts(db: string) {
  const c = new pg.Client({ connectionString: url(db) });
  await c.connect();
  try {
    const tables = (await c.query(`select schemaname||'.'||relname as t from pg_stat_user_tables where schemaname in ('public','private') order by 1`)).rows.map((r) => r.t as string);
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = Number((await c.query(`select count(*) n from ${t}`)).rows[0].n);
    const ledgerMismatch = Number(
      (
        await c.query(`select count(*) n from (
           select coalesce(l.location_id, b.location_id), coalesce(l.lot_id, b.lot_id) from
             (select location_id, lot_id, sum(quantity_delta) q from public.stock_movements group by 1, 2) l
             full join public.stock_balances b on b.location_id = l.location_id and b.lot_id = l.lot_id
            where coalesce(l.q, 0) <> coalesce(b.on_hand, 0)) x`)
      ).rows[0].n,
    );
    const certs = (await c.query(`select c.id, c.status, c.issued_at, c.content_hash, encode(sha256(convert_to(c.snapshot::text,'UTF8')),'hex') recomputed, d.sha256, encode(sha256(d.pdf),'hex') pdf_actual
                                   from public.certificates c left join private.certificate_documents d on d.certificate_id = c.id`)).rows;
    const badCert = invalidCertificates(certs);
    const guards = Number((await c.query(`select count(*) n from pg_trigger t join pg_class k on k.oid = t.tgrelid join pg_namespace n on n.oid = k.relnamespace where not t.tgisinternal and n.nspname in ('public','private') and t.tgname like any (array['%immutable%','%no_truncate%','%_guard'])`)).rows[0].n);
    const noRls = (await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity order by 1`)).rows.map((r) => r.relname as string);
    const grants = (
      await c.query(`select r.rolname||':'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')' g from pg_proc p join pg_namespace n on n.oid = p.pronamespace, pg_roles r
                      where n.nspname = 'public' and r.rolname in ('anon','authenticated') and has_function_privilege(r.rolname, p.oid, 'execute') order by 1`)
    ).rows.map((r) => r.g as string);
    const tableGrants = (await c.query(`select count(*) n from information_schema.role_table_grants where grantee in ('anon','authenticated') and table_schema in ('public','private')`)).rows[0].n;
    const audit = Number((await c.query(`select count(*) n from private.audit_logs`)).rows[0].n);
    return { counts, ledgerMismatch, certificates: certs.length, badCert, guards, noRls, grantsHash: createHash("sha256").update(grants.join("\n")).digest("hex"), grantCount: grants.length, tableGrants: Number(tableGrants), audit };
  } finally {
    await c.end();
  }
}

const source = process.argv[2] ?? ((await exists("cvsrs_test")) ? "cvsrs_test" : "cvsrs_dev");
if (!/^cvsrs_[a-z0-9_]+$/.test(source) || source === TARGET) throw new Error("refusing: the source must be a project-local cvsrs_* database");
const dir = join(ROOT, ".local", "backups");
mkdirSync(dir, { recursive: true });
const file = join(dir, `${source}-${new Date().toISOString().replace(/[:.]/g, "-")}.dump`);

const t0 = Date.now();
// Validate the connected server before reading or replacing a target, not just immediately before DROP.
const sourceGuard = new pg.Client({ connectionString: url("postgres") });
await sourceGuard.connect();
try { await assertProjectCluster(sourceGuard); } finally { await sourceGuard.end(); }
execFileSync(exe("pg_dump"), ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-Fc", "-f", file, source], { stdio: "inherit" });
const tDump = Date.now() - t0;

const adm = new pg.Client({ connectionString: url("postgres") });
await adm.connect();
try {
  await assertProjectCluster(adm);
  await adm.query(`drop database if exists ${TARGET} with (force)`);
  await adm.query(`create database ${TARGET}`);
} finally {
  await adm.end();
}
const t1 = Date.now();
execFileSync(exe("pg_restore"), ["-h", "127.0.0.1", "-p", String(PORT), "-U", "postgres", "-d", TARGET, "--exit-on-error", file], { stdio: "inherit" });
const tRestore = Date.now() - t1;

const [a, b] = [await facts(source), await facts(TARGET)];
const problems: string[] = [];
for (const t of Object.keys(a.counts)) if (a.counts[t] !== b.counts[t]) problems.push(`row count differs in ${t}: ${a.counts[t]} vs ${b.counts[t]}`);
if (Object.keys(b.counts).length !== Object.keys(a.counts).length) problems.push("table set differs");
if (b.ledgerMismatch !== 0) problems.push(`restored ledger and projection disagree in ${b.ledgerMismatch} place(s)`);
if (b.ledgerMismatch !== a.ledgerMismatch) problems.push("ledger mismatch differs from source");
if (b.badCert !== 0) problems.push(`${b.badCert} restored certificate(s) fail hash/checksum verification`);
if (b.guards !== a.guards || b.guards === 0) problems.push(`immutability guard triggers: source ${a.guards}, restored ${b.guards}`);
if (b.noRls.length > 0) problems.push(`tables without RLS after restore: ${b.noRls.join(", ")}`);
if (a.grantsHash !== b.grantsHash) problems.push("API-role function privileges differ after restore");
if (a.tableGrants !== b.tableGrants) problems.push("API-role table privileges differ after restore");
if (a.audit !== b.audit) problems.push("audit log count differs");

const result = {
  source,
  dumpBytes: statSync(file).size,
  dumpMs: tDump,
  restoreMs: tRestore,
  tables: Object.keys(b.counts).length,
  rows: Object.values(b.counts).reduce((x, y) => x + y, 0),
  certificatesVerified: b.certificates,
  auditRows: b.audit,
  anonAndAuthenticatedFunctionGrants: b.grantCount,
  problems,
};
console.log(JSON.stringify(result, null, 2));
if (problems.length) {
  console.error("RESTORE DRILL FAILED");
  process.exit(1);
}
console.log("RESTORE DRILL PASSED: the restored copy matches the source and every integrity check holds.");
