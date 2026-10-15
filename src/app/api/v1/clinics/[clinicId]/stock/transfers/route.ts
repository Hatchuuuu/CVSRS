import { api } from "@/lib/api/handler";
import { sendTransferBody } from "@/lib/validation/transfers";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_stock_transfers", { p_clinic_id: params.clinicId }));
export const POST = api({ body: sendTransferBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("send_stock_transfer", { p_operation_key: opKey, p_from_clinic_id: params.clinicId, p_to_clinic_id: body.toClinicId, p_from_location_id: body.fromLocationId, p_lot_id: body.lotId, p_quantity: body.quantity, p_note: body.note ?? null }),
);
