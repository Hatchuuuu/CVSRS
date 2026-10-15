import { api } from "@/lib/api/handler";

// A child's bookings at this clinic (the last 30 days and everything ahead), for staff with appointment or queue duties.
export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_child_appointments", { p_clinic_id: params.clinicId, p_child_id: params.childId }));
