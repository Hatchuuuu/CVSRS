import { api } from "@/lib/api/handler";
import { closeDayBody } from "@/lib/validation/visits";

// Closes one past service day: unfinished tickets and visits end, missed bookings become no-shows, sessions close (0037).
export const POST = api({ body: closeDayBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("close_service_day", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_service_date: body.serviceDate }),
);
