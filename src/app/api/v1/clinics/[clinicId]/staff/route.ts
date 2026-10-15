import { AppError } from "@/lib/api/errors";
import { api } from "@/lib/api/handler";
import { requestStaffBody } from "@/lib/validation/staff";
import { STAFF_SIGN_UP_PATH } from "@/lib/auth/staff-entry";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_staff_memberships", { p_clinic_id: params.clinicId }));

// Two-person control lives in the database: this only creates a PENDING request. Approval is a separate act by someone else.
export const POST = api({ body: requestStaffBody, rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) => {
  const found = await rpc.rpc<{ profileId: string }>("find_profile_for_grant", { p_clinic_id: params.clinicId, p_email: body.email });
  if (!found) throw new AppError("not_found", 404, `No account uses that email address yet. Ask the person to create a staff account at ${STAFF_SIGN_UP_PATH}, then request access again.`);
  return rpc.rpc("request_staff_membership", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_profile_id: found.profileId,
    p_role: body.role,
    p_capabilities: body.capabilities,
    p_valid_until: body.validUntil ?? null,
  });
});
