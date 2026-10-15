import { api } from "@/lib/api/handler";
import { revokeCertificateBody } from "@/lib/validation/certificates";

export const POST = api({ body: revokeCertificateBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("revoke_certificate", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_certificate_id: params.certificateId, p_reason: body.reason }),
);
