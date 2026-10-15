import { z } from "zod";
import { AppError } from "./errors";
import { isAuditInstant } from "./query";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = () => new AppError("unprocessable", 422, "Use the paging link as given, or return to the first page.");

export function timestampCursor(query: URLSearchParams, key = "before"): { at: string; id: string } | null {
  const times = query.getAll(key), ids = query.getAll(`${key}Id`);
  if (times.length === 0 && ids.length === 0) return null;
  const at = times[0], id = ids[0];
  if (times.length !== 1 || ids.length !== 1 || !isAuditInstant(at) || typeof id !== "string" || !uuid.test(id)) throw invalid();
  return { at, id };
}

const count = z.number().int().nonnegative().max(2147483647);
const followupSchema = z.object({ behind: count, due: count, name: z.string().min(1).max(200), id: z.string().regex(uuid) });
export function followupCursor(query: URLSearchParams): z.infer<typeof followupSchema> | null {
  const values = query.getAll("after");
  if (values.length === 0) return null;
  const raw = values[0];
  if (values.length !== 1 || typeof raw !== "string" || raw.length > 600) throw invalid();
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw invalid(); }
  const result = followupSchema.safeParse(value);
  if (!result.success) throw invalid();
  return result.data;
}

/** Preserve repeated page parameters so cursor validation cannot silently select one of two values. */
export function pageQuery(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  return query;
}

export function pageCursor<T>(read: () => T): T | null {
  try { return read(); } catch { return null; }
}
