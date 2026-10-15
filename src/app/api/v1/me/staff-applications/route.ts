import { api } from "@/lib/api/handler";
import { submitApplicationBody } from "@/lib/validation/staff";

/** The signed-in person's own staff applications, newest first. */
export const GET = api({}, async ({ rpc }) => rpc.rpc("my_staff_applications"));

/** Apply to a health center for a staff role. An application is a request only; access needs an administrator and a second approver. */
export const POST = api({ body: submitApplicationBody, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, body, opKey }) =>
  rpc.rpc("submit_staff_application", {
    p_operation_key: opKey,
    p_clinic_id: body.clinicId,
    p_role: body.role,
    p_position_title: body.positionTitle || null,
    p_note: body.note || null,
  }),
);
