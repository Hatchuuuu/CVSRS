import { api } from "@/lib/api/handler";
import { importScheduleBody } from "@/lib/validation/clinical";

export const POST = api({ body: importScheduleBody, maxBodyBytes: 5_000_000, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("import_schedule_draft", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_payload: body.payload }),
);
