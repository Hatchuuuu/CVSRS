import { api } from "@/lib/api/handler";
import { attemptBody } from "@/lib/validation/followup";

export const POST = api({ body: attemptBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("log_followup_attempt", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_child_id: params.childId, p_outcome: body.outcome, p_note: body.note ?? null, p_next_try_on: body.nextTryOn ?? null }),
);
