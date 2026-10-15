import { api } from "@/lib/api/handler";
import { limitsBody } from "@/lib/validation/transfers";

export const POST = api({ body: limitsBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_cold_chain_limits", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_min_c: body.minC, p_max_c: body.maxC, p_policy_reference: body.policyReference }),
);
