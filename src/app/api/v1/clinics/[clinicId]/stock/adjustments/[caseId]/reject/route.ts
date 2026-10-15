import { api } from "@/lib/api/handler";
import { reasonBody } from "@/lib/validation/clinical";

// Rejects a stock count awaiting approval; nothing is posted to the ledger.
export const POST = api({ body: reasonBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("reject_stock_adjustment", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_case_id: params.caseId, p_reason: body.reason }),
);
