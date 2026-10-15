import { api } from "@/lib/api/handler";
import { cardReviewBody } from "@/lib/validation/card-submission";
export const POST = api({ body: cardReviewBody }, async ({ rpc, params, body, opKey }) => rpc.rpc("review_card_submission", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_submission_id: params.submissionId, p_decision: body.decision, p_note: body.note, p_expected_version: body.expectedVersion, p_reviewed_rows: body.rows }));
