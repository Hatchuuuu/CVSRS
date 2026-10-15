import { api } from "@/lib/api/handler";
import { privacyAcknowledgementBody } from "@/lib/validation/followup";

export const POST = api({ body: privacyAcknowledgementBody }, async ({ rpc, params, opKey, body }) => rpc.rpc("acknowledge_clinic_privacy_notice", {
  p_operation_key: opKey, p_clinic_id: params.clinicId, p_notice_version: body.version, p_notice_text: body.text,
}));
