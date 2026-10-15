import { api } from "@/lib/api/handler";

// Public service information (P01): active clinics with non-sensitive fields only.
export const GET = api({ auth: false, rate: { limit: 60, windowMs: 60_000 } }, async ({ rpc }) => rpc.rpc("list_public_clinics"));
