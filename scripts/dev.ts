/**
 * npm run dev — the real application against a local Supabase stack (Auth, PostgREST, PostgreSQL and a test inbox).
 *
 *   1. checks Node and Docker;
 *   2. starts the local stack when it is not running (`supabase start`; the first start downloads the images);
 *   3. applies only migrations not yet recorded in supabase_migrations.schema_migrations (`supabase migration up`); never resets;
 *   4. provisions two local-only secrets kept in .local/dev-secrets.json: the certificate render secret (same value in the server
 *      environment and the database) and the password of a least-privilege worker login (`cvsrs_worker_dev`, a member of
 *      cvsrs_outbox_worker only; the dev server runs the outbox worker in-process with it);
 *   5. runs `next dev` with the stack's public URL and publishable key. The service-role key is never passed to the web process.
 *
 * Nothing here creates accounts or records. First use: sign up the first two staff in the app, then `npm run setup:first-staff`.
 * To use a hosted development project instead, put its settings in .env.local and run `npm run dev:next`.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { ROOT, PRIVILEGED_KEYS, SetupError, assertImmediateSignup, assertLoopback, localWebEnvironment, requireDocker, stackStatus, supabaseCli } from "./local-stack";

const LOCAL = join(ROOT, ".local");
const SECRETS = join(LOCAL, "dev-secrets.json");
const WEB_PORT = 3000; // supabase/config.toml site_url and redirect URLs name this port.
const WORKER_ROLE = "cvsrs_worker_dev";

interface DevSecrets { certificateSecret: string; workerPassword: string }

function readOrCreateSecrets(): DevSecrets {
  mkdirSync(LOCAL, { recursive: true });
  if (!existsSync(SECRETS)) {
    writeFileSync(SECRETS, JSON.stringify({ certificateSecret: randomBytes(32).toString("hex"), workerPassword: randomBytes(24).toString("hex") }), { flag: "wx", mode: 0o600 });
  }
  const s = JSON.parse(readFileSync(SECRETS, "utf8")) as DevSecrets;
  if (!/^[a-f0-9]{64}$/.test(s.certificateSecret ?? "") || !/^[a-f0-9]{48}$/.test(s.workerPassword ?? "")) {
    throw new SetupError(`${SECRETS} is not in the expected format; move it aside to create new local secrets.`);
  }
  return s;
}

async function provision(dbUrl: string, secrets: DevSecrets) {
  assertLoopback(dbUrl);
  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  try {
    const saved = (await db.query("select secret from private.certificate_render_secrets where id = true")).rows[0]?.secret as string | undefined;
    if (saved && saved !== secrets.certificateSecret) {
      throw new SetupError("The local database holds a different certificate secret than .local/dev-secrets.json. Restore the matching file, or start over with npx supabase db reset (deletes local data).");
    }
    if (!saved) await db.query("insert into private.certificate_render_secrets (id, secret) values (true, $1)", [secrets.certificateSecret]);
    // Role names and passwords cannot be bound as parameters: WORKER_ROLE is a constant and the password is hex from our own generator.
    const exists = (await db.query("select 1 from pg_roles where rolname = $1", [WORKER_ROLE])).rowCount;
    await db.query(`${exists ? "alter" : "create"} role ${WORKER_ROLE} login password '${secrets.workerPassword}'`);
    await db.query(`grant cvsrs_outbox_worker to ${WORKER_ROLE}`);
    await db.query(`
      drop trigger if exists on_auth_user_auto_confirm on auth.users;
      drop function if exists public.auto_confirm_user_trigger();
      update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
    `);
    const staff = Number((await db.query("select count(*) from public.staff_memberships where status = 'active'")).rows[0].count);
    return { hasStaff: staff > 0 };
  } finally {
    await db.end();
  }
}

function refusePrivilegedEnvFiles() {
  for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) {
    const path = join(ROOT, file);
    if (!existsSync(path)) continue;
    const keys = readFileSync(path, "utf8").split(/\r?\n/).map((l) => /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(l)?.[1]).filter(Boolean);
    const found = PRIVILEGED_KEYS.filter((k) => keys.includes(k));
    if (found.length) throw new SetupError(`${file} defines ${found.join(", ")}; the app must never receive it. Remove it from that file (keep it in your secret manager or the shell of the tool that needs it).`);
  }
}

function workerUrl(dbUrl: string, password: string) {
  const u = new URL(dbUrl);
  u.username = WORKER_ROLE;
  u.password = password;
  return u.toString();
}

async function main() {
  if (Number(process.versions.node.split(".")[0]) < 22) throw new SetupError("eVacTrack needs Node.js 22 or newer.");
  requireDocker();

  let stack = stackStatus();
  if (!stack) {
    console.log("Starting the local Supabase stack (the first start downloads several images and can take a few minutes)…");
    if (!supabaseCli(["start"], true).ok) throw new SetupError("The local Supabase stack did not start. See the messages above; run npx supabase stop, then npm run dev again.");
    stack = stackStatus();
    if (!stack) throw new SetupError("The local Supabase stack started but did not report its settings (npx supabase status).");
  }
  await assertImmediateSignup(stack);
  // Applies only versions missing from the migration ledger. Never resets data.
  if (!supabaseCli(["migration", "up", "--local"], true).ok) throw new SetupError("A database migration failed. Nothing was reset; fix the migration and run npm run dev again.");

  const secrets = readOrCreateSecrets();
  const { hasStaff } = await provision(stack.dbUrl, secrets);

  const env: NodeJS.ProcessEnv = {
    ...localWebEnvironment(),
    NODE_ENV: "development",
    NEXT_PUBLIC_SUPABASE_URL: stack.apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: stack.publishableKey,
    CVSRS_CERTIFICATE_RENDER_SECRET: secrets.certificateSecret,
    CVSRS_WORKER_DB_URL: workerUrl(stack.dbUrl, secrets.workerPassword),
    SMS_PROVIDER: "none",
  };
  // Privileged keys never reach the web process: removed from the inherited shell environment here, and refused below when an
  // env file would add them (next dev loads .env*.local / .env.development itself, after this script).
  for (const k of PRIVILEGED_KEYS) delete env[k];
  refusePrivilegedEnvFiles();

  console.log("");
  console.log(`  App            http://localhost:${WEB_PORT}`);
  console.log(`  Staff sign-in  http://localhost:${WEB_PORT}/evactrackstafflogin`);
  if (stack.inboxUrl) console.log(`  Test inbox     ${stack.inboxUrl}   (password-reset emails land here; signup needs no email link)`);
  if (stack.studioUrl) console.log(`  Studio         ${stack.studioUrl}`);
  if (!hasStaff) {
    console.log("");
    console.log("  First use: there are no staff yet. The first technical administrator and clinical lead each create an account at");
    console.log(`  http://localhost:${WEB_PORT}/sign-up (access is immediate), then run:`);
    console.log('    npm run setup:first-staff -- --org "<organization>" --clinic "<clinic>" --timezone Asia/Manila --admin <email> --lead <email>');
  }
  console.log("");

  const web = spawn(process.execPath, [join(ROOT, "node_modules", "next", "dist", "bin", "next"), "dev", "--hostname", "localhost", "--port", String(WEB_PORT)], { cwd: ROOT, env, stdio: "inherit", windowsHide: true });
  const stop = () => { if (web.exitCode === null) web.kill(); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const code = await new Promise<number>((res) => web.once("exit", (c) => res(c ?? 0)));
  console.log("The local Supabase stack keeps running for a fast restart. Stop it with npm run dev:stop (data is kept).");
  process.exit(code);
}

main().catch((e: unknown) => {
  // Connection strings are masked if a message ever contains one; pg messages themselves carry no password.
  const err = e as { code?: string; message?: string };
  console.error(e instanceof SetupError ? e.message : `npm run dev failed${err.code ? ` (${err.code})` : ""}: ${(err.message ?? "unexpected error").replace(/postgres(?:ql)?:\/\/\S+/g, "<connection string>")}`);
  process.exit(1);
});
