import { api } from "@/lib/api/handler";
import { bookBody } from "@/lib/validation/visits";

export const GET = api({}, async ({ rpc }) => rpc.rpc("my_appointments"));

// Reserves capacity atomically. A booking is NOT clinical clearance (BP17): eligibility is re-checked by clinic staff on the day.
export const POST = api({ body: bookBody, rate: { limit: 20, windowMs: 60_000 } }, async ({ rpc, body, opKey }) =>
  rpc.rpc("book_appointment", { p_operation_key: opKey, p_child_id: body.childId, p_session_id: body.sessionId, p_reason: body.reason ?? null, p_rule_codes: body.ruleCodes }),
);
