import { api } from "@/lib/api/handler";
import { confirmIdentityBody } from "@/lib/validation/schemas";

export const POST = api({ body: confirmIdentityBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("confirm_child_identity", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child_id: params.childId,
    p_expected_version: body.expectedVersion,
    p_note: body.note ?? null,
  }),
);
