import { z } from "zod";

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

export const profileBody = z
  .object({ name: z.string().trim().min(1, "Enter the clinic name.").max(120), address: opt(300), contact: opt(300), hours: opt(500), timezone: z.string().trim().min(3, "Choose a time zone.").max(60) })
  .strict();
export const contentBody = z
  .object({
    versionId: z.uuid().optional(),
    code: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,58}$/, "Use lowercase letters, numbers and dashes.").optional(),
    language: z.enum(["en", "fil"]),
    title: z.string().trim().min(3, "Write a title.").max(150),
    body: z.string().trim().min(20, "Write the full text (at least 20 characters).").max(4000),
    source: z.string().trim().min(3, "Say where this comes from.").max(300),
  })
  .strict();
export const contentReviewBody = z.object({ decision: z.enum(["approve", "reject"]), note: opt(300) }).strict();
export const reasonOnly = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(300) }).strict();
export const opsCheckBody = z
  .object({ kind: z.enum(["restore_drill", "database_backup", "file_backup"]), result: z.enum(["passed", "failed"]), performedOn: z.iso.date("Choose the date."), evidence: z.string().trim().min(5, "Say where the evidence is.").max(300) })
  .strict();
