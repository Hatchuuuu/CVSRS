import { describe, expect, it } from "vitest";
import { childInput, createProvisionalBody, linkRequestBody, staffRegisterBody, updateChildBody } from "@/lib/validation/schemas";

const uuid = "9b2f1d0e-6f3a-4c1b-8d5e-2a7c4e9f1b3d";

describe("child input validation", () => {
  it("accepts unusual real-world names and unknown birth dates", () => {
    expect(childInput.safeParse({ displayName: "Nguyễn Đặng-de la Cruz Jr." }).success).toBe(true);
    expect(childInput.safeParse({ givenNames: "Bo" }).success).toBe(true); // mononym-ish, no family name
  });
  it("requires some name", () => {
    expect(childInput.safeParse({}).success).toBe(false);
    expect(childInput.safeParse({ displayName: "   " }).success).toBe(false);
  });
  it("requires a date when precision is exact and a valid range when estimated", () => {
    expect(childInput.safeParse({ displayName: "A", dobPrecision: "exact" }).success).toBe(false);
    expect(childInput.safeParse({ displayName: "A", dobPrecision: "estimated" }).success).toBe(false);
    expect(childInput.safeParse({ displayName: "A", dobPrecision: "estimated", estimatedBirthStart: "2025-03-02", estimatedBirthEnd: "2025-03-01" }).success).toBe(false);
    expect(childInput.safeParse({ displayName: "A", dobPrecision: "estimated", estimatedBirthStart: "2025-03-01", estimatedBirthEnd: "2025-03-02" }).success).toBe(true);
  });
  it("rejects invalid dates and unknown fields (no mass assignment of status/ids)", () => {
    expect(childInput.safeParse({ displayName: "A", dob: "2025-02-30" }).success).toBe(false);
    expect(childInput.safeParse({ displayName: "A", recordStatus: "active" }).success).toBe(false);
    expect(childInput.safeParse({ displayName: "A", organization_id: uuid }).success).toBe(false);
  });
});

describe("request bodies are strict", () => {
  it("cannot smuggle server-owned fields into commands", () => {
    expect(createProvisionalBody.safeParse({ clinicId: uuid, child: { displayName: "A" }, role: "clinical_lead" }).success).toBe(false);
    expect(staffRegisterBody.safeParse({ child: { displayName: "A" }, status: "active" }).success).toBe(false);
  });
  it("update requires a version and only whitelisted patch fields", () => {
    expect(updateChildBody.safeParse({ patch: { displayName: "B" } }).success).toBe(false);
    expect(updateChildBody.safeParse({ expectedVersion: 1, patch: { displayName: "B" } }).success).toBe(true);
    expect(updateChildBody.safeParse({ expectedVersion: 1, patch: { record_status: "merged" } }).success).toBe(false);
  });
  it("link requests never carry a child id", () => {
    expect(linkRequestBody.safeParse({ clinicId: uuid, childName: "X", childId: uuid }).success).toBe(false);
    expect(linkRequestBody.safeParse({ clinicId: uuid, childName: "X" }).success).toBe(true);
  });
});
