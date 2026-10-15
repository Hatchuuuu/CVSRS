import { api } from "@/lib/api/handler";
import { adjustmentBody } from "@/lib/validation/inventory";

// A physical count. Differences above the approval threshold are only PROPOSED and need a second person.
export const POST = api({ body: adjustmentBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("propose_stock_adjustment", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_location_id: body.locationId,
    p_lot_id: body.lotId,
    p_observed: body.observed,
    p_count_reference: body.countReference,
    p_reason: body.reason,
  }),
);
