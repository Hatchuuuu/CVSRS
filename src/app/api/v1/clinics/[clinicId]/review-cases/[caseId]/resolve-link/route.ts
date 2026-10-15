import { api } from "@/lib/api/handler";
import { resolveLinkBody } from "@/lib/validation/schemas";

export const POST = api({ body: resolveLinkBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("resolve_link_case", {
    p_operation_key: opKey,
    p_case_id: params.caseId,
    p_decision: body.decision,
    p_child_id: body.childId ?? null,
    p_method: body.method,
    p_reason: body.reason ?? null,
  }),
);
