import { api } from "@/lib/api/handler";
import { rescheduleBody } from "@/lib/validation/visits";

// Atomic: if the new session cannot take the child, the original booking is left untouched.
export const POST = api({ body: rescheduleBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("reschedule_appointment", { p_operation_key: opKey, p_appointment_id: params.appointmentId, p_new_session_id: body.newSessionId, p_reason: body.reason ?? null }),
);
