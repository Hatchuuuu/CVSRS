import { describe, expect, it } from "vitest";
import { createStaffAccountBody } from "@/lib/validation/staff";

describe("administrator-created staff account input", () => {
  it.each(["clinical_staff", "assistant", "bhw", "inventory", "clinical_lead", "tech_admin"])("accepts configured role %s", (role) => {
    expect(createStaffAccountBody.safeParse({ fullName: "Local Staff", email: `${role}@example.test`, temporaryPassword: "Password1234", role, positionTitle: role === "clinical_staff" ? "Midwife" : undefined }).success).toBe(true);
  });

  it("rejects weak passwords and unknown roles", () => {
    expect(createStaffAccountBody.safeParse({ fullName: "Staff", email: "staff@example.test", temporaryPassword: "short", role: "nurse" }).success).toBe(false);
  });
});
