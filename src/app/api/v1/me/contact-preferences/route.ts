import { z } from "zod";
import { api } from "@/lib/api/handler";
import { MOBILE_NUMBER_HINT, toE164 } from "@/lib/sms/provider";

const body = z
  .object({
    language: z.enum(["en", "fil"]).optional(),
    // The number the clinic texts: one SMS could never reach is refused here rather than failing at every send.
    phone: z.string().trim().max(30, "That phone number is too long.").refine((p) => !p || toE164(p) !== null, MOBILE_NUMBER_HINT).optional(),
    smsOptIn: z.boolean().optional(),
  })
  .strict();

export const GET = api({}, async ({ rpc }) => rpc.rpc("get_contact_preferences"));
export const POST = api({ body }, async ({ rpc, body: b, opKey }) =>
  rpc.rpc("set_contact_preferences", { p_operation_key: opKey, p_language: b.language ?? null, p_phone: b.phone ?? null, p_sms_opt_in: b.smsOptIn ?? null }),
);
