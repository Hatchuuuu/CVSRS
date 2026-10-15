import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ rpc, params, opKey }) => rpc.rpc("cancel_record_transfer_guardian", { p_operation_key: opKey, p_transfer_id: params.transferId }));
