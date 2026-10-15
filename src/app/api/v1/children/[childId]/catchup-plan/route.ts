import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("guardian_get_catchup_plan", { p_child_id: params.childId }));
