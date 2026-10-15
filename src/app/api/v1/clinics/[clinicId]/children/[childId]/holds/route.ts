import { api } from "@/lib/api/handler";
import { placeHoldBody } from "@/lib/validation/followup";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_clinical_holds", { p_clinic_id: params.clinicId, p_child_id: params.childId }));
export const POST = api({ body: placeHoldBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("place_clinical_hold", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_child_id: params.childId, p_reason_code: body.reason, p_restricted_note: body.restrictedNote ?? null, p_review_on: body.reviewOn ?? null, p_rule_id: body.ruleId ?? null }),
);
