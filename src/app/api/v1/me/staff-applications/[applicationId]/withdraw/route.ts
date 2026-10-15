import { api } from "@/lib/api/handler";

export const POST = api({}, async ({ rpc, params, opKey }) =>
  rpc.rpc("withdraw_staff_application", { p_operation_key: opKey, p_application_id: params.applicationId }),
);
