import { createHmac, timingSafeEqual } from "node:crypto";
import type pg from "pg";
import { z } from "zod";

/** Provider callbacks are accepted only with a valid HMAC-SHA256 signature of the raw body (hex) using the shared secret. */
export function verifySignature(secret: string, rawBody: string, header: string | null | undefined): boolean {
  if (!secret || !header) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const hex = header.trim().replace(/^sha256=/i, "");
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;
  const got = Buffer.from(hex, "hex");
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const eventSchema = z.object({
  eventId: z.string().min(1).max(200),
  providerMessageId: z.string().min(1).max(200),
  status: z.enum(["sent", "delivered", "failed", "undeliverable", "opted_out"]),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export type SmsEvent = z.infer<typeof eventSchema>;

export type WebhookOutcome = { status: 200; applied: boolean } | { status: 400 | 401 | 503; error: string };

export function validateSmsWebhook(opts: { secret: string | undefined; rawBody: string; signature: string | null }): { event: SmsEvent } | { status: 400 | 401 | 503; error: string } {
  if (!opts.secret) return { status: 503, error: "not configured" };
  if (!verifySignature(opts.secret, opts.rawBody, opts.signature)) return { status: 401, error: "bad signature" };
  try {
    return { event: eventSchema.parse(JSON.parse(opts.rawBody)) };
  } catch {
    return { status: 400, error: "invalid event" };
  }
}

/** Verifies, validates and records one callback. Duplicates and late events are acknowledged (200) so the provider stops retrying. */
export async function handleSmsWebhook(client: pg.ClientBase, opts: { provider: string; secret: string | undefined; rawBody: string; signature: string | null }): Promise<WebhookOutcome> {
  const checked = validateSmsWebhook(opts);
  if ("error" in checked) return checked;
  const parsed = checked.event;
  const r = await client.query("select private.record_sms_event($1,$2,$3,$4,$5) as applied", [opts.provider, parsed.eventId, parsed.providerMessageId, parsed.status, parsed.occurredAt ?? null]);
  return { status: 200, applied: r.rows[0].applied as boolean };
}
