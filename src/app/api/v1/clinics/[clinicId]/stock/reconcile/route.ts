import { api } from "@/lib/api/handler";
import { reconcileBody } from "@/lib/validation/inventory";

// Compares the balance projection with the immutable ledger. Repair only rebuilds the projection, never the ledger.
export const POST = api({ body: reconcileBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("reconcile_stock", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_repair: body.repair }),
);
