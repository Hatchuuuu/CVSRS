import { api } from "@/lib/api/handler";
import { updateChildBody } from "@/lib/validation/schemas";

// Identifiable read: goes through the audited command, never a direct table read.
export const GET = api({ rate: { limit: 120, windowMs: 60_000 } }, async ({ rpc, params }) =>
  rpc.rpc("staff_get_child", { p_clinic_id: params.clinicId, p_child_id: params.childId }),
);

export const PATCH = api({ body: updateChildBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("update_child_identity", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child_id: params.childId,
    p_expected_version: body.expectedVersion,
    p_patch: body.patch,
    p_reason: body.reason ?? null,
  }),
);
