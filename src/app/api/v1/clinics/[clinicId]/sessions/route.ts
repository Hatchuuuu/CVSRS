import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import { api } from "@/lib/api/handler";
import { sessionBody } from "@/lib/validation/visits";

const range = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() });

export const GET = api({}, async ({ rpc, params, query }) => {
  const p = range.safeParse({ from: query.get("from") ?? undefined, to: query.get("to") ?? undefined });
  if (!p.success) throw new AppError("unprocessable", 422, "from and to must be dates (YYYY-MM-DD).");
  return rpc.rpc("list_sessions", { p_clinic_id: params.clinicId, p_from: p.data.from ?? null, p_to: p.data.to ?? null });
});

export const POST = api({ body: sessionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("create_session", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_session: body }),
);
