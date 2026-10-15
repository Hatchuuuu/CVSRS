import { z } from "zod";

const qty = z.number().positive("Enter a quantity greater than zero.").max(1_000_000);
const note = z.string().trim().max(300).optional().transform((v) => v || undefined);
const temp = z.number("Enter a temperature.").min(-80, "That temperature is not realistic.").max(60, "That temperature is not realistic.");

export const sendTransferBody = z.object({ toClinicId: z.uuid("Choose the receiving clinic."), fromLocationId: z.uuid("Choose where it comes from."), lotId: z.uuid("Choose the lot."), quantity: qty, note }).strict();
export const receiveTransferBody = z.object({ locationId: z.uuid("Choose where to store it."), receivedQuantity: qty, accepted: z.boolean().default(true), note }).strict();
export const cancelTransferBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(300) }).strict();
export const resolveShortfallBody = z.object({ decision: z.enum(["write_off", "return"]), note: z.string().trim().min(3, "Give a short note.").max(300), returnLocationId: z.uuid().optional() }).strict();
export const limitsBody = z.object({ minC: temp, maxC: temp, policyReference: z.string().trim().min(3, "Name the policy these limits come from.").max(200) }).strict();
export const temperatureBody = z.object({ locationId: z.uuid("Choose the fridge or store."), observedAt: z.iso.datetime({ offset: true }), minC: temp, maxC: temp, note }).strict();
export const reviewExcursionBody = z.object({ action: z.enum(["no_action", "lots_quarantined", "stock_discarded", "other"]), note: z.string().trim().min(3, "Say what was done and why.").max(300) }).strict();
