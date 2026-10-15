import { randomUUID } from "node:crypto";
import { AppError, errorResponse, fromDbError, safeMessage } from "@/lib/api/errors";
import { getRpcClient } from "@/lib/db";
import { clientAddress, limitRequest } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/** Streams the stored document (the very same bytes on every download). Not JSON, so it does not use the api() wrapper. */
export async function GET(req: Request, ctx: { params: Promise<{ certificateId: string }> }) {
  const requestId = randomUUID();
  const fail = (code: "not_found" | "rate_limited" | "unauthenticated", status: number, retryAfter?: number) => errorResponse(new AppError(code, status, safeMessage(code), undefined, code === "rate_limited"), requestId, retryAfter);
  try {
    const { certificateId } = await ctx.params;
    if (!/^[0-9a-f-]{36}$/.test(certificateId)) return fail("not_found", 404);
    // Same two tiers as api(): a generous pre-authentication limit per trusted client address (never one shared bucket),
    // then a per-user limit once the session is known.
    const client = clientAddress(req);
    if (!client.shared) {
      const pre = await limitRequest(`pre|${client.key}|certificate-download`, 600, 60_000);
      if (!pre.ok) return fail("rate_limited", 429, pre.retryAfterSec);
    }
    const rpc = await getRpcClient(requestId);
    const session = await rpc.session();
    if (!session) return fail("unauthenticated", 401);
    const rate = await limitRequest(`user|${session.userId}|certificate-download`, 60, 60_000);
    if (!rate.ok) return fail("rate_limited", 429, rate.retryAfterSec);
    const doc = await rpc.rpc<{ certificateNo: string; pdfBase64: string; sha256: string }>("get_certificate_pdf", { p_certificate_id: certificateId });
    if (!doc) return fail("not_found", 404);
    return new Response(Buffer.from(doc.pdfBase64, "base64"), {
      headers: {
        "content-type": "application/pdf",
        // ?inline=1 lets the person read it in the browser first (BP P10 "readable preview"); the default is a download.
        "content-disposition": `${new URL(req.url).searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${doc.certificateNo}.pdf"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        etag: `"${doc.sha256}"`,
        "x-request-id": requestId,
      },
    });
  } catch (e) {
    const err = e instanceof AppError ? e : (e as { code?: string }).code ? fromDbError(e as { code?: string; message?: string }) : null;
    if (err) return errorResponse(err, requestId);
    console.error(`[${requestId}] certificate download failed`);
    return errorResponse(new AppError("internal", 500, safeMessage("internal")), requestId);
  }
}
