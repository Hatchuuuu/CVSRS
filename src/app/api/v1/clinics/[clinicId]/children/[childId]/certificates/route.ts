import { api } from "@/lib/api/handler";
import { deriveKey, renderAndStore, type IssueResult } from "@/lib/certificates/service";
import { issueCertificateBody } from "@/lib/validation/certificates";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_child_certificates", { p_clinic_id: params.clinicId, p_child_id: params.childId }));

// Prepares the frozen snapshot, then renders and stores the private document. If rendering fails the certificate stays
// "pending" ("record saved; document needs retry") and the retry route completes it: nothing is issued without a document.
export const POST = api({ body: issueCertificateBody, rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, req, params, body, opKey }): Promise<IssueResult | null> => {
  const prepared = await rpc.rpc<{ certificateId: string; certificateNo: string }>("issue_certificate", {
    p_operation_key: deriveKey(opKey, "issue"),
    p_clinic_id: params.clinicId,
    p_child_id: params.childId,
    p_replaces_id: body.replacesId ?? null,
  });
  if (!prepared) return null;
  try {
    return await renderAndStore(rpc, req, prepared.certificateId, opKey);
  } catch (e) {
    console.error(`certificate ${prepared.certificateId} document generation failed: ${(e as Error)?.name}`);
    return { certificateId: prepared.certificateId, certificateNo: prepared.certificateNo, status: "pending", needsRetry: true };
  }
});
