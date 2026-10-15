import { describe, expect, it } from "vitest";
import { z } from "zod";
import "@/lib/validation/messages";

const messages = (schema: z.ZodType, input: unknown) => Object.fromEntries((schema.safeParse(input).error?.issues ?? []).map((i) => [i.path.join("."), i.message]));

describe("plain-language validation defaults", () => {
  it("replaces technical defaults with actionable text", () => {
    const schema = z.object({ name: z.string().min(3), id: z.uuid(), on: z.iso.date(), at: z.iso.datetime({ offset: true }), kind: z.enum(["a", "b"]), count: z.number().int().max(10), missing: z.string() }).strict();
    expect(messages(schema, { name: "x", id: "nope", on: "2024-13-40", at: "later", kind: "c", count: 11, extra: 1 })).toEqual({
      name: "Enter at least 3 characters.",
      id: "Choose an option from the list.",
      on: "Enter a valid date.",
      at: "Enter a valid date and time.",
      kind: "Choose one of the listed options.",
      count: "Enter 10 or less.",
      missing: "This is required.",
      "": "The request contained fields this form does not use.",
    });
  });

  it("never overrides a message written on the schema", () => {
    expect(messages(z.object({ lotId: z.uuid("Choose the lot used.") }), { lotId: "x" })).toEqual({ lotId: "Choose the lot used." });
  });
});
