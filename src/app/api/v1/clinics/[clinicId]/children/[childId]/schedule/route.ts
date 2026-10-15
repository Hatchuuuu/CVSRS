import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import { api } from "@/lib/api/handler";

const asOf = z.iso.date().optional();

// Evaluates and pins a snapshot (identical inputs return the same stored evaluation).
export const GET = api({ rate: { limit: 120, windowMs: 60_000 } }, async ({ rpc, params, query }) => {
  const parsed = asOf.safeParse(query.get("asOf") ?? undefined);
  if (!parsed.success) throw new AppError("unprocessable", 422, "asOf must be a date (YYYY-MM-DD).");
  return rpc.rpc("evaluate_child", { p_clinic_id: params.clinicId, p_child_id: params.childId, p_as_of: parsed.data ?? null });
});
