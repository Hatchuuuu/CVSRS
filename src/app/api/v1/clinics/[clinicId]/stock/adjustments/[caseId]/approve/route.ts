import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ rpc, params, opKey }) =>
  rpc.rpc("approve_stock_adjustment", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_case_id: params.caseId }),
);
