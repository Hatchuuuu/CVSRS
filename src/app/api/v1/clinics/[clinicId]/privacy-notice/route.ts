import { api } from "@/lib/api/handler";
import { privacyNoticeBody } from "@/lib/validation/followup";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("get_privacy_notice", { p_clinic_id: params.clinicId }));
export const POST = api({ body: privacyNoticeBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("set_privacy_notice", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version: body.version, p_text: body.text }),
);
