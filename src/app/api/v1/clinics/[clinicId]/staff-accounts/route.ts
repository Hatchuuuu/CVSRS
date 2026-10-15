import { api } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { getConfig } from "@/lib/env";
import { createHmac } from "node:crypto";
import { createStaffAccountBody } from "@/lib/validation/staff";

interface SignupReply { user?: { id?: string; email?: string }; access_token?: string; error_description?: string; msg?: string }

// Uses the public Auth signup contract, so no service-role credential enters the web runtime. The database trigger files the staff
// application; an access administrator still accepts it and a different person approves clinical access.
export const POST = api({ body: createStaffAccountBody, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) => {
  const ctx = await rpc.rpc<{ mfa: boolean; memberships: { clinicId: string; status: string; validUntil?: string | null; capabilities: string[] }[] }>("get_my_context");
  if (!ctx?.mfa || !ctx.memberships.some((m) => m.clinicId === params.clinicId && m.status === "active" && (!m.validUntil || Date.parse(m.validUntil) > Date.now()) && m.capabilities.includes("admin.users"))) {
    throw new AppError("forbidden", 403, "Account creation requires an active clinic access administrator and two-step sign-in.");
  }
  const { temporaryPassword, ...details } = body;
  const creationSecret = process.env.CVSRS_CERTIFICATE_RENDER_SECRET;
  if (!creationSecret) throw new AppError("unavailable", 503, "Staff account creation is unavailable. Restart the configured local application.");
  const passwordHash = createHmac("sha256", creationSecret).update(`staff-account-password\0${opKey}\0${temporaryPassword}`).digest("hex");
  const prepared = await rpc.rpc<{ profileId?: string; status: string }>("prepare_staff_account_creation", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_payload: { ...details, passwordHash } });
  if (prepared?.status === "pending_approval" || prepared?.profileId) return rpc.rpc("complete_staff_account_creation", { p_operation_key: opKey, p_clinic_id: params.clinicId });
  const cfg = getConfig();
  const response = await fetch(`${cfg.supabaseUrl}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: cfg.supabaseKey, authorization: `Bearer ${cfg.supabaseKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      email: body.email,
      password: body.temporaryPassword,
      data: {
        display_name: body.fullName,
        preferred_language: "en",
        staff_creation_key: opKey,
        staff_application: { clinic_id: params.clinicId, role: body.role, position_title: body.positionTitle ?? null, note: "Account created by clinic administrator" },
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const result = (await response.json().catch(() => ({}))) as SignupReply;
  if (!response.ok) throw new AppError("invalid_request", response.status === 429 ? 429 : 400, "The sign-in service could not create this account. Check the details and retry.");
  if (!result.user?.id || !result.access_token) throw new AppError("conflict", 409, "That email may already have an account, or immediate account access is unavailable.");
  return rpc.rpc("complete_staff_account_creation", { p_operation_key: opKey, p_clinic_id: params.clinicId });
});
