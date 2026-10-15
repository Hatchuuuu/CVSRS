import { api } from "@/lib/api/handler";
import { resolveShortfallBody } from "@/lib/validation/transfers";

export const POST = api({ body: resolveShortfallBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("resolve_transfer_shortfall", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_transfer_id: params.transferId, p_decision: body.decision, p_note: body.note, p_return_location_id: body.returnLocationId ?? null }),
);
