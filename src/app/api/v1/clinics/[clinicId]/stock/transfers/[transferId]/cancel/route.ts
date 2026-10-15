import { api } from "@/lib/api/handler";
import { cancelTransferBody } from "@/lib/validation/transfers";

export const POST = api({ body: cancelTransferBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("cancel_stock_transfer", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_transfer_id: params.transferId, p_reason: body.reason }),
);
