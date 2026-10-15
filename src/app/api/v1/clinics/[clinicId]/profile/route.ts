import { api } from "@/lib/api/handler";
import { profileBody } from "@/lib/validation/config";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("get_clinic_profile", { p_clinic_id: params.clinicId }));
export const POST = api({ body: profileBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("update_clinic_profile", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_name: body.name, p_address: body.address ?? null, p_contact: body.contact ?? null, p_hours: body.hours ?? null, p_timezone: body.timezone }),
);
