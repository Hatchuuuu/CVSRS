import { api } from "@/lib/api/handler";

/** `?view=decided` lists the 50 most recent decisions; otherwise the applications waiting for a decision. */
export const GET = api({}, async ({ rpc, params, query }) =>
  rpc.rpc("list_staff_applications", { p_clinic_id: params.clinicId, p_view: query.get("view") === "decided" ? "decided" : "pending" }),
);
