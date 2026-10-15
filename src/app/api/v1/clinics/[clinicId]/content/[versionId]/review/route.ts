import { api } from "@/lib/api/handler";
import { contentReviewBody } from "@/lib/validation/config";

export const POST = api({ body: contentReviewBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("review_content", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId, p_decision: body.decision, p_note: body.note ?? null }),
);
