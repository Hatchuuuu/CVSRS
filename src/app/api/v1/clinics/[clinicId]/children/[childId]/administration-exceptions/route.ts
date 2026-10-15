import { api } from "@/lib/api/handler";
import { exceptionBody } from "@/lib/validation/administration";

// Care that has ALREADY been given but fails the normal checks: facts are kept, credit is withheld, stock is never invented.
export const POST = api({ body: exceptionBody, rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("record_administration_exception", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child_id: params.childId,
    p_encounter_id: body.encounterId ?? null,
    p_admin: body.dose,
    p_reason: body.reason,
  }),
);
