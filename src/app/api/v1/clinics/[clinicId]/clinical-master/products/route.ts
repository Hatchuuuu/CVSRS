import { api } from "@/lib/api/handler";
import { productBody } from "@/lib/validation/clinical";

export const POST = api({ body: productBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("create_vaccine_product", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_product: body }),
);
