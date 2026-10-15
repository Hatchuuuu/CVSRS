import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("list_lot_ledger", { p_clinic_id: params.clinicId, p_lot_id: params.lotId }));
