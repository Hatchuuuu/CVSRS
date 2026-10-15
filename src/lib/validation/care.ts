import { z } from "zod";

const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

export const planItem = z
  .object({
    label: z.string().trim().min(1, "Describe the planned item.").max(200),
    productId: z.uuid().optional(),
    targetDate: z.iso.date().optional(),
    note: optText(300),
  })
  .strict();

export const saveCatchupBody = z
  .object({
    planId: z.uuid().optional(),
    rationale: z.string().trim().min(10, "Explain why this plan is needed (at least a sentence).").max(1000),
    policyReference: z.string().trim().min(3, "Name the clinical policy or advice this plan follows.").max(300),
    items: z.array(planItem).min(1, "Add at least one planned item.").max(30),
  })
  .strict();
export const reviewCatchupBody = z.object({ decision: z.enum(["approve", "reject"]), note: optText(300) }).strict();
export const reasonBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(300) }).strict();
export const itemStatusBody = z.object({ status: z.enum(["done", "dropped"]), note: z.string().trim().min(3, "Add a short note.").max(300) }).strict();

export const checkinPolicyBody = z.object({ enabled: z.boolean(), safetyNotice: z.string().trim().max(600).optional().transform((v) => v || undefined) }).strict();
export const createCheckinBody = z.object({ category: z.enum(["question", "after_vaccination", "other"]), message: z.string().trim().min(3, "Write your question.").max(1000) }).strict();
export const answerCheckinBody = z.object({ answer: z.string().trim().min(1, "Write a reply.").max(500, "Keep the reply under 500 characters.") }).strict();
