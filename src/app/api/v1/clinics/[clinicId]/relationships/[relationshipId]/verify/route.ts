import { api } from "@/lib/api/handler";
import { verifyRelationshipBody } from "@/lib/validation/schemas";

export const POST = api({ body: verifyRelationshipBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("verify_relationship", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_relationship_id: params.relationshipId, p_method: body.method }),
);
