import { api } from "@/lib/api/handler";
import { answerCheckinBody } from "@/lib/validation/care";

export const POST = api({ body: answerCheckinBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("answer_checkin", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_checkin_id: params.checkinId, p_answer: body.answer }),
);
