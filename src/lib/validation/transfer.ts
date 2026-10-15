import { z } from "zod";

export const requestTransferBody = z.object({ toClinicId: z.uuid("Choose the clinic.") }).strict();
export const initiateTransferBody = z.object({ toClinicId: z.uuid("Choose the clinic."), reason: z.string().trim().max(300).optional().transform((v) => v || undefined) }).strict();
export const declineTransferBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(300) }).strict();
