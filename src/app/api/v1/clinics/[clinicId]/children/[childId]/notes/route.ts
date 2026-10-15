import { api } from "@/lib/api/handler";
import { childNoteBody } from "@/lib/validation/clinical";

export const POST = api({ body: childNoteBody, rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("add_child_note", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_child_id: params.childId, p_category: body.category, p_note: body.note, p_family_visible: body.familyVisible, p_event_id: body.eventId ?? null }),
);
