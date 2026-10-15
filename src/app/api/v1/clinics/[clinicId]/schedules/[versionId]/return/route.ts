import { api } from "@/lib/api/handler";
import { reasonBody } from "@/lib/validation/clinical";

// A reviewer sends a schedule back to draft, or its proposer withdraws it, with a reason.
export const POST = api({ body: reasonBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("return_schedule_to_draft", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId, p_reason: body.reason }),
);
