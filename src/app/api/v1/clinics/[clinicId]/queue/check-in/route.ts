import { api } from "@/lib/api/handler";
import { checkInBody } from "@/lib/validation/visits";

// Arrival creates the ticket. Booking alone never issues a queue number (BP17).
export const POST = api({ body: checkInBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("check_in", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child_id: body.childId,
    p_appointment_id: body.appointmentId ?? null,
    p_overflow_reason: body.overflowReason ?? null,
  }),
);
