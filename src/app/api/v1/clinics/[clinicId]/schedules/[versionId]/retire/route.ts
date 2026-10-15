import { api } from "@/lib/api/handler";
import { reasonBody } from "@/lib/validation/clinical";

export const POST = api({ body: reasonBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("retire_schedule", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId, p_reason: body.reason }),
);
