import { z } from "zod";

const qty = z.number().positive("Enter a quantity greater than zero.").max(1_000_000);

export const locationBody = z.object({ name: z.string().trim().min(1).max(80), kind: z.enum(["usable", "quarantine", "in_transit"]) }).strict();

export const lotBody = z
  .object({
    productId: z.uuid(),
    manufacturerLot: z.string().trim().min(1, "Enter the lot number printed on the box.").max(60),
    expiresOn: z.iso.date("Enter the expiry date."),
    manufacturer: z.string().trim().max(200).optional().transform((v) => v || undefined),
  })
  .strict();

export const receiptBody = z
  .object({ locationId: z.uuid(), lotId: z.uuid(), quantity: qty, deliveryReference: z.string().trim().min(1, "Enter the delivery reference.").max(120), accepted: z.boolean().default(true) })
  .strict();

export const WASTAGE_REASONS = ["expired", "damaged", "spoiled", "breakage", "open_vial_discard", "temperature_excursion", "other"] as const;
export const wastageBody = z
  .object({ locationId: z.uuid(), lotId: z.uuid(), quantity: qty, reason: z.enum(WASTAGE_REASONS), incidentReference: z.string().trim().max(120).optional().transform((v) => v || undefined) })
  .strict();

export const adjustmentBody = z
  .object({
    locationId: z.uuid(),
    lotId: z.uuid(),
    observed: z.number().min(0, "The counted quantity cannot be negative.").max(1_000_000),
    countReference: z.string().trim().min(1, "Enter the count sheet reference.").max(120),
    reason: z.string().trim().min(3, "Explain the difference.").max(500),
  })
  .strict();

export const dispositionBody = z.object({ disposition: z.enum(["quarantined", "recalled", "usable"]), reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
export const reconcileBody = z.object({ repair: z.boolean().default(false) }).strict();
