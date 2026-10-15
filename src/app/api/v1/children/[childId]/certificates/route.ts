import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("guardian_list_certificates", { p_child_id: params.childId }));
