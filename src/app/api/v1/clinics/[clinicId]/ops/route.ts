import { api } from "@/lib/api/handler";
import { opsCheckBody } from "@/lib/validation/config";

export const GET = api({}, async ({ rpc, params }) => rpc.rpc("get_ops_status", { p_clinic_id: params.clinicId }));
export const POST = api({ body: opsCheckBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("record_ops_check", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_kind: body.kind, p_result: body.result, p_performed_on: body.performedOn, p_evidence: body.evidence }),
);
