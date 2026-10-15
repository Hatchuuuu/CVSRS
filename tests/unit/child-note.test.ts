import { describe, expect, it } from "vitest";
import { childNoteBody } from "@/lib/validation/clinical";

describe("staff child note input", () => {
  it.each(["post_vaccination", "follow_up", "intake", "operational"])("accepts %s notes", (category) => {
    expect(childNoteBody.safeParse({ category, note: "This symptom can be expected; contact the clinic if it worsens.", familyVisible: true }).success).toBe(true);
  });
  it("rejects unsupported categories and unbounded notes at the input boundary", () => {
    expect(childNoteBody.safeParse({ category: "diagnosis", note: "x", familyVisible: true }).success).toBe(false);
    expect(childNoteBody.safeParse({ category: "follow_up", note: "x".repeat(1001), familyVisible: true }).success).toBe(false);
  });
});
