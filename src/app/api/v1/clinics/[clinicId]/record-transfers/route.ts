import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_record_transfers", { p_clinic_id: params.clinicId }));
