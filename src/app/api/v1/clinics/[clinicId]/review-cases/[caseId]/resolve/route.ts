import { api } from "@/lib/api/handler";
import { resolveCaseBody } from "@/lib/validation/schemas";

export const POST = api({ body: resolveCaseBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("resolve_review_case", { p_operation_key: opKey, p_case_id: params.caseId, p_outcome: body.outcome, p_reason: body.reason }),
);
