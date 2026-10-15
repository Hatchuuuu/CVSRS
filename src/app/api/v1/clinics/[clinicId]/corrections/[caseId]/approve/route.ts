import { api } from "@/lib/api/handler";
import { approveCorrectionBody } from "@/lib/validation/administration";

export const POST = api({ body: approveCorrectionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("approve_correction", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_case_id: params.caseId, p_note: body.note ?? null }),
);
