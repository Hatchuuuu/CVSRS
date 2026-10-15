import { api } from "@/lib/api/handler";

// Private status for the guardian's own child (ticket, state, people ahead). Null (404) when not in today's queue.
export const GET = api({ rate: { limit: 120, windowMs: 60_000 } }, async ({ rpc, params }) => rpc.rpc("guardian_queue_status", { p_child_id: params.childId }));
