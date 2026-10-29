import { z } from "zod";
import { personName } from "@/lib/person-name";

/** The account holder's own name and language (update_my_profile). */
export const profileBody = z
  .object({
    displayName: z.string().trim().min(1, "Enter your full name.").max(120, "Use up to 120 characters.").transform(personName),
    locale: z.enum(["en", "fil"]),
  })
  .strict();
