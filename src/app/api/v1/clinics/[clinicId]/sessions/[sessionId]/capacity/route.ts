import { api } from "@/lib/api/handler";
import { capacityBody } from "@/lib/validation/visits";

// Bookable places can never go below the families already booked; the database checks it against the version the person saw.
export const POST = api({ body: capacityBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("update_session_capacity", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_session_id: params.sessionId,
    p_expected_version: body.expectedVersion,
    p_total: body.totalCapacity,
    p_online: body.onlineCapacity,
    p_walkin: body.walkinCapacity,
  }),
);
