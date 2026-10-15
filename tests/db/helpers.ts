import { randomUUID } from "node:crypto";
import pg from "pg";
import { disposableTestName } from "../../scripts/db";

const PORT = Number(process.env.CVSRS_DB_PORT ?? 54329);
const TEST_DB_NAME = disposableTestName(process.env.CVSRS_TEST_DB_NAME);
export const TEST_URL = `postgresql://postgres@127.0.0.1:${PORT}/${TEST_DB_NAME}`;

export const pool = new pg.Pool({ connectionString: TEST_URL, max: 8 });

export type Q = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;
export interface Actor {
  id: string;
  aal?: "aal1" | "aal2";
}

/** Superuser access, for fixtures and for verifying storage-level facts. */
export const admin: Q = async (sql, params) => (await pool.query(sql, params as unknown[])).rows as never;

/**
 * Runs `fn` in ONE transaction as a real API role with JWT claims, exactly as PostgREST does.
 * Commits on success, rolls back and rethrows on error. `null` actor = anonymous.
 */
export async function as<T>(actor: Actor | null, fn: (q: Q) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (actor) {
      await client.query("set local role authenticated");
      const claims = { sub: actor.id, role: "authenticated", aal: actor.aal ?? "aal2" };
      await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    } else {
      await client.query("set local role anon");
    }
    const out = await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows as never);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Expects a rejection whose SQLSTATE matches; returns nothing. */
export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const got = (e as { code?: string }).code;
    if (got !== code) throw new Error(`expected SQLSTATE ${code}, got ${got}: ${(e as Error).message}`);
    return;
  }
  throw new Error(`expected SQLSTATE ${code}, but the call succeeded`);
}

export async function newUser(label: string): Promise<Actor> {
  const id = randomUUID();
  await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)", [
    id,
    `${label}-${id.slice(0, 8)}@example.test`,
    JSON.stringify({ display_name: label }),
  ]);
  return { id, aal: "aal2" };
}

export async function makeOrg(label = "Org") {
  const [o] = await admin<{ id: string }>("insert into public.organizations (name) values ($1) returning id", [label]);
  return o.id;
}

export async function makeClinic(orgId: string, name: string) {
  const [c] = await admin<{ id: string }>("insert into public.clinics (organization_id, name) values ($1,$2) returning id", [orgId, name]);
  return c.id;
}

let seedApprover: string | undefined;
/** Fixture-only: inserts an active membership as the superuser (bypasses the two-person workflow on purpose). */
export async function grant(orgId: string, clinicId: string, user: Actor, role: string, caps: string[] = []) {
  seedApprover ??= (await newUser("seed-approver")).id;
  const [m] = await admin<{ id: string }>(
    `insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, capabilities, status, approved_by, requested_by)
     values ($1,$2,$3,$4,$5,'active',$6,$6) returning id`,
    [orgId, user.id, clinicId, role, caps, seedApprover],
  );
  return m.id;
}

export const op = () => randomUUID();
