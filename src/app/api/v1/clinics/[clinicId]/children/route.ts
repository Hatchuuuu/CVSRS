import { z } from "zod";
import { AppError } from "@/lib/api/errors";
import { api } from "@/lib/api/handler";
import { staffRegisterBody } from "@/lib/validation/schemas";

const searchQuery = z.object({ q: z.string().trim().max(200).default(""), dob: z.iso.date().optional() });

// Clinic-scoped, bounded and audited search (query text is never logged).
export const GET = api({ rate: { limit: 60, windowMs: 60_000 } }, async ({ rpc, params, query }) => {
  const parsed = searchQuery.safeParse({ q: query.get("q") ?? "", dob: query.get("dob") ?? undefined });
  if (!parsed.success) throw new AppError("unprocessable", 422, "Enter at least two characters or a date of birth.");
  return rpc.rpc("staff_search_children", { p_clinic_id: params.clinicId, p_query: parsed.data.q, p_dob: parsed.data.dob ?? null, p_limit: 20 });
});

export const POST = api({ body: staffRegisterBody, rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("register_child_staff", {
    p_operation_key: opKey,
    p_clinic_id: params.clinicId,
    p_child: body.child,
    p_guardian: body.guardian ?? null,
    p_confirmed_distinct: body.confirmedDistinct,
    p_identity_confirmed: body.identityConfirmed,
  }),
);
