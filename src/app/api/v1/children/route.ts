import { api } from "@/lib/api/handler";
import { createProvisionalBody } from "@/lib/validation/schemas";

export const GET = api({}, async ({ rpc }) => rpc.rpc("my_children"));

// Guardian self-service: creates a PROVISIONAL child. Response shape never depends on duplicate matches.
export const POST = api({ body: createProvisionalBody, rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, body, opKey }) =>
  rpc.rpc("create_child_provisional", { p_operation_key: opKey, p_clinic_id: body.clinicId, p_child: body.child, p_relationship: body.relationship }),
);
