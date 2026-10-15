import { api } from "@/lib/api/handler";
import { cardBody } from "@/lib/validation/card-submission";
export const POST = api({ body: cardBody, maxBodyBytes: 50000 }, async ({ rpc, params, body, opKey }) => rpc.rpc("submit_card_record", { p_operation_key: opKey, p_child_id: params.childId, p_rows: body.rows, p_submission_id: body.submissionId ?? null, p_expected_version: body.expectedVersion ?? null }));
export const GET = api({}, async ({ rpc, params }) => rpc.rpc("guardian_list_card_submissions", { p_child_id: params.childId }));
