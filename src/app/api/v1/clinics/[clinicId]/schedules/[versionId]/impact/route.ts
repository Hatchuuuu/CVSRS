import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("preview_schedule_impact", { p_clinic_id: params.clinicId, p_version_id: params.versionId }));
