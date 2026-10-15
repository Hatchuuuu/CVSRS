import { api } from "@/lib/api/handler";
import { priorityBody } from "@/lib/validation/visits";

export const POST = api({ body: priorityBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_queue_priority", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_entry_id: params.entryId, p_priority: body.priority, p_reason: body.reason ?? null }),
);
