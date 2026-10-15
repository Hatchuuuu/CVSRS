import { api } from "@/lib/api/handler";
import { wastageBody } from "@/lib/validation/inventory";

export const POST = api({ body: wastageBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("record_wastage", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_location_id: body.locationId,
    p_lot_id: body.lotId,
    p_quantity: body.quantity,
    p_reason: body.reason,
    p_incident_reference: body.incidentReference ?? null,
  }),
);
