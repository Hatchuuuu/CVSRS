import { api } from "@/lib/api/handler";
import { mergeBody } from "@/lib/validation/schemas";

// Reviewer-confirmed merge only. Names/DOB never trigger this automatically.
export const POST = api({ body: mergeBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("merge_children", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_survivor: body.survivorId,
    p_duplicate: body.duplicateId,
    p_reason: body.reason,
  }),
);
