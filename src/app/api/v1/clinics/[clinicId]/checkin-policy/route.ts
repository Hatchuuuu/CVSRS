import { api } from "@/lib/api/handler";
import { checkinPolicyBody } from "@/lib/validation/care";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("get_checkin_policy", { p_clinic_id: params.clinicId }));
export const POST = api({ body: checkinPolicyBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_checkin_policy", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_enabled: body.enabled, p_safety_notice: body.safetyNotice ?? null }),
);
