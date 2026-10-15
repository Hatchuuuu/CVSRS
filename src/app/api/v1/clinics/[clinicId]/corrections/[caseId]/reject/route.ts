import { api } from "@/lib/api/handler";
import { rejectCorrectionBody } from "@/lib/validation/administration";

export const POST = api({ body: rejectCorrectionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("reject_correction", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_case_id: params.caseId, p_reason: body.reason }),
);
