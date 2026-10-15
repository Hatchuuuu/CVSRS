import { api } from "@/lib/api/handler";

// Guardian with verified full access: today's schedule, computed on demand, limited projection, nothing persisted.
export const GET = api({ rate: { limit: 60, windowMs: 60_000 } }, async ({ rpc, params }) => rpc.rpc("guardian_get_schedule", { p_child_id: params.childId }));
