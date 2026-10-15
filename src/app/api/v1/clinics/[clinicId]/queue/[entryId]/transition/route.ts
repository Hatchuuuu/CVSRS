import { api } from "@/lib/api/handler";
import { transitionBody } from "@/lib/validation/visits";

// Legal transitions, versions and reasons are enforced in the database; the queue never marks a vaccine as given.
export const POST = api({ body: transitionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("queue_transition", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_entry_id: params.entryId,
    p_to: body.to,
    p_expected_version: body.expectedVersion,
    p_station: body.station ?? null,
    p_reason: body.reason ?? null,
    p_outcome: body.outcome ?? null,
  }),
);
