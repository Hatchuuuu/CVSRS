import { api } from "@/lib/api/handler";
import { reportOutsideDoseBody } from "@/lib/validation/clinical";

// A report from a guardian is pending evidence: it can never earn dose credit until a clinician verifies it.
export const POST = api({ body: reportOutsideDoseBody, rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("report_outside_dose", { p_operation_key: opKey, p_child_id: params.childId, p_dose: body.dose }),
);
