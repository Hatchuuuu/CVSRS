import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params, query }) => rpc.rpc("list_checkins", { p_clinic_id: params.clinicId, p_status: query.get("status") ?? "open" }));
