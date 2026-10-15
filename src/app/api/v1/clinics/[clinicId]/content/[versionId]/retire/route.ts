import { api } from "@/lib/api/handler";
import { reasonOnly } from "@/lib/validation/config";

export const POST = api({ body: reasonOnly }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("retire_content", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId, p_reason: body.reason }),
);
