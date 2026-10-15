import { z } from "zod";

// Shared by API routes and client forms. The database re-validates everything: these give early, friendly errors.

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const relationshipEnum = z.enum(["mother", "father", "grandparent", "aunt_uncle", "sibling", "legal_guardian", "other"]);
export const verificationMethodEnum = z.enum(["in_person_id", "clinic_record", "invitation", "court_document", "other"]);

const childFields = z
  .object({
    displayName: optText(200),
    givenNames: optText(120),
    familyName: optText(120),
    dobPrecision: z.enum(["exact", "estimated", "unknown"]).optional(),
    dob: z.iso.date().optional(),
    estimatedBirthStart: z.iso.date().optional(),
    estimatedBirthEnd: z.iso.date().optional(),
    sex: z.enum(["female", "male", "not_recorded"]).optional(),
    barangayId: z.uuid().optional(),
    addressText: optText(500),
  })
  .strict();

// Patch null explicitly clears an optional field; an omitted property leaves it unchanged.
// Registration still uses childFields and does not accept null values.
const childPatchFields = childFields.extend({
  givenNames: optText(120).nullable(),
  familyName: optText(120).nullable(),
  dob: z.iso.date().nullable().optional(),
  estimatedBirthStart: z.iso.date().nullable().optional(),
  estimatedBirthEnd: z.iso.date().nullable().optional(),
  sex: z.enum(["female", "male", "not_recorded"]).nullable().optional(),
  barangayId: z.uuid().nullable().optional(),
  addressText: optText(500).nullable(),
}).strict();

export const childInput = childFields
  .refine((c) => c.displayName || c.givenNames || c.familyName, { message: "Enter the child's name.", path: ["displayName"] })
  .refine((c) => (c.dobPrecision ?? (c.dob ? "exact" : "unknown")) !== "exact" || !!c.dob, { message: "Enter the date of birth, or choose “estimated” or “unknown”.", path: ["dob"] })
  .refine((c) => c.dobPrecision !== "estimated" || (c.estimatedBirthStart && c.estimatedBirthEnd && c.estimatedBirthStart <= c.estimatedBirthEnd), {
    message: "Give an estimated birth range (earliest and latest date).",
    path: ["estimatedBirthStart"],
  });
export type ChildInput = z.infer<typeof childInput>;

export const createProvisionalBody = z.object({ clinicId: z.uuid(), child: childInput, relationship: relationshipEnum.default("mother") }).strict();

export const linkRequestBody = z
  .object({
    clinicId: z.uuid(),
    childName: z.string().trim().min(1, "Enter the child's name.").max(200),
    dob: z.iso.date().optional(),
    relationship: relationshipEnum.default("other"),
    note: optText(500),
  })
  .strict();

export const staffRegisterBody = z
  .object({
    child: childInput,
    guardian: z
      .object({ fullName: z.string().trim().min(1).max(200), relationship: relationshipEnum.optional(), phone: optText(40), email: optText(200), verifiedInPerson: z.boolean().optional() })
      .strict()
      .optional(),
    confirmedDistinct: z.boolean().default(false),
    identityConfirmed: z.boolean().default(false),
  })
  .strict();

export const updateChildBody = z
  .object({ expectedVersion: z.number().int().positive(), patch: childPatchFields, reason: z.string().trim().max(500).optional() })
  .strict();

export const confirmIdentityBody = z.object({ expectedVersion: z.number().int().positive(), note: optText(500) }).strict();
export const resolveQrBody = z.object({ token: z.string().min(8).max(200) }).strict();
export const resolveLinkBody = z
  .object({ decision: z.enum(["approve", "reject"]), childId: z.uuid().optional(), method: verificationMethodEnum.default("in_person_id"), reason: z.string().trim().max(500).optional() })
  .strict();
export const resolveCaseBody = z.object({ outcome: z.enum(["not_duplicate", "rejected", "no_action"]), reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
export const mergeBody = z.object({ survivorId: z.uuid(), duplicateId: z.uuid(), reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
export const relationshipStatusBody = z.object({ status: z.enum(["suspended", "revoked", "active"]), reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
export const verifyRelationshipBody = z.object({ method: verificationMethodEnum }).strict();
export const requestEditBody = z.object({ patch: childPatchFields, reason: z.string().trim().max(500).optional() }).strict();

/** Mark a child's record inactive (moved, deceased, other) or active again (0037). */
export const childRecordStatusBody = z
  .object({
    status: z.enum(["inactive", "active"]),
    reason: z.enum(["moved", "deceased", "other"]).optional(),
    note: z.string().trim().max(300).optional().transform((v) => (v ? v : undefined)),
  })
  .strict()
  .refine((b) => b.status === "active" || b.reason !== undefined, { message: "Choose why the record is inactive.", path: ["reason"] })
  .refine((b) => b.reason !== "other" || (b.note?.length ?? 0) >= 3, { message: "Describe the reason.", path: ["note"] });

/** A phone number that does not reach the guardian (0037). */
export const contactInvalidBody = z.object({ note: z.string().trim().min(3, "Say what happened when you called.").max(300) }).strict();
