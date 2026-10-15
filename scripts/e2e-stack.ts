/**
 * Isolated Supabase stack for end-to-end tests, separate from the development stack (npm run dev):
 *   project_id cvsrs-e2e, every port shifted by +1000 (API 55321, DB 55322, test inbox 55324), app on http://localhost:3100.
 * Its database is reset before every run, so synthetic test accounts never reach development data, and development data never
 * changes a test result. Generated under .local/e2e (ignored); supabase/config.toml and supabase/migrations stay the source.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ROOT, SetupError, assertImmediateSignup, assertLoopback, parseStatus, requireDocker, supabaseCli, type StackInfo } from "./local-stack";

export const E2E_WORKDIR = join(ROOT, ".local", "e2e");
export const E2E_APP_PORT = 3100;
export const E2E_PROJECT_ID = "cvsrs-e2e";

/** The development config with its own project id, ports and app origin. Throws if an expected setting moved. */
export function e2eConfig(source: string): string {
  let s = source;
  const swap = (from: RegExp, to: string) => {
    if (!from.test(s)) throw new Error(`supabase/config.toml no longer matches ${from}; update scripts/e2e-stack.ts`);
    s = s.replace(from, to);
  };
  swap(/^project_id = "cvsrs"$/m, `project_id = "${E2E_PROJECT_ID}"`);
  for (const port of [54320, 54321, 54322, 54323, 54324, 54327, 54329]) swap(new RegExp(`= ${port}$`, "m"), `= ${port + 1000}`);
  swap(/^inspector_port = 8083$/m, "inspector_port = 9083");
  s = s.replaceAll("http://localhost:3000", `http://localhost:${E2E_APP_PORT}`);
  // Tests do not need the dashboard.
  swap(/(\[studio\]\n(?:#.*\n)*)enabled = true/, "$1enabled = false");
  return s;
}

function cli(args: string[], inherit = true) {
  return supabaseCli([...args, "--workdir", E2E_WORKDIR], inherit);
}

/** Writes the stack folder, starts it if needed, resets its database to the migrations, and returns its settings. */
export async function prepareE2eStack(): Promise<StackInfo> {
  requireDocker();
  const dir = join(E2E_WORKDIR, "supabase");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.toml"), e2eConfig(readFileSync(join(ROOT, "supabase", "config.toml"), "utf8")));
  rmSync(join(dir, "migrations"), { recursive: true, force: true });
  cpSync(join(ROOT, "supabase", "migrations"), join(dir, "migrations"), { recursive: true });

  let status = cli(["status", "-o", "json"], false);
  if (!status.ok || !parseStatus(status.stdout)) {
    if (!cli(["start"]).ok) throw new SetupError("The end-to-end Supabase stack did not start.");
  }
  status = cli(["status", "-o", "json"], false);
  const stack = parseStatus(status.stdout);
  if (!stack) throw new SetupError("The end-to-end Supabase stack did not report its settings.");
  await assertImmediateSignup(stack);
  // Guard the reset: only the end-to-end stack's own database port.
  assertLoopback(stack.dbUrl);
  if (new URL(stack.dbUrl).port !== "55322") throw new SetupError("Refusing to reset: that is not the end-to-end stack's database.");
  if (!cli(["db", "reset", "--local", "--no-seed"]).ok) throw new SetupError("Resetting the end-to-end database failed.");
  return stack;
}

/** Same provisioning as npm run dev, with throwaway values. */
export async function provisionE2e(stack: StackInfo, certificateSecret: string, workerPassword: string) {
  const db = new pg.Client({ connectionString: stack.dbUrl });
  await db.connect();
  try {
    await db.query("insert into private.certificate_render_secrets (id, secret) values (true, $1) on conflict (id) do update set secret = excluded.secret", [certificateSecret]);
    const exists = (await db.query("select 1 from pg_roles where rolname = 'cvsrs_worker_e2e'")).rowCount;
    await db.query(`${exists ? "alter" : "create"} role cvsrs_worker_e2e login password '${workerPassword}'`);
    await db.query("grant cvsrs_outbox_worker to cvsrs_worker_e2e");
  } finally {
    await db.end();
  }
  const worker = new URL(stack.dbUrl);
  worker.username = "cvsrs_worker_e2e";
  worker.password = workerPassword;
  return { workerDbUrl: worker.toString() };
}
