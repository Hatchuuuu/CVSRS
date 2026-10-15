import { api } from "@/lib/api/handler";

// Restricted and audited: identifiable list of children who received doses from a lot (recall follow-up).
export const GET = api({ rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, params }) => rpc.rpc("trace_lot_use", { p_clinic_id: params.clinicId, p_lot_id: params.lotId }));
