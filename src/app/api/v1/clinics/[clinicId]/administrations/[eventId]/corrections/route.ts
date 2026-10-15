import { api } from "@/lib/api/handler";
import { correctionBody } from "@/lib/validation/administration";

// A proposal only. Nothing changes until a different person with correction.approve accepts it.
export const POST = api({ body: correctionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("request_correction", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_event_id: params.eventId, p_kind: body.kind, p_proposal: body.proposal, p_reason: body.reason }),
);
