import { api } from "@/lib/api/handler";
export const POST = api({}, async ({ rpc, params, opKey }) => rpc.rpc("withdraw_card_submission", { p_operation_key: opKey, p_submission_id: params.submissionId }));
