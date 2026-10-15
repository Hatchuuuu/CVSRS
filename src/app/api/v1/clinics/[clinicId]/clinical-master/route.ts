import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_clinical_master", { p_clinic_id: params.clinicId }));
