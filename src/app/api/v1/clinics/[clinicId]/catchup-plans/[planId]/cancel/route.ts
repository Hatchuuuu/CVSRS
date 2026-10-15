import { api } from "@/lib/api/handler";
import { reasonBody } from "@/lib/validation/care";

export const POST = api({ body: reasonBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("cancel_catchup_plan", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_plan_id: params.planId, p_reason: body.reason }),
);
