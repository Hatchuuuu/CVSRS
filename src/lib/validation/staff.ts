import { z } from "zod";
import { personName } from "@/lib/person-name";
import { PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

/** Roles a person can apply for or be granted (the database's role vocabulary). */
export const STAFF_ROLE_CODES = ["assistant", "clinical_staff", "clinical_lead", "inventory", "bhw", "tech_admin"] as const;

export const CAPABILITY_VOCAB = [
  "child.search", "child.register", "child.read_clinical", "guardian.verify", "appointment.manage", "queue.manage",
  "vaccination.record", "evidence.verify", "correction.approve", "inventory.manage", "inventory.approve", "rules.propose",
  "rules.approve", "certificate.issue", "review.resolve", "admin.users", "admin.config", "grant.approve.clinical",
  "audit.read", "report.run", "export.identifiable", "bhw.followup",
] as const;

export const requestStaffBody = z
  .object({
    email: z.email("Enter a valid email address.").max(200),
    role: z.enum(STAFF_ROLE_CODES),
    capabilities: z.array(z.enum(CAPABILITY_VOCAB)).max(30).default([]),
    validUntil: z.iso.datetime().optional(),
  })
  .strict();

export const approveStaffBody = z.object({ expectedVersion: z.number().int().positive() }).strict();
export const revokeStaffBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();

/** The application a person files for one health center. Free text is optional and bounded; the database re-checks everything. */
export const staffApplicationFields = z
  .object({
    clinicId: z.uuid("Choose your health center."),
    role: z.enum(STAFF_ROLE_CODES, { message: "Choose the role you are applying for." }),
    positionTitle: z.string().trim().max(80, "Keep the job title under 80 characters.").optional(),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  })
  .strict();
export const submitApplicationBody = staffApplicationFields;

export const createStaffAccountBody = z
  .object({
    fullName: z.string().trim().min(1, "Enter the staff member's full name.").max(120).transform(personName),
    email: z.email("Enter a valid email address.").max(200),
    temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`).refine((value) => new TextEncoder().encode(value).length <= PASSWORD_MAX_BYTES, "The password is too long."),
    role: z.enum(STAFF_ROLE_CODES),
    positionTitle: z.string().trim().max(80).optional(),
    barangay: z.string().trim().max(120).optional(),
    cityMunicipality: z.string().trim().max(120).optional(),
  })
  .strict().refine(value => Boolean(value.barangay) === Boolean(value.cityMunicipality), { message: "Enter both barangay and city/municipality, or leave both blank.", path: ["barangay"] });

export const staffLocationBody = z.object({
  expectedVersion: z.number().int().positive(),
  barangay: z.string().trim().max(120),
  cityMunicipality: z.string().trim().max(120),
}).strict().refine(value => Boolean(value.barangay) === Boolean(value.cityMunicipality), { message: "Enter both barangay and city/municipality, or clear both.", path: ["barangay"] });

export const acceptApplicationBody = z
  .object({
    expectedVersion: z.number().int().positive(),
    role: z.enum(STAFF_ROLE_CODES).optional(),
    capabilities: z.array(z.enum(CAPABILITY_VOCAB)).max(30).default([]),
  })
  .strict();
export const rejectApplicationBody = z
  .object({
    expectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(3, "Give the applicant a short reason.").max(500, "Keep the reason under 500 characters."),
  })
  .strict();
