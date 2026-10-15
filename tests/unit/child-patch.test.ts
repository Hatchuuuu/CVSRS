import { describe, expect, it } from "vitest";
import { requestEditBody, updateChildBody } from "@/lib/validation/schemas";

describe("optional identity edits", () => {
  it("keeps omission distinct from an explicit clear", () => {
    const omitted = requestEditBody.parse({ patch: {}, reason: "No change" });
    expect(Object.hasOwn(omitted.patch, "addressText")).toBe(false);
    const clear = updateChildBody.parse({ expectedVersion: 1, patch: { addressText: null, dob: null, dobPrecision: "unknown" } });
    expect(clear.patch).toMatchObject({ addressText: null, dob: null, dobPrecision: "unknown" });
  });

  it("rejects null for required identity fields", () => {
    expect(updateChildBody.safeParse({ expectedVersion: 1, patch: { displayName: null } }).success).toBe(false);
  });
});
