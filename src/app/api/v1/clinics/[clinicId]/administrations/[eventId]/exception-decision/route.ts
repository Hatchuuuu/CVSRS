import { api } from "@/lib/api/handler";
import { exceptionDecisionBody } from "@/lib/validation/administration";

export const POST = api({ body: exceptionDecisionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("resolve_administration_exception", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_event_id: params.eventId, p_decision: body.decision, p_note: body.note }),
);
