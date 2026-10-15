import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_catchup_reviews", { p_clinic_id: params.clinicId }));
