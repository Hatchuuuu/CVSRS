import { api } from "@/lib/api/handler";
import { staffOutsideDoseBody } from "@/lib/validation/clinical";

export const POST = api({ body: staffOutsideDoseBody, rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("record_outside_dose_staff", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child_id: params.childId,
    p_dose: body.dose,
    p_product_id: body.productId ?? null,
    p_verified: body.verified,
  }),
);
