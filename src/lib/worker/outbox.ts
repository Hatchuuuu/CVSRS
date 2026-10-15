import pg from "pg";
import { getSmsProvider } from "../sms";
import { dispatchSms } from "../sms/dispatch";

/**
 * Bounded outbox worker. It calls `private.process_outbox`, which creates in-app messages (and queues SMS for opted-in guardians),
 * then sends queued SMS through the configured provider (SMS_PROVIDER; none by default). Several workers may run at once: rows are
 * claimed with SKIP LOCKED.
 *
 * Connection: CVSRS_WORKER_DB_URL only, a login that is a member of cvsrs_outbox_worker (never the browser-facing key, never a
 * superuser). `npm run dev` provisions such a login for the local stack.
 */
export function workerDbUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  return env.CVSRS_WORKER_DB_URL || null;
}

export interface WorkerResult {
  done: number;
  cancelled: number;
  retry: number;
  failed: number;
  sms?: { claimed: number; sent: number; retry: number; failed: number };
  /** Day closure and reminders (0037). `skipped` when they already ran in the last ten minutes. */
  maintenance?: Record<string, unknown>;
}

export async function runOutboxOnce(url: string, limit = 20): Promise<WorkerResult> {
  const client = new pg.Client({
    connectionString: url, connectionTimeoutMillis: 5000,
    statement_timeout: 30_000, query_timeout: 35_000,
  });
  // A connection lost while no query runs (e.g. during SMS dispatch) is emitted as 'error'; unhandled, it would end the process.
  // The next query or end() then fails this pass, and the loop retries.
  client.on("error", () => undefined);
  try {
    await client.connect();
    // First, so reminders queued here are delivered in this same pass. A failure is reported, never allowed to stop delivery.
    let maintenance: Record<string, unknown>;
    try {
      maintenance = (await client.query("select private.run_daily_maintenance() as m")).rows[0].m as Record<string, unknown>;
    } catch (e) {
      // pg's read timeout does not cancel an active statement. Abort this pass so end() disconnects it before a retry.
      if (e instanceof Error && e.message === "Query read timeout") throw e;
      maintenance = { failed: (e as { code?: string }).code ?? "error" };
    }
    const res = await client.query("select private.process_outbox($1) as r", [limit]);
    const out = res.rows[0].r as WorkerResult;
    out.maintenance = maintenance;
    const provider = getSmsProvider();
    if (provider) out.sms = await dispatchSms(client, provider, limit);
    return out;
  } finally {
    await client.end().catch(() => undefined);
  }
}

const g = globalThis as { __cvsrsWorker?: NodeJS.Timeout };
const reportedMaintenanceFailures = new Set<string>();

/** Starts one in-process poller per server process (idempotent across hot reloads). */
export function startOutboxWorker(intervalMs = 10_000): void {
  // Production web processes never poll or hold the worker credential.
  if (process.env.NODE_ENV === "production") return;
  const url = workerDbUrl();
  if (!url || g.__cvsrsWorker) return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const r = await runOutboxOnce(url);
      if (r.done + r.retry + r.failed > 0) console.log(`[worker] outbox: ${r.done} delivered, ${r.retry} to retry, ${r.failed} failed`);
      // Logged once per error code: a database without migration 0037 (undefined function, 42883) would otherwise repeat every tick.
      if (r.maintenance && "failed" in r.maintenance) {
        const code = String(r.maintenance.failed);
        if (!reportedMaintenanceFailures.has(code)) {
          reportedMaintenanceFailures.add(code);
          console.error(`[worker] daily maintenance failed (${code})${code === "42883" ? ": apply migration 0037 to this database" : ""}`);
        }
      }
      else if (r.maintenance && Number(r.maintenance.daysClosed) > 0) console.log(`[worker] closed ${String(r.maintenance.daysClosed)} past service day(s)`);
      if (r.sms && r.sms.claimed > 0) console.log(`[worker] sms: ${r.sms.sent} sent, ${r.sms.retry} to retry, ${r.sms.failed} failed`);
    } catch (e) {
      console.error(`[worker] outbox run failed: ${(e as { code?: string }).code ?? (e as Error).name}`);
    } finally {
      running = false;
    }
  };
  g.__cvsrsWorker = setInterval(tick, intervalMs);
  g.__cvsrsWorker.unref?.();
  void tick();
}
