import { api } from "@/lib/api/handler";

// Public waiting-room display: ticket numbers and stations only. No names, dates of birth or vaccine details.
// Limited per (clinic, client address): a screen polls 12 times a minute, so 120 allows ten screens of one clinic behind one address,
// and one clinic's screens can never use another clinic's allowance.
export const GET = api({ auth: false, rate: { limit: 120, windowMs: 60_000, keyParams: ["clinicId"] } }, async ({ rpc, params }) =>
  rpc.rpc("public_queue_display", { p_clinic_id: params.clinicId }),
);
