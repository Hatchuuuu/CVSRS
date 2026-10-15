import { z } from "zod";
import { vaccinationCareBody } from "./vaccination-care";

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const administrationBody = z
  .object({
    lotId: z.uuid("Choose the lot used."),
    locationId: z.uuid("Choose where the vaccine was taken from."),
    productId: z.uuid().optional(),
    administeredAt: z.iso.datetime({ offset: true }).optional(),
    route: optText(40),
    site: optText(40),
    assessmentReference: optText(200),
    consentReference: optText(200),
    confirmRepeat: z.boolean().optional(),
    care: vaccinationCareBody.optional(),
  })
  .strict();

export const exceptionBody = z
  .object({
    encounterId: z.uuid().optional(),
    reason: z.string().trim().min(3, "Explain why this could not be recorded normally.").max(500),
    dose: z
      .object({
        administeredAt: z.iso.datetime({ offset: true }),
        productId: z.uuid().optional(),
        productText: optText(200),
        lotId: z.uuid().optional(),
        lotText: optText(100),
        locationId: z.uuid().optional(),
        route: optText(40),
        site: optText(40),
      })
      .strict(),
  })
  .strict();

export const exceptionDecisionBody = z.object({ decision: z.enum(["accept", "reject"]), note: z.string().trim().min(3, "Give a short note.").max(500) }).strict();

export const correctionBody = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("correct_details"), reason: z.string().trim().min(3).max(500), proposal: z.object({ administeredAt: z.iso.datetime({ offset: true }).optional(), route: optText(40), site: optText(40), lotId: z.uuid().optional(), locationId: z.uuid().optional() }).strict() }).strict(),
    z.object({ kind: z.literal("reattribute_child"), reason: z.string().trim().min(3).max(500), proposal: z.object({ toChildId: z.uuid("Choose the correct child.") }).strict() }).strict(),
    z.object({ kind: z.literal("void_duplicate"), reason: z.string().trim().min(3).max(500), proposal: z.object({ stockEffect: z.enum(["return_to_stock", "wastage", "none"]) }).strict() }).strict(),
  ]);

export const approveCorrectionBody = z.object({ note: optText(500) }).strict();
export const rejectCorrectionBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
