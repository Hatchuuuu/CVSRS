import { api } from "@/lib/api/handler";
import { positiveQueryInt } from "@/lib/api/query";
import { followupCursor } from "@/lib/api/list-cursors";

export const GET = api({}, async ({ rpc, params, query }) => {
  const cursor = followupCursor(query);
  return rpc.rpc("list_followup_worklist", { p_clinic_id: params.clinicId, p_filter: query.get("filter") ?? "behind", p_limit: positiveQueryInt(query.get("limit"), 50, 100),
    p_after_behind: cursor?.behind ?? null, p_after_due: cursor?.due ?? null, p_after_name: cursor?.name ?? null, p_after_id: cursor?.id ?? null });
});
