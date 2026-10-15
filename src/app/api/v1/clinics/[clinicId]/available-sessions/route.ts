import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import { api } from "@/lib/api/handler";

const range = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

// Open sessions with room, for signed-in guardians. Exposes no booking or child information.
export const GET = api({ rate: { limit: 60, windowMs: 60_000 } }, async ({ rpc, params, query }) => {
  const p = range.safeParse({ from: query.get("from") ?? undefined, to: query.get("to") ?? undefined });
  if (!p.success) throw new AppError("unprocessable", 422, "from and to must be dates (YYYY-MM-DD).");
  return rpc.rpc("guardian_list_sessions", { p_clinic_id: params.clinicId, p_from: p.data.from ?? null, p_to: p.data.to ?? null });
});
