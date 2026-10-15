import { api } from "@/lib/api/handler";
import { markReadBody } from "@/lib/validation/certificates";

// Marking as read is naturally idempotent, but the header is still required like every other mutation.
export const POST = api({ body: markReadBody }, async ({ rpc, body }) => rpc.rpc("mark_messages_read", { p_ids: body.ids ?? null }));
