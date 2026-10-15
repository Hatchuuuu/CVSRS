import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { admin, expectCode, pool } from "./helpers";

const worker = "cvsrs_outbox_worker";
const webhook = "cvsrs_sms_webhook";

async function asRole<T>(role: string, sql: string, params: unknown[] = []): Promise<T[]> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const rows = (await client.query(sql, params)).rows as T[];
    await client.query("rollback");
    return rows;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

afterAll(async () => pool.end());

describe("restricted production runtime privilege groups", () => {
  it("grants only the exact worker and webhook entry points", async () => {
    const rows = await admin<{ role: string; signature: string }>(`
      select r.rolname role, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' signature
      from pg_roles r cross join pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where r.rolname in ($1, $2) and n.nspname in ('public', 'private')
        and has_function_privilege(r.rolname, p.oid, 'EXECUTE') order by 1, 2`, [worker, webhook]);
    expect(rows.filter((r) => r.role === worker).map((r) => r.signature)).toEqual([
      "private.claim_sms(p_limit integer)",
      "private.mark_sms(p_id uuid, p_expected_attempt integer, p_outcome text, p_provider text, p_provider_message_id text, p_error text)",
      "private.process_outbox(p_limit integer)",
      "private.run_daily_maintenance()",
    ]);
    expect(rows.filter((r) => r.role === webhook).map((r) => r.signature)).toEqual([
      "private.record_sms_event(p_provider text, p_event_id text, p_provider_message_id text, p_status text, p_at timestamp with time zone)",
    ]);
    const grants = await admin<{ role: string; tables: string }>(`
      select r.rolname role, count(*) filter (where has_table_privilege(r.rolname, c.oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER'))::text tables
      from pg_roles r cross join pg_class c join pg_namespace n on n.oid = c.relnamespace
      where r.rolname in ($1, $2) and n.nspname in ('public', 'private') and c.relkind in ('r', 'p', 'v', 'm')
      group by r.rolname order by 1`, [worker, webhook]);
    expect(grants).toEqual([{ role: worker, tables: "0" }, { role: webhook, tables: "0" }]);
  });

  it("permits its own safe calls and denies cross-role calls and table reads", async () => {
    expect((await asRole<{ applied: boolean }>(worker, "select private.mark_sms($1,1,'sent') applied", [randomUUID()]))[0]!.applied).toBe(false);
    expect((await asRole<{ applied: boolean }>(webhook,
      "select private.record_sms_event('test',$1,'missing-provider-id','delivered',now()) applied", [randomUUID()],
    ))[0]!.applied).toBe(false);
    await expectCode(asRole(worker, "select private.record_sms_event('test',$1,'missing','sent',now())", [randomUUID()]), "42501");
    await expectCode(asRole(webhook, "select private.process_outbox(1)"), "42501");
    await expectCode(asRole(webhook, "select private.claim_sms(1)"), "42501");
    await expectCode(asRole(worker, "select * from public.sms_messages limit 1"), "42501");
    await expectCode(asRole(webhook, "select * from public.sms_events limit 1"), "42501");
  });
});
