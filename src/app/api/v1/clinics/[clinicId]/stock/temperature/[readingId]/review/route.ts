import { api } from "@/lib/api/handler";
import { reviewExcursionBody } from "@/lib/validation/transfers";

export const POST = api({ body: reviewExcursionBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("review_temperature_excursion", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_reading_id: params.readingId, p_action: body.action, p_note: body.note }),
);
