import { z } from "zod";
import { AppError, safeMessage } from "./errors";

export function positiveQueryInt(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^[1-9]\d*$/.test(value)) throw new AppError("invalid_request", 400, safeMessage("invalid_request"));
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n > max) throw new AppError("invalid_request", 400, safeMessage("invalid_request"));
  return n;
}

// ISO 8601 with a zone, narrowed to what PostgreSQL timestamptz accepts: no year 0000 (22008) and offsets within ±15:59 (22009).
const instant = z.iso
  .datetime({ offset: true, local: false })
  .refine((v) => !v.startsWith("0000-") && /(?:Z|[+-](?:0\d|1[0-5]):[0-5]\d)$/.test(v));

/** For values that arrive outside a schema (the audit page's own "Older entries" cursor). */
export function isAuditInstant(value: unknown): value is string {
  return typeof value === "string" && instant.safeParse(value).success;
}

/**
 * Arguments for `search_audit` from the audit API's query string. Instants must be ISO 8601 with a zone (a malformed or impossible
 * value used to reach PostgreSQL and come back as 500); `before` and `beforeId` together form the keyset cursor the function returns
 * as `nextBefore`/`nextBeforeId`, so entries sharing one timestamp are neither skipped nor repeated across pages.
 */
export function auditSearchArgs(query: URLSearchParams) {
  const parsed = z
    .object({
      action: z.string().trim().max(60).optional(),
      actor: z.uuid().optional(),
      from: instant.optional(),
      to: instant.optional(),
      before: instant.optional(),
      beforeId: z.uuid().optional(),
    })
    .refine((v) => !v.beforeId || v.before, { message: "beforeId needs before" })
    .safeParse(Object.fromEntries(["action", "actor", "from", "to", "before", "beforeId"].flatMap((k) => (query.get(k) ? [[k, query.get(k)]] : []))));
  if (!parsed.success) throw new AppError("unprocessable", 422, "Use ISO 8601 times with a zone (for example 2026-10-06T08:00:00+08:00) and record ids as given.");
  const v = parsed.data;
  return {
    p_action: v.action || null,
    p_actor: v.actor ?? null,
    p_from: v.from ?? null,
    p_to: v.to ?? null,
    p_before: v.before ?? null,
    p_before_id: v.beforeId ?? null,
    p_limit: positiveQueryInt(query.get("limit"), 50, 100),
  };
}
