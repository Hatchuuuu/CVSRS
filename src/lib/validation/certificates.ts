import { z } from "zod";

export const issueCertificateBody = z.object({ replacesId: z.uuid().optional() }).strict();
export const revokeCertificateBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(300) }).strict();
export const markReadBody = z.object({ ids: z.array(z.uuid()).max(100).optional() }).strict();
export const verifyTokenParam = z.string().regex(/^[0-9a-f]{64}$/);
