import { z } from "zod";
import { outsideDoseInput } from "./clinical";
export const cardRow = outsideDoseInput.extend({ doseLabel: z.string().trim().max(40).optional(), notes: z.string().trim().max(500).optional(), source: z.enum(["manual", "ocr"]), confidence: z.number().min(0).max(100).optional() });
export const cardBody = z.object({ rows: z.array(cardRow).min(1).max(20), confirmed: z.literal(true), submissionId: z.uuid().optional(), expectedVersion: z.number().int().positive().optional() }).strict();
export const cardReviewBody = z.object({ decision: z.enum(["approved", "rejected", "changes_requested"]), note: z.string().trim().min(3).max(500), expectedVersion: z.number().int().positive(), rows: z.array(outsideDoseInput.extend({ productId: z.uuid() })).max(20).default([]) }).strict();
