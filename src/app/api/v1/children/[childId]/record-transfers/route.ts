import { api } from "@/lib/api/handler";
import { requestTransferBody } from "@/lib/validation/transfer";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("my_record_transfers", { p_child_id: params.childId }));
export const POST = api({ body: requestTransferBody, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("request_record_transfer_guardian", { p_operation_key: opKey, p_child_id: params.childId, p_to_clinic_id: body.toClinicId }),
);
