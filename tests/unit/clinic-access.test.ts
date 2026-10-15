import { describe, expect, it } from "vitest";
import { activeClinicAccess, clinicAccessFor, type MembershipLike } from "@/lib/auth/clinic-access";

const m = (id: string, clinicId: string, role: string, capabilities: string[], over: Partial<MembershipLike> = {}): MembershipLike => ({
  membershipId: id, clinicId, clinicName: `Clinic ${clinicId}`, clinicTimezone: "Asia/Manila", role, status: "active", validUntil: null, capabilities, ...over,
});

describe("clinic access merges every active role held at a clinic (audit F09)", () => {
  const now = Date.UTC(2026, 9, 4);
  const list = [
    m("1", "A", "assistant", ["child.search", "queue.manage"]),
    m("2", "A", "inventory", ["inventory.manage"]),
    m("3", "B", "bhw", ["bhw.followup"]),
    m("4", "A", "clinical_staff", ["vaccination.record"], { status: "pending_approval" }),
    m("5", "C", "assistant", ["child.search"], { validUntil: "2026-01-01T00:00:00Z" }),
  ];

  it("gives one entry per clinic with the union of capabilities", () => {
    const access = activeClinicAccess(list, now);
    expect(access.map((a) => a.clinicId)).toEqual(["A", "B"]);
    expect(access[0]!.roles).toEqual(["assistant", "inventory"]);
    expect(access[0]!.capabilities.sort()).toEqual(["child.search", "inventory.manage", "queue.manage"]);
    expect(access[0]!.memberships.map((x) => x.membershipId)).toEqual(["1", "2"]);
  });

  it("ignores pending and expired memberships", () => {
    expect(clinicAccessFor(list, "A", now)!.capabilities).not.toContain("vaccination.record");
    expect(clinicAccessFor(list, "C", now)).toBeNull();
  });
});
