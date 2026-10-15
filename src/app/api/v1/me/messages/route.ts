import { api } from "@/lib/api/handler";
import { positiveQueryInt } from "@/lib/api/query";
import { timestampCursor } from "@/lib/api/list-cursors";

export const GET = api({}, async ({ rpc, query }) => {
  const cursor = timestampCursor(query);
  return rpc.rpc("my_messages", { p_limit: positiveQueryInt(query.get("limit"), 50, 100), p_before: cursor?.at ?? null, p_before_id: cursor?.id ?? null });
});
