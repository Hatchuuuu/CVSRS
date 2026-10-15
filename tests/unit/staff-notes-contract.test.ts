import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("staff child notes database contract", () => {
  it("keeps notes clinic-scoped, role-authorized, audited and family-filtered", () => {
    const sql = readFileSync("supabase/migrations/0050_staff_child_notes.sql", "utf8");
    expect(sql).toContain("private.require_capability");
    expect(sql).toContain("bhw.followup");
    expect(sql).toContain("vaccination.record");
    expect(sql).toContain("family_visible");
    expect(sql).toContain("private.audit");
    expect(sql).toContain("guardian_can_read_child");
  });
});
