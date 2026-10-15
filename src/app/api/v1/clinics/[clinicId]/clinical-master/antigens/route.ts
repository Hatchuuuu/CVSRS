import { api } from "@/lib/api/handler";
import { antigenBody } from "@/lib/validation/clinical";

export const POST = api({ body: antigenBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("create_antigen", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_code: body.code, p_name: body.name }),
);
