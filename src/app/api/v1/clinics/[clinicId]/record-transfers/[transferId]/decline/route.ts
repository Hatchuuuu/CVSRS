import { api } from "@/lib/api/handler";
import { declineTransferBody } from "@/lib/validation/transfer";

export const POST = api({ body: declineTransferBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("decline_record_transfer", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_transfer_id: params.transferId, p_reason: body.reason }),
);
