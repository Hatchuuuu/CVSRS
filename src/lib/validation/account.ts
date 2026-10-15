import { z } from "zod";

/** The account holder's own name and language (update_my_profile). */
export const profileBody = z
  .object({
    displayName: z.string().trim().min(1, "Enter your full name.").max(120, "Use up to 120 characters."),
    locale: z.enum(["en", "fil"]),
  })
  .strict();
