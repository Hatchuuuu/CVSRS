import type pg from "pg";
import type { SmsProvider } from "./provider";

export interface DispatchResult {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
}

/**
 * Claims queued messages (SKIP LOCKED, opted-in and checked numbers only), sends each through the provider and reports the
 * outcome to the database. The provider call happens OUTSIDE any database transaction: a slow provider never holds locks.
 */
export async function dispatchSms(client: pg.ClientBase, provider: SmsProvider, limit = 20): Promise<DispatchResult> {
  const claimed = (await client.query("select id, phone, body, attempt from private.claim_sms($1)", [limit])).rows as { id: string; phone: string; body: string; attempt: number }[];
  const out: DispatchResult = { claimed: claimed.length, sent: 0, retry: 0, failed: 0 };
  for (const m of claimed) {
    let outcome: "sent" | "retry" | "failed";
    let providerMessageId: string | null = null;
    let code: string | null = null;
    try {
      const r = await provider.send({ id: m.id, to: m.phone, body: m.body });
      if (r.ok) {
        outcome = "sent";
        providerMessageId = r.providerMessageId;
      } else {
        outcome = r.retryable ? "retry" : "failed";
        code = r.code;
      }
    } catch {
      // The provider call threw: it may or may not have been sent. Retrying is safe because the id is the idempotency key.
      outcome = "retry";
      code = "provider_error";
    }
    const completion = await client.query<{ applied: boolean }>(
      "select private.mark_sms($1,$2,$3,$4,$5,$6) as applied",
      [m.id, m.attempt, outcome, provider.name, providerMessageId, code],
    );
    if (completion.rows[0]?.applied) {
      const persistedOutcome = outcome === "retry" && m.attempt >= 5 ? "failed" : outcome;
      out[persistedOutcome]++;
    }
  }
  return out;
}
