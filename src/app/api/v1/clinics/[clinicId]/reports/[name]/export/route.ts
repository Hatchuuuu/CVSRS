import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError, errorResponse, fromDbError, safeMessage } from "@/lib/api/errors";
import { getRpcClient } from "@/lib/db";
import { findReport } from "@/lib/reports/catalog";
import { toCsv } from "@/lib/reports/csv";
import { clientAddress, limitRequest } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";
const date = z.iso.date();

/** CSV download. The report RPC audits the export in the same database transaction as the read. */
export async function GET(req: Request, ctx: { params: Promise<{ clinicId: string; name: string }> }) {
  const requestId = randomUUID();
  const fail = (code: "not_found" | "unprocessable" | "rate_limited" | "unauthenticated", status: number, message = safeMessage(code), retryAfter?: number) => errorResponse(new AppError(code, status, message, undefined, code === "rate_limited"), requestId, retryAfter);
  try {
    const { clinicId, name } = await ctx.params;
    const def = findReport(name);
    if (!def || !/^[0-9a-f-]{36}$/.test(clinicId)) return fail("not_found", 404);
    const sp = new URL(req.url).searchParams;
    const from = date.safeParse(sp.get("from"));
    const to = date.safeParse(sp.get("to"));
    if (!from.success || !to.success) return fail("unprocessable", 422, "Choose a start and end date.");
    // Same two tiers as api(): pre-authentication per trusted client address (never one shared bucket), then per user.
    const client = clientAddress(req);
    if (!client.shared) {
      const pre = await limitRequest(`pre|${client.key}|report-export`, 200, 60_000);
      if (!pre.ok) return fail("rate_limited", 429, safeMessage("rate_limited"), pre.retryAfterSec);
    }
    const rpc = await getRpcClient(requestId);
    const session = await rpc.session();
    if (!session) return fail("unauthenticated", 401);
    const rate = await limitRequest(`user|${session.userId}|report-export`, 20, 60_000);
    if (!rate.ok) return fail("rate_limited", 429, safeMessage("rate_limited"), rate.retryAfterSec);
    const data = await rpc.rpc<{ rows: Record<string, unknown>[] }>(def.rpc, { p_clinic_id: clinicId, p_from: from.data, p_to: to.data, p_export: true });
    if (!data) return fail("not_found", 404);
    return new Response(toCsv(data.rows, def.columns, { withheldText: "withheld" }), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${def.slug}_${from.data}_${to.data}.csv"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "x-request-id": requestId,
      },
    });
  } catch (e) {
    const err = e instanceof AppError ? e : (e as { code?: string }).code ? fromDbError(e as { code?: string; message?: string }) : null;
    if (err) return errorResponse(err, requestId);
    console.error(`[${requestId}] report export failed`);
    return errorResponse(new AppError("internal", 500, safeMessage("internal")), requestId);
  }
}
