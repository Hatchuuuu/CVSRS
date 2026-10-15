import { api } from "@/lib/api/handler";
import { linkRequestBody } from "@/lib/validation/schemas";

// Never confirms or denies that a matching child exists; staff review decides.
export const POST = api({ body: linkRequestBody, rate: { limit: 5, windowMs: 60_000, onStoreFailure: "closed" } }, async ({ rpc, body, opKey }) =>
  rpc.rpc("request_guardian_link", {
    p_operation_key: opKey,
    p_clinic_id: body.clinicId,
    p_descriptor: { childName: body.childName, dob: body.dob ?? "", note: body.note ?? "" },
    p_relationship: body.relationship,
  }),
);
