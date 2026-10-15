import { api } from "@/lib/api/handler";
import { revokeStaffBody } from "@/lib/validation/staff";

export const POST = api({ body: revokeStaffBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("revoke_staff_membership", { p_operation_key: opKey, p_membership_id: params.membershipId, p_reason: body.reason }),
);
