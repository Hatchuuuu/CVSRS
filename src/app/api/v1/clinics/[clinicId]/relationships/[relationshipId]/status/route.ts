import { api } from "@/lib/api/handler";
import { relationshipStatusBody } from "@/lib/validation/schemas";

export const POST = api({ body: relationshipStatusBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_relationship_status", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_relationship_id: params.relationshipId,
    p_status: body.status,
    p_reason: body.reason,
  }),
);
