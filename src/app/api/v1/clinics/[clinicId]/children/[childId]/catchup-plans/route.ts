import { api } from "@/lib/api/handler";
import { saveCatchupBody } from "@/lib/validation/care";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_catchup_plans", { p_clinic_id: params.clinicId, p_child_id: params.childId }));
export const POST = api({ body: saveCatchupBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("save_catchup_draft", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_child_id: params.childId, p_plan_id: body.planId ?? null, p_rationale: body.rationale, p_policy_reference: body.policyReference, p_items: body.items }),
);
