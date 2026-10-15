import { z } from "zod";
import { api } from "@/lib/api/handler";
import { AppError } from "@/lib/api/errors";
import { findReport } from "@/lib/reports/catalog";

const date = z.iso.date();

export const GET = api({ rate: { limit: 60, windowMs: 60_000 } }, async ({ rpc, params, query }) => {
  const def = findReport(params.name!);
  if (!def) throw new AppError("not_found", 404, "Unknown report.");
  const from = date.safeParse(query.get("from"));
  const to = date.safeParse(query.get("to"));
  if (!from.success || !to.success) throw new AppError("unprocessable", 422, "Choose a start and end date.");
  return rpc.rpc(def.rpc, { p_clinic_id: params.clinicId, p_from: from.data, p_to: to.data, p_export: false });
});
