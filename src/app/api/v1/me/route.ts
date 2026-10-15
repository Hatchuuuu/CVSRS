import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc }) => rpc.rpc("get_my_context"));
