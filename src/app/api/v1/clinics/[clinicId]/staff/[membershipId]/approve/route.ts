import { api } from "@/lib/api/handler";
import { approveStaffBody } from "@/lib/validation/staff";

export const POST = api({ body: approveStaffBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("approve_staff_membership", { p_operation_key: opKey, p_membership_id: params.membershipId, p_expected_version: body.expectedVersion }),
);
