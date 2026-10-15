import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ rpc, params, opKey }) => rpc.rpc("verify_guardian_contact", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_guardian_id: params.guardianId }));
