import { api } from "@/lib/api/handler";
import { auditSearchArgs } from "@/lib/api/query";

export const GET = api({ rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, params, query }) =>
  rpc.rpc("search_audit", { p_clinic_id: params.clinicId, ...auditSearchArgs(query) }),
);
