import { api } from "@/lib/api/handler";
import { initiateTransferBody } from "@/lib/validation/transfer";

export const POST = api({ body: initiateTransferBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("initiate_record_transfer_out", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_child_id: params.childId, p_to_clinic_id: body.toClinicId, p_reason: body.reason ?? null }),
);
