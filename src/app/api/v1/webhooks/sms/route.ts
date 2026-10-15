import { randomUUID } from "node:crypto";
import pg from "pg";
import { AppError, errorResponse, safeMessage } from "@/lib/api/errors";
import { readBoundedText } from "@/lib/api/body";
import { clientAddress, limitRequest } from "@/lib/security/rate-limit";
import { validateSmsWebhook } from "@/lib/sms/webhook";

export const dynamic = "force-dynamic";

// Public endpoint for provider delivery receipts. Authenticated by signature only; never uses a user session.
export async function POST(req: Request) {
  const requestId = randomUUID();
  const json = (status: number, body: Record<string, unknown>) => Response.json({ ...body, requestId }, { status, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  const fail = (status: number, code: "invalid_request" | "unauthenticated" | "rate_limited" | "misconfigured" | "unavailable" | "internal", retryAfter?: number) => errorResponse(new AppError(code, status, safeMessage(code), undefined, code === "rate_limited"), requestId, retryAfter);
  let raw: string;
  try {
    raw = await readBoundedText(req, 10_000);
  } catch (error) {
    return fail(error instanceof AppError ? error.status : 400, "invalid_request");
  }
  // The signature is checked before any shared allowance is charged: unsigned or forged requests are counted in a separate
  // per-client bucket, so a flood of them can never use up the allowance of the provider's genuine (signed) callbacks.
  const checked = validateSmsWebhook({ secret: process.env.SMS_WEBHOOK_SECRET, rawBody: raw, signature: req.headers.get("x-signature") });
  if ("error" in checked && checked.status === 503) return fail(503, "misconfigured");
  const signed = !("error" in checked && checked.status === 401);
  let limit: { ok: boolean; retryAfterSec: number };
  try {
    limit = signed
      ? await limitRequest("sms-webhook|signed", 300, 60_000, { onStoreFailure: "closed" })
      : await limitRequest(`sms-webhook|unverified|${clientAddress(req).key}`, 60, 60_000, { onStoreFailure: "closed" });
  } catch (error) {
    return fail(503, error instanceof AppError && error.code === "misconfigured" ? "misconfigured" : "unavailable");
  }
  if (!limit.ok) return fail(429, "rate_limited", limit.retryAfterSec);
  if ("error" in checked) return fail(checked.status, checked.status === 401 ? "unauthenticated" : "invalid_request");
  const url = process.env.CVSRS_SMS_WEBHOOK_DB_URL;
  if (!url) return fail(503, "misconfigured");
  const client = new pg.Client({
    connectionString: url, connectionTimeoutMillis: 5000,
    statement_timeout: 5000, query_timeout: 7500,
  });
  try {
    await client.connect();
    const event = checked.event;
    const r = await client.query("select private.record_sms_event($1,$2,$3,$4,$5) as applied", [(process.env.SMS_PROVIDER ?? "none").toLowerCase(), event.eventId, event.providerMessageId, event.status, event.occurredAt ?? null]);
    return json(200, { applied: r.rows[0].applied as boolean });
  } catch {
    console.error(`[${requestId}] sms webhook failed`);
    return fail(500, "internal");
  } finally {
    await client.end().catch(() => undefined);
  }
}
