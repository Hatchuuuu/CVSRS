import { expect, it } from "vitest";
import { createStaffAccountBody, staffLocationBody } from "@/lib/validation/staff";
it("accepts a complete work location and intentional clearing", () => {
  expect(staffLocationBody.parse({ expectedVersion: 1, barangay: " Bunao ", cityMunicipality: "Dumaguete City" }).barangay).toBe("Bunao");
  expect(staffLocationBody.safeParse({ expectedVersion: 1, barangay: "", cityMunicipality: "" }).success).toBe(true);
});
it("rejects partial, oversized, unversioned and extra-field updates", () => {
  for (const body of [{ expectedVersion: 1, barangay: "Bunao", cityMunicipality: "" }, { expectedVersion: 1, barangay: "a".repeat(121), cityMunicipality: "City" }, { barangay: "Bunao", cityMunicipality: "City" }, { expectedVersion: 1, barangay: "Bunao", cityMunicipality: "City", role: "tech_admin" }]) expect(staffLocationBody.safeParse(body).success).toBe(false);
});
it("allows optional assignment during account creation but requires both fields together", () => {
  const account={ fullName: "Staff", email: "staff@example.test", temporaryPassword: "Password1234", role: "bhw" };
  expect(createStaffAccountBody.safeParse({...account,barangay:"Bunao",cityMunicipality:"Dumaguete City"}).success).toBe(true);
  expect(createStaffAccountBody.safeParse({...account,barangay:"Bunao"}).success).toBe(false);
});
