import { api } from "@/lib/api/handler";
import { releaseHoldBody } from "@/lib/validation/followup";

export const POST = api({ body: releaseHoldBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("release_clinical_hold", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_hold_id: params.holdId, p_note: body.note }),
);
