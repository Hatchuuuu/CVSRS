import { api } from "@/lib/api/handler";

// Who is booked into one session. Each read is audited by the database.
export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_session_roster", { p_clinic_id: params.clinicId, p_session_id: params.sessionId }));
