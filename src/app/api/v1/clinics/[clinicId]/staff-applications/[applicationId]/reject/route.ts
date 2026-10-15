import { api } from "@/lib/api/handler";
import { rejectApplicationBody } from "@/lib/validation/staff";

export const POST = api({ body: rejectApplicationBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("reject_staff_application", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_application_id: params.applicationId,
    p_expected_version: body.expectedVersion,
    p_reason: body.reason,
  }),
);
