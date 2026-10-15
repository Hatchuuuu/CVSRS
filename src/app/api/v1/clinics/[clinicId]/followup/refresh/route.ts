import { api } from "@/lib/api/handler";

export const POST = api({ rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, params, opKey }) => rpc.rpc("refresh_followup", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_batch: 100 }));
