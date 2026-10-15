import { api } from "@/lib/api/handler";
import { lotBody } from "@/lib/validation/inventory";

export const POST = api({ body: lotBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("register_lot", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_product_id: body.productId,
    p_manufacturer_lot: body.manufacturerLot,
    p_expires_on: body.expiresOn,
    p_manufacturer: body.manufacturer ?? null,
  }),
);
