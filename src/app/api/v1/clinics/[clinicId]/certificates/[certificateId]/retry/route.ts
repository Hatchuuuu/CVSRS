import { api } from "@/lib/api/handler";
import { renderAndStore } from "@/lib/certificates/service";

export const POST = api({ rate: { limit: 30, windowMs: 60_000 } }, async ({ rpc, req, params, opKey }) => renderAndStore(rpc, req, params.certificateId!, opKey));
