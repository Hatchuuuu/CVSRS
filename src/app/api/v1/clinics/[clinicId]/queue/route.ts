import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import { api } from "@/lib/api/handler";

export const GET = api({ rate: { limit: 240, windowMs: 60_000 } }, async ({ rpc, params, query }) => {
  const d = z.iso.date().optional().safeParse(query.get("date") ?? undefined);
  if (!d.success) throw new AppError("unprocessable", 422, "date must be YYYY-MM-DD.");
  return rpc.rpc("list_queue", { p_clinic_id: params.clinicId, p_date: d.data ?? null });
});
