import { describe, expect, it } from "vitest";
import { followupCursor, pageCursor, pageQuery, timestampCursor } from "@/lib/api/list-cursors";

const id = "11111111-1111-4111-8111-111111111111";
describe("worklist paging cursors", () => {
  it("keeps timestamp precision and the id together", () => {
    expect(timestampCursor(new URLSearchParams({ before: "2026-10-07T08:00:00.123456+08:00", beforeId: id }))).toEqual({ at: "2026-10-07T08:00:00.123456+08:00", id });
  });
  it("rejects incomplete, repeated and malformed timestamps", () => {
    for (const q of ["before=2026-10-07T00:00:00Z", `beforeId=${id}`, `before=no&beforeId=${id}`, `before=2026-10-07T00:00:00Z&beforeId=${id}&beforeId=${id}`]) {
      expect(() => timestampCursor(new URLSearchParams(q))).toThrow();
    }
  });
  it("keeps all priority and name tie breakers for follow-up", () => {
    const cursor = { behind: 2, due: 1, name: "Ana Santos", id };
    expect(followupCursor(new URLSearchParams({ after: JSON.stringify(cursor) }))).toEqual(cursor);
    expect(() => followupCursor(new URLSearchParams({ after: JSON.stringify({ ...cursor, due: -1 }) }))).toThrow();
    expect(() => followupCursor(new URLSearchParams({ after: JSON.stringify({ ...cursor, behind: 2147483648 }) }))).toThrow();
    expect(followupCursor(new URLSearchParams())).toBeNull();
  });
  it("ignores the entire malformed page cursor rather than partially advancing", () => {
    const query = pageQuery({ before: "2026-10-07T00:00:00Z", beforeId: [id, id] });
    expect(pageCursor(() => timestampCursor(query))).toBeNull();
    expect(pageCursor(() => timestampCursor(pageQuery({ before: "2026-10-07T00:00:00Z" })))).toBeNull();
  });
});
