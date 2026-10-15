import { api } from "@/lib/api/handler";
import { verifyTokenParam } from "@/lib/validation/certificates";

// Public, unauthenticated and rate limited. Malformed, unknown and unissued tokens are indistinguishable (404).
export const GET = api({ auth: false, rate: { limit: 30, windowMs: 60_000, onStoreFailure: "closed" } }, async ({ rpc, params }) => {
  if (!verifyTokenParam.safeParse(params.token).success) return null;
  return rpc.rpc("verify_certificate", { p_token: params.token });
});
