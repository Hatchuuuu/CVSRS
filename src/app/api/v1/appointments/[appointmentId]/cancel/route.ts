import { api } from "@/lib/api/handler";
import { cancelAppointmentBody } from "@/lib/validation/visits";

export const POST = api({ body: cancelAppointmentBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("cancel_appointment", { p_operation_key: opKey, p_appointment_id: params.appointmentId, p_reason: body.reason ?? null }),
);
