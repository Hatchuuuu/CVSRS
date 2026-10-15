import { api } from "@/lib/api/handler";
import { dispositionBody } from "@/lib/validation/inventory";

export const POST = api({ body: dispositionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_lot_disposition", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_lot_id: params.lotId, p_disposition: body.disposition, p_reason: body.reason }),
);
