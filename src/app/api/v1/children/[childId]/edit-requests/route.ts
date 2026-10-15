import { api } from "@/lib/api/handler";
import { requestEditBody } from "@/lib/validation/schemas";

export const POST = api({ body: requestEditBody, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("request_child_edit", { p_operation_key: opKey, p_child_id: params.childId, p_patch: body.patch, p_reason: body.reason ?? null }),
);
