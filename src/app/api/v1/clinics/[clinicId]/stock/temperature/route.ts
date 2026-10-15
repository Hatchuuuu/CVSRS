import { api } from "@/lib/api/handler";
import { positiveQueryInt } from "@/lib/api/query";
import { temperatureBody } from "@/lib/validation/transfers";

export const GET = api({}, async ({ rpc, params, query }) => rpc.rpc("list_temperature", { p_clinic_id: params.clinicId, p_days: positiveQueryInt(query.get("days"), 14, 90) }));
export const POST = api({ body: temperatureBody }, async ({ rpc, params, body, opKey }) =>
  rpc.rpc("record_temperature", { p_operation_key: opKey, p_clinic_id: params.clinicId, p_location_id: body.locationId, p_observed_at: body.observedAt, p_min_c: body.minC, p_max_c: body.maxC, p_note: body.note ?? null }),
);
