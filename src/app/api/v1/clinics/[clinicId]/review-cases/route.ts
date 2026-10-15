import { z } from "zod";
import { api } from "@/lib/api/handler";
import { timestampCursor } from "@/lib/api/list-cursors";
import { positiveQueryInt } from "@/lib/api/query";

const statusSchema = z.enum(["open", "in_review", "resolved", "rejected"]).catch("open");

export const GET = api({}, async ({ rpc, params, query }) => {
  const cursor = timestampCursor(query, "after");
  return rpc.rpc("list_review_cases", { p_clinic_id: params.clinicId, p_status: statusSchema.parse(query.get("status") ?? "open"), p_limit: positiveQueryInt(query.get("limit"), 50, 100), p_after: cursor?.at ?? null, p_after_id: cursor?.id ?? null });
});
