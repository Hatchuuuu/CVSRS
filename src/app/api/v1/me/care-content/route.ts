import { api } from "@/lib/api/handler";

export const GET = api({}, async ({ rpc }) => rpc.rpc("guardian_care_content"));
