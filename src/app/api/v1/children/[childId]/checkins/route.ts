import { api } from "@/lib/api/handler";
import { createCheckinBody } from "@/lib/validation/care";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("my_checkins", { p_child_id: params.childId }));
export const POST = api({ body: createCheckinBody, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("create_checkin", { p_operation_key: opKey, p_child_id: params.childId, p_category: body.category, p_message: body.message }),
);
