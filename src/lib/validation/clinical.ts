import { z } from "zod";

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const outsideDoseInput = z
  .object({
    productText: z.string().trim().min(1, "Describe the vaccine that was given.").max(200),
    administeredOn: z.iso.date().optional(),
    precision: z.enum(["exact", "month", "year", "unknown"]).optional(),
    provider: optText(200),
    lotText: optText(100),
    reference: optText(200),
  })
  .strict();

/** Guardian report: pending evidence only. */
export const reportOutsideDoseBody = z.object({ dose: outsideDoseInput }).strict();

/** Staff entry: may be verified at once against a document, but only with an approved product and exact date. */
export const staffOutsideDoseBody = z.object({ dose: outsideDoseInput, productId: z.uuid().optional(), verified: z.boolean().default(false) }).strict();

export const verifyEvidenceBody = z
  .object({ decision: z.enum(["verify", "reject"]), productId: z.uuid().optional(), administeredOn: z.iso.date().optional(), note: z.string().trim().max(500).optional() })
  .strict();

export const antigenBody = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/, "Use letters, digits, dot, dash or underscore (max 40)."), name: z.string().trim().min(1).max(200) }).strict();

export const productBody = z
  .object({
    code: z.string().trim().regex(/^[A-Za-z0-9._-]{1,40}$/),
    name: z.string().trim().min(1).max(200),
    manufacturer: optText(200),
    presentation: z.string().trim().min(1).max(200),
    stockUnit: z.string().trim().min(1).max(40),
    dosesPerContainer: z.number().positive().max(1000),
    administrationUnit: z.string().trim().min(1).max(40),
    policyReference: optText(300),
    antigenCodes: z.array(z.string().trim().min(1)).min(1, "Map the product to at least one antigen.").max(20),
  })
  .strict();

export const masterStatusBody = z.object({ kind: z.enum(["antigen", "product"]), id: z.uuid(), status: z.enum(["active", "retired"]) }).strict();

/** The importer's typed vocabulary is validated authoritatively in the database; here we only bound the size. */
export const importScheduleBody = z.object({ payload: z.looseObject({}) }).strict();
export const activateBody = z.object({ effectiveFrom: z.iso.date() }).strict();
export const reasonBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
export const noteBody = z.object({ note: optText(500) }).strict();
export const childNoteBody = z.object({
  category: z.enum(["post_vaccination", "follow_up", "intake", "operational"]),
  note: z.string().trim().min(3, "Write at least 3 characters.").max(1000),
  familyVisible: z.boolean().default(true),
  eventId: z.uuid().optional(),
}).strict();
