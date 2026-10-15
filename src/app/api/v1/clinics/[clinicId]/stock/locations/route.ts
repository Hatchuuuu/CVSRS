import { api } from "@/lib/api/handler";
import { locationBody } from "@/lib/validation/inventory";

export const POST = api({ body: locationBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("create_stock_location", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_name: body.name, p_kind: body.kind }),
);
