import { api } from "@/lib/api/handler";
import { contactInvalidBody } from "@/lib/validation/schemas";

// A phone number that does not reach the guardian; text messages stop until a new number is given.
export const POST = api({ body: contactInvalidBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("mark_guardian_contact_invalid", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_guardian_id: params.guardianId, p_note: body.note }),
);
