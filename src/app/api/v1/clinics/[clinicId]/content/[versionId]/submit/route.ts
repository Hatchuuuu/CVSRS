import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ rpc, params, opKey }) => rpc.rpc("submit_content", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_version_id: params.versionId }));
