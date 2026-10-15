import { api } from "@/lib/api/handler";
import { verifyEvidenceBody } from "@/lib/validation/clinical";

export const POST = api({ body: verifyEvidenceBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("verify_outside_dose", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_event_id: params.eventId,
    p_decision: body.decision,
    p_product_id: body.productId ?? null,
    p_administered_on: body.administeredOn ?? null,
    p_note: body.note ?? null,
  }),
);
