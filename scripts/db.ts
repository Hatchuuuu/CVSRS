/**
 * Disposable local PostgreSQL for development and DB tests.
 *
 * This is plain PostgreSQL with a Supabase-compatible bootstrap (roles, auth.uid(),
 * auth.users). It is NOT a Supabase instance: GoTrue, Storage, Realtime and PostgREST
 * are absent. RLS/grant/transaction behavior is real; anything above the DB is not.
 * Destructive resets refuse to run against anything but the project-local cluster.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";

/**
 * PostgreSQL binaries: PG_BIN when set; otherwise a Laragon install on Windows; otherwise the binaries that the embedded-postgres
 * dependency already installed for this platform (so a fresh clone needs no separate PostgreSQL); otherwise whatever is on PATH.
 */
function defaultPgBin(): string {
  if (process.env.PG_BIN) return process.env.PG_BIN;
  const laragon = "C:/laragon/bin/postgresql/postgresql/bin";
  if (process.platform === "win32" && existsSync(join(laragon, "pg_ctl.exe"))) return laragon;
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const bundled = join(resolve(import.meta.dirname, ".."), "node_modules", "@embedded-postgres", `${platform}-${process.arch}`, "native", "bin");
  if (existsSync(join(bundled, `pg_ctl${process.platform === "win32" ? ".exe" : ""}`))) return bundled;
  return "";
}
const PG_BIN = defaultPgBin();
const ROOT = resolve(import.meta.dirname, "..");
const DATA = join(ROOT, ".local", "pgdata");
export const PORT = Number(process.env.CVSRS_DB_PORT ?? 54329);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error("invalid CVSRS_DB_PORT: use an integer from 1024 to 65535");
export const DB_NAME = "cvsrs_dev";
export const ADMIN_URL = `postgresql://postgres@127.0.0.1:${PORT}/postgres`;
export const DB_URL = `postgresql://postgres@127.0.0.1:${PORT}/${DB_NAME}`;

export const pgExecutable = (n: string) => join(PG_BIN, `${n}${process.platform === "win32" ? ".exe" : ""}`);
const exe = pgExecutable;

export function disposableTestName(value = "cvsrs_test"): string {
  if (value !== "cvsrs_test" && !/^cvsrs_audit_[a-z0-9_]+$/.test(value)) throw new Error("refusing test reset: use cvsrs_test or cvsrs_audit_* only");
  return value;
}

/** Check the server we actually connected to before any destructive operation. */
export async function assertProjectCluster(client: { query: (sql: string) => Promise<{ rows: { data_directory: string }[] }> }, expectedDirectory = DATA) {
  const result = await client.query("show data_directory");
  try {
    const expected = realpathSync(expectedDirectory);
    const actual = realpathSync(result.rows[0]?.data_directory);
    const normalize = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
    if (normalize(actual) !== normalize(expected)) throw new Error("different cluster");
  } catch {
    throw new Error("refusing destructive operation: connected server is not this project's disposable cluster");
  }
}

export function start() {
  if (!existsSync(join(DATA, "PG_VERSION"))) {
    mkdirSync(DATA, { recursive: true });
    execFileSync(exe("initdb"), ["-D", DATA, "-U", "postgres", "--auth=trust", "-E", "UTF8", "--locale=C"], { stdio: "inherit" });
  }
  const st = spawnSync(exe("pg_ctl"), ["-D", DATA, "status"]);
  if (st.status === 0) return console.log("already running");
  execFileSync(
    exe("pg_ctl"),
    ["-D", DATA, "-o", `-p ${PORT} -c listen_addresses=127.0.0.1`, "-l", join(ROOT, ".local", "pg.log"), "-w", "start"],
    // "ignore": on Windows the detached server would otherwise keep our pipes open forever.
    { stdio: "ignore" },
  );
}

export function stop() {
  spawnSync(exe("pg_ctl"), ["-D", DATA, "-m", "fast", "stop"], { stdio: "inherit" });
}

export async function applyAll(client: pg.Client) {
  const dir = join(ROOT, "supabase");
  await client.query(readFileSync(join(dir, "bootstrap.sql"), "utf8"));
  const files = readdirSync(join(dir, "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    try {
      await client.query(readFileSync(join(dir, "migrations", f), "utf8"));
    } catch (e) {
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return files;
}

export async function reset(dbName = DB_NAME) {
  // Guard: only ever operate on the project-local disposable cluster.
  if (!existsSync(join(DATA, "PG_VERSION"))) throw new Error("refusing reset: local disposable cluster not initialised");
  if (!/^cvsrs_[a-z0-9_]+$/.test(dbName)) throw new Error("refusing reset: unexpected database name");
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await assertProjectCluster(admin);
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.query(`create database ${dbName}`);
  } finally {
    await admin.end();
  }
  const c = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/${dbName}` });
  await c.connect();
  try {
    return await applyAll(c);
  } finally {
    await c.end();
  }
}

const cmd = process.argv[2];
if (process.argv[1]?.endsWith("db.ts")) {
  if (cmd === "start") start();
  else if (cmd === "stop") stop();
  else if (cmd === "reset") {
    start();
    const files = await reset();
    console.log(`applied bootstrap + ${files.length} migrations`);
  }
}
