import { api } from "@/lib/api/handler";
import { childRecordStatusBody } from "@/lib/validation/schemas";

// Marks a record inactive (moved away, died, other) or active again. Inactive children get no messages, bookings or follow-up.
export const POST = api({ body: childRecordStatusBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_child_record_status", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child_id: params.childId,
    p_status: body.status,
    p_reason: body.reason ?? null,
    p_note: body.note ?? null,
  }),
);
