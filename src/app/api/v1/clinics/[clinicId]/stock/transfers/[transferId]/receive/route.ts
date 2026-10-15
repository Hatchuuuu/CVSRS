import { api } from "@/lib/api/handler";
import { receiveTransferBody } from "@/lib/validation/transfers";

export const POST = api({ body: receiveTransferBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("receive_stock_transfer", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_transfer_id: params.transferId, p_location_id: body.locationId, p_received_quantity: body.receivedQuantity, p_accepted: body.accepted, p_note: body.note ?? null }),
);
