import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("get_schedule_version", { p_clinic_id: params.clinicId, p_version_id: params.versionId }));
