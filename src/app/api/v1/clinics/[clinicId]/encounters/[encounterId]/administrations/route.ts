import { api } from "@/lib/api/handler";
import { administrationBody } from "@/lib/validation/administration";

// One transaction: signed record + stock issue + schedule re-evaluation + audit + receipt. Any failure saves nothing.
export const POST = api({ body: administrationBody, rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("record_administration", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_encounter_id: params.encounterId, p_admin: body }),
);
