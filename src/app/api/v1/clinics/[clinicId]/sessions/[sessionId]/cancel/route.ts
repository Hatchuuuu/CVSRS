import { api } from "@/lib/api/handler";
import { cancelSessionBody } from "@/lib/validation/visits";

// Never cancels bookings silently: each affected appointment becomes follow-up work.
export const POST = api({ body: cancelSessionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("cancel_session", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_session_id: params.sessionId, p_reason: body.reason }),
);
