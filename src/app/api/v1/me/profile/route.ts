import { api } from "@/lib/api/handler";
import { profileBody } from "@/lib/validation/account";

// The signed-in person's own name and language. Names on verified guardian records stay as the clinic recorded them.
export const POST = api({ body: profileBody, rate: { limit: 10, windowMs: 60_000 } }, async ({ rpc, body }) =>
  rpc.rpc("update_my_profile", { p_display_name: body.displayName, p_locale: body.locale }),
);
