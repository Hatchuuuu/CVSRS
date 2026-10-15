import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ rpc, params, opKey }) => rpc.rpc("approve_record_transfer_release", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_transfer_id: params.transferId }));
