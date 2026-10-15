import { z } from "zod";

// Preserve the displayed strings exactly; normalization would accept different wording than the person saw.
export const privacyAcknowledgementBody = z.object({
  version: z.string().min(1).max(50),
  text: z.string().min(50).max(8000),
}).strict();

const note = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);

export const placeHoldBody = z
  .object({ reason: z.string().trim().min(3, "Name the reason (3 to 80 characters).").max(80), restrictedNote: note(500), reviewOn: z.iso.date().optional(), ruleId: z.uuid().optional() })
  .strict();
export const releaseHoldBody = z.object({ note: z.string().trim().min(3, "Say why the hold is released.").max(500) }).strict();
export const attemptBody = z
  .object({ outcome: z.enum(["reached", "no_answer", "wrong_number", "refused", "will_visit", "moved_away", "other"]), note: note(300), nextTryOn: z.iso.date().optional() })
  .strict();
export const privacyNoticeBody = z
  .object({ version: z.string().trim().min(1, "Give the notice a version.").max(50), text: z.string().trim().min(50, "Paste the full notice text (at least 50 characters).").max(8000) })
  .strict();
