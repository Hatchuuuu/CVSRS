import { api } from "@/lib/api/handler";
import { masterStatusBody } from "@/lib/validation/clinical";

// Clinical governance act: needs rules.approve and a different person than the creator (enforced in the database).
export const POST = api({ body: masterStatusBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_master_status", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_kind: body.kind, p_id: body.id, p_status: body.status }),
);
