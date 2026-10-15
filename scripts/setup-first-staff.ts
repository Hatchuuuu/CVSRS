/**
 * npm run setup:first-staff — one-time creation of the first organization, clinic and two staff (technical administrator and
 * clinical lead), each approved by the other. Wraps private.bootstrap_initial_staff (migration 0034), which only the database
 * owner can run and which refuses once any staff access exists; later staff use the in-app two-person process.
 *
 *   npm run setup:first-staff -- --org "Municipal Health Office" --clinic "Main Health Center" --timezone Asia/Manila \
 *     --admin tech.admin@example.org --lead clinical.lead@example.org
 *
 * Target: the local Supabase stack (npm run dev). For a hosted project, set CVSRS_OWNER_DB_URL to its direct connection string
 * in the shell (never in a file the app reads; read it with a hidden prompt so it stays out of shell history), with an
 * sslmode of require/verify-ca/verify-full, and add --hosted. Both people must already have signed up with immediate access enabled.
 * Decide who they are outside the system first, and record that decision: the function records what was done, not who approved it.
 */
import { parseArgs } from "node:util";
import pg from "pg";
import { SetupError, assertLoopback, requireDocker, stackStatus } from "./local-stack";

const { values } = parseArgs({
  options: {
    org: { type: "string" }, clinic: { type: "string" }, timezone: { type: "string", default: "Asia/Manila" },
    admin: { type: "string" }, lead: { type: "string" }, hosted: { type: "boolean", default: false },
  },
});

async function main() {
  const { org, clinic, timezone, admin, lead, hosted } = values;
  if (!org?.trim() || !clinic?.trim() || !admin?.trim() || !lead?.trim()) {
    throw new SetupError('Usage: npm run setup:first-staff -- --org "<organization>" --clinic "<clinic>" --timezone Asia/Manila --admin <email> --lead <email>');
  }
  if (timezone !== "UTC" && !Intl.supportedValuesOf("timeZone").includes(timezone!)) throw new SetupError(`"${timezone}" is not an IANA time zone (for example Asia/Manila).`);

  let dbUrl: string;
  if (hosted) {
    dbUrl = process.env.CVSRS_OWNER_DB_URL ?? "";
    if (!dbUrl) throw new SetupError("--hosted needs CVSRS_OWNER_DB_URL (the project's direct connection string) in this shell.");
    // The owner session must be encrypted: require an explicit TLS mode (verify-full with the project's CA certificate is best).
    // A loopback address (a local stack) never leaves the machine and is exempt.
    const target = new URL(dbUrl);
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname);
    const mode = target.searchParams.get("sslmode") ?? (loopback ? "loopback" : null);
    if (!mode || !["require", "verify-ca", "verify-full", "loopback"].includes(mode)) {
      throw new SetupError("--hosted needs an encrypted connection: add ?sslmode=verify-full&sslrootcert=<path to the project's CA certificate> (or at least sslmode=require) to CVSRS_OWNER_DB_URL.");
    }
    console.log(`Target: ${target.host} (${loopback ? "loopback" : `TLS ${mode}`}).`);
  } else {
    requireDocker();
    const stack = stackStatus();
    if (!stack) throw new SetupError("The local Supabase stack is not running. Start it with npm run dev first.");
    dbUrl = stack.dbUrl;
    assertLoopback(dbUrl);
  }

  const db = new pg.Client({ connectionString: dbUrl });
  await db.connect();
  try {
    // New accounts are confirmed by Auth automatically; an unconfirmed account signals a setup/policy mismatch.
    const unconfirmed = await db.query(
      `select lower(email) as email from auth.users where lower(email) = any($1::text[]) and email_confirmed_at is null`,
      [[admin!.trim().toLowerCase(), lead!.trim().toLowerCase()]],
    );
    if (unconfirmed.rowCount) throw new SetupError("These accounts predate the immediate-access policy. Run npm run dev to enable existing local accounts; for hosted accounts, the operator must enable automatic confirmation and update their account status.");
    const r = await db.query("select private.bootstrap_initial_staff($1, $2, $3, $4, $5) as result", [org!.trim(), clinic!.trim(), timezone, admin!.trim(), lead!.trim()]);
    const out = r.rows[0].result as Record<string, string>;
    console.log(`Created "${org!.trim()}" with its first clinic "${clinic!.trim()}" (${timezone}).`);
    console.log(`  ${admin!.trim()} → technical administrator`);
    console.log(`  ${lead!.trim()} → clinical lead`);
    console.log(`  clinic id ${out.clinicId}`);
    console.log("Next: each of them signs in on the staff sign-in page and turns on two-step sign-in (Account → Security). Staff work needs it.");
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "CV409" || err.code === "CV422") throw new SetupError(`Refused: ${err.message}.`);
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((e: unknown) => {
  // pg errors carry a SQLSTATE code and a message without credentials; connection strings are never printed.
  const err = e as { code?: string; message?: string };
  console.error(e instanceof SetupError ? e.message : `setup:first-staff failed${err.code ? ` (${err.code})` : ""}: ${(err.message ?? "unexpected error").replace(/postgres(?:ql)?:\/\/\S+/g, "<connection string>")}`);
  process.exit(1);
});
