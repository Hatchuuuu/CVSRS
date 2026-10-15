import { api } from "@/lib/api/handler";
import { noteBody } from "@/lib/validation/clinical";

export const POST = api({ body: noteBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("approve_schedule", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId, p_note: body.note ?? null }),
);
