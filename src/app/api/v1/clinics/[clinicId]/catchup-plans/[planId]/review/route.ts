import { api } from "@/lib/api/handler";
import { reviewCatchupBody } from "@/lib/validation/care";

export const POST = api({ body: reviewCatchupBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("review_catchup_plan", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_plan_id: params.planId, p_decision: body.decision, p_note: body.note ?? null }),
);
