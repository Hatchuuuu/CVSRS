import { describe, expect, it } from "vitest";
import { auditSearchArgs } from "../../src/lib/api/query";

const q = (s: string) => new URLSearchParams(s);
const status = (fn: () => unknown) => { try { fn(); return 0; } catch (e) { return (e as { status?: number }).status; } };

describe("GET /api/v1/clinics/:id/audit query (API-03, RV2-C-04)", () => {
  it("passes valid filters and the keyset cursor through", () => {
    const id = "6f1c1d1e-1111-4222-8333-944445555666";
    expect(auditSearchArgs(q(`action=certificate.&from=2026-10-01T00:00:00Z&to=2026-10-06T15:59:59.999%2B08:00&before=2026-10-05T01:02:03.456789Z&beforeId=${id}&limit=20`))).toEqual({
      p_action: "certificate.", p_actor: null, p_from: "2026-10-01T00:00:00Z", p_to: "2026-10-06T15:59:59.999+08:00",
      p_before: "2026-10-05T01:02:03.456789Z", p_before_id: id, p_limit: 20,
    });
    expect(auditSearchArgs(q(""))).toMatchObject({ p_action: null, p_from: null, p_before: null, p_before_id: null, p_limit: 50 });
  });

  it("answers 422 (not 500) for impossible or malformed dates and ids", () => {
    for (const bad of ["from=2026-02-30T00:00:00Z", "to=yesterday", "before=2026-10-05", "beforeId=not-a-uuid", "actor=1", "beforeId=6f1c1d1e-1111-4222-8333-944445555666"]) {
      expect(status(() => auditSearchArgs(q(bad))), bad).toBe(422);
    }
  });
});

describe("review follow-ups (I4-16 F2/F3)", () => {
  it("refuses instants PostgreSQL cannot store (year 0000, offsets beyond ±15:59) with 422", () => {
    for (const bad of ["from=0000-01-01T00:00:00Z", "to=2026-10-06T15:04:05%2B23:59", "before=2026-10-06T15:04:05-16:00"]) {
      expect(status(() => auditSearchArgs(q(bad))), bad).toBe(422);
    }
    expect(status(() => auditSearchArgs(q("from=2026-10-06T15:04:05.123456%2B15:59")))).toBe(0);
    expect(status(() => auditSearchArgs(q("from=2026-10-06T15:04:05-02:30")))).toBe(0);
  });

  it("maps the PostgreSQL datetime overflow and zone-displacement errors to 422, not 500", async () => {
    const { fromDbError } = await import("../../src/lib/api/errors");
    for (const code of ["22008", "22009"]) {
      const e = fromDbError({ code, message: "date/time field value out of range: \"0000-01-01\"" });
      expect(e.status, code).toBe(422);
      expect(e.message).not.toContain("0000");
    }
  });

  it("the page's cursor check accepts the cursor search_audit returns and nothing impossible", async () => {
    const { isAuditInstant } = await import("../../src/lib/api/query");
    for (const ok of ["2026-10-06T15:04:05.123456+00:00", "2026-10-06T15:04:05+00:00", "2026-10-06T15:04:05.1+08:00", "2026-10-06T15:04:05-02:30"]) expect(isAuditInstant(ok), ok).toBe(true);
    for (const bad of ["2026-02-30T00:00:00Z", "0000-01-01T00:00:00Z", "2026-10-06", "2026-10-06T15:04:05+23:59", undefined, ["2026-10-06T15:04:05Z"]]) expect(isAuditInstant(bad), String(bad)).toBe(false);
  });
});
