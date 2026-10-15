import { api } from "@/lib/api/handler";
import { callNextBody } from "@/lib/validation/visits";

export const POST = api({ body: callNextBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("call_next", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_station: body.station }),
);
