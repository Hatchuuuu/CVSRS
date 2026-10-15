import { api } from "@/lib/api/handler";
import { activateBody } from "@/lib/validation/clinical";

export const POST = api({ body: activateBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("activate_schedule", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId, p_effective_from: body.effectiveFrom }),
);
