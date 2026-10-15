import { api } from "@/lib/api/handler";
import { itemStatusBody } from "@/lib/validation/care";

export const POST = api({ body: itemStatusBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_catchup_item_status", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_item_id: params.itemId, p_status: body.status, p_note: body.note }),
);
