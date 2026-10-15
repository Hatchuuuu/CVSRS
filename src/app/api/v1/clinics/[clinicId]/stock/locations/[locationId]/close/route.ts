import { api } from "@/lib/api/handler";
import { reasonBody } from "@/lib/validation/clinical";

// Only an empty location with nothing in transit can close.
export const POST = api({ body: reasonBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("close_stock_location", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_location_id: params.locationId, p_reason: body.reason }),
);
