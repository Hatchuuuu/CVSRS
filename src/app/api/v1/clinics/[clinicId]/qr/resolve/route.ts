import { api } from "@/lib/api/handler";
import { resolveQrBody } from "@/lib/validation/schemas";

// Every failure (unknown, revoked, expired, other clinic) is the same 404 so a copied QR reveals nothing (T22).
export const POST = api({ body: resolveQrBody, rate: { limit: 30, windowMs: 60_000, onStoreFailure: "closed" } }, async ({ rpc, params, body }) =>
  rpc.rpc("resolve_qr", { p_clinic_id: params.clinicId, p_token: body.token }),
);
