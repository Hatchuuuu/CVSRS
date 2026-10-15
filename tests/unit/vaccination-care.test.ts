import { expect, it } from "vitest";
import { vaccinationCareBody } from "@/lib/validation/vaccination-care";
import { administrationBody } from "@/lib/validation/administration";

it("accepts explicit staff-authored care details without inventing missing instructions", () => {
  expect(vaccinationCareBody.parse({ medicines: " No medicine given ", aftercare: "Instructions explained at clinic" })).toEqual({ medicines: "No medicine given", aftercare: "Instructions explained at clinic" });
  expect(vaccinationCareBody.parse({})).toEqual({});
});
it("rejects oversized, non-text and unknown clinical fields", () => {
  for (const value of [{ aftercare: "x".repeat(501) }, { medicines: 123 }, { diagnosis: "automatic" }]) expect(vaccinationCareBody.safeParse(value).success).toBe(false);
});
it("keeps existing administration clients compatible while accepting care in the same command", () => {
  const base = { lotId: crypto.randomUUID(), locationId: crypto.randomUUID() };
  expect(administrationBody.safeParse(base).success).toBe(true);
  expect(administrationBody.safeParse({ ...base, care: { warningSigns: "Instructions provided by nurse" } }).success).toBe(true);
});
