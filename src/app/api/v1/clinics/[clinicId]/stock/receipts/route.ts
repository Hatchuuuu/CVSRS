import { api } from "@/lib/api/handler";
import { receiptBody } from "@/lib/validation/inventory";

export const POST = api({ body: receiptBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("receive_stock", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_location_id: body.locationId,
    p_lot_id: body.lotId,
    p_quantity: body.quantity,
    p_delivery_reference: body.deliveryReference,
    p_accepted: body.accepted,
  }),
);
