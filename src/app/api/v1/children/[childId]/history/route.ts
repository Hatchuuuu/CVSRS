import { api } from "@/lib/api/handler";

export const GET = api({ rate: { limit: 60, windowMs: 60_000 } }, async ({ rpc, params }) => rpc.rpc("guardian_child_history", { p_child_id: params.childId }));
