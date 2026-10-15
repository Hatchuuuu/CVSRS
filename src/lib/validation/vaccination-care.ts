import { z } from "zod";

export const VACCINATION_CARE_FIELDS = [
  { key: "medicines", label: "Medicine given or advised", hint: "Record the name, dose, how often and for how long, if applicable. If none, say so. Enter only instructions provided by an authorized clinician." },
  { key: "expectedEffects", label: "Side effects discussed", hint: "Record the possible side effects you explained for this vaccine." },
  { key: "observations", label: "Reactions or symptoms observed", hint: "Distinguish symptoms observed at the clinic from symptoms reported by the family." },
  { key: "aftercare", label: "Home care instructions", hint: "Record the care instructions you gave the family." },
  { key: "warningSigns", label: "When to seek medical help", hint: "Record the warning signs and where the family should seek help, as explained by clinical staff." },
  { key: "followUp", label: "Follow-up instructions", hint: "Record any planned review or return instructions. Use the appointment tools to book a visit." },
] as const;
export type VaccinationCareDraft = Partial<Record<typeof VACCINATION_CARE_FIELDS[number]["key"], string>>;
const text = z.string().trim().max(500).optional();
export const vaccinationCareBody = z.object({ medicines: text, expectedEffects: text, observations: text, aftercare: text, warningSigns: text, followUp: text }).strict();
