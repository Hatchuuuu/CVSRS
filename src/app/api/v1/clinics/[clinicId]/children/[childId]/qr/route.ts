import { api } from "@/lib/api/handler";

export const POST = api({ rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, params, opKey }) =>
  rpc.rpc("issue_qr_pass", { p_operation_key: opKey, p_child_id: params.childId, p_clinic_id: params.clinicId }),
);
export const DELETE = api({}, async ({ rpc, params, opKey }) =>
  rpc.rpc("revoke_qr_pass", { p_operation_key: opKey, p_child_id: params.childId, p_clinic_id: params.clinicId }),
);
