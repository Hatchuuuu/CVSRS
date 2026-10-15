import { api } from "@/lib/api/handler";

// Guardian with verified full access issues (replaces) or revokes the child's QR pass. The token is returned once.
export const POST = api({ rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, params, opKey }) =>
  rpc.rpc("issue_qr_pass", { p_operation_key: opKey, p_child_id: params.childId }),
);
export const DELETE = api({}, async ({ rpc, params, opKey }) => rpc.rpc("revoke_qr_pass", { p_operation_key: opKey, p_child_id: params.childId }));
