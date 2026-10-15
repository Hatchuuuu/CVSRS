import { api } from "@/lib/api/handler";

export const GET = api({ rate: { limit: 120, windowMs: 60_000 } }, async ({ rpc, params }) => rpc.rpc("list_stock", { p_clinic_id: params.clinicId }));
