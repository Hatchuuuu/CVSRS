import "server-only";
import { createHash, createHmac } from "node:crypto";
import { AppError } from "@/lib/api/errors";
import type { RpcClient } from "@/lib/db";
import { canonicalPublicUrl } from "@/lib/env";
import { renderCertificatePdf, type CertificateSnapshot } from "./pdf";

/** Public base URL printed inside the QR code. Production must use a configured canonical HTTPS origin. */
export function publicBase(req: Request): string {
  const configured = process.env.CVSRS_PUBLIC_URL;
  if (!configured) {
    if (process.env.NODE_ENV === "production") throw new AppError("misconfigured", 503, "The service is not configured.");
    return new URL(req.url).origin;
  }
  try {
    return canonicalPublicUrl(configured);
  } catch {
    throw new AppError("misconfigured", 503, "The service is not configured.");
  }
}

/** A second, deterministic idempotency key derived from the caller's, so a retry of the whole request replays the same step. */
export function deriveKey(key: string, label: string): string {
  const h = createHash("sha256").update(`${key}:${label}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface IssueResult {
  certificateId: string;
  certificateNo: string;
  status: "issued" | "pending";
  /** True when the record is saved but the document still has to be generated (retry is safe). */
  needsRetry?: boolean;
}

/** Only the trusted server render path can authenticate the bytes submitted to the storage RPC. */
export function attestCertificatePdf(certificateId: string, contentHash: string, tokenHash: string, pdfHash: string): string {
  const secret = process.env.CVSRS_CERTIFICATE_RENDER_SECRET;
  if (!secret || secret.length < 32) throw new AppError("misconfigured", 503, "The service is not configured.");
  return createHmac("sha256", secret).update(`${certificateId}:${contentHash}:${tokenHash}:${pdfHash}`).digest("hex");
}

/** pending -> rendered -> stored. Used for a new certificate and for "retry" of one whose document failed. */
export async function renderAndStore(rpc: RpcClient, req: Request, certificateId: string, opKey: string): Promise<IssueResult> {
  let begun: { certificateNo: string; token: string; tokenHash: string; contentHash: string; snapshot: CertificateSnapshot & { clinic: { timezone?: string } } } | null;
  try {
    begun = await rpc.rpc("begin_certificate_render", { p_certificate_id: certificateId });
  } catch (e) {
    // The same request repeated after it fully succeeded: report the certificate as issued rather than failing.
    if (e instanceof AppError && e.code === "conflict") {
      const stored = await rpc.rpc<{ certificateNo: string }>("get_certificate_pdf", { p_certificate_id: certificateId });
      if (stored) return { certificateId, certificateNo: stored.certificateNo, status: "issued" };
    }
    throw e;
  }
  if (!begun) throw new AppError("not_found", 404, "This record is unavailable to your account.");
  const issuedText = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: begun.snapshot.clinic.timezone || "Asia/Manila" }).format(new Date());
  const pdf = await renderCertificatePdf(begun.snapshot, `${publicBase(req)}/verify/${begun.token}`, issuedText);
  const pdfHash = createHash("sha256").update(pdf).digest("hex");
  await rpc.rpc("store_certificate_pdf", {
    p_operation_key: deriveKey(opKey, "store"),
    p_certificate_id: certificateId,
    p_content_hash: begun.contentHash,
    p_token_hash: begun.tokenHash,
    p_pdf_base64: pdf.toString("base64"),
    p_sha256: pdfHash,
    p_attestation: attestCertificatePdf(certificateId, begun.contentHash, begun.tokenHash, pdfHash),
  });
  return { certificateId, certificateNo: begun.certificateNo, status: "issued" };
}
