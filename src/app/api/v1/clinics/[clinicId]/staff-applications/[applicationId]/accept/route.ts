import { api } from "@/lib/api/handler";
import { acceptApplicationBody } from "@/lib/validation/staff";

// Accepting files the ordinary staff-access request; a different person still approves it (two-person control in the database).
export const POST = api({ body: acceptApplicationBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("accept_staff_application", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_application_id: params.applicationId,
    p_expected_version: body.expectedVersion,
    p_role: body.role ?? null,
    p_capabilities: body.capabilities,
  }),
);
