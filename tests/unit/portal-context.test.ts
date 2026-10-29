import { describe, expect, it } from "vitest";
import { resolvePortalContext, portalHref } from "@/lib/portal-context";
import type { MembershipLike } from "@/lib/auth/clinic-access";

const member = (clinicId: string, role = "clinical_staff", extra: Partial<MembershipLike> = {}): MembershipLike => ({
  membershipId: `${clinicId}-${role}`, clinicId, clinicName: clinicId, clinicTimezone: "Asia/Manila", role,
  status: "active", validUntil: null, capabilities: role === "tech_admin" ? ["admin.users", "admin.config"] : ["child.read_clinical"], ...extra,
});
const resolve = (path: string, query = "", memberships: MembershipLike[] = []) => resolvePortalContext(path, new URLSearchParams(query), memberships);

describe("portal presentation context", () => {
  it("keeps family routes in Parents even when the person works at a clinic", () => {
    for (const path of ["/children", "/children/register", "/vaccination-records", "/appointments", "/help"]) {
      expect(resolve(path, "portal=developer&clinic=A", [member("A", "tech_admin")])).toEqual({ kind: "parents", clinicId: null });
    }
  });
  it("uses the route clinic instead of the first membership", () => {
    expect(resolve("/clinic/B/today", "", [member("A"), member("B")])).toEqual({ kind: "clinic", clinicId: "B" });
    expect(resolve("/developer/B/staff", "", [member("A", "tech_admin"), member("B", "tech_admin")])).toEqual({ kind: "developer", clinicId: "B" });
  });
  it("never substitutes an admitted clinic for a foreign or expired route", () => {
    expect(resolve("/clinic/foreign/today", "", [member("A")])).toEqual({ kind: "clinic", clinicId: null });
    expect(resolve("/developer/B/staff", "", [member("B", "tech_admin", { validUntil: "2000-01-01T00:00:00Z" })])).toEqual({ kind: "developer", clinicId: null });
    expect(resolve("/developer/A", "", [member("A")])).toEqual({ kind: "developer", clinicId: null });
  });
  it("preserves explicit shared-page context only when admitted", () => {
    const memberships = [member("A"), member("B", "tech_admin")];
    expect(resolve("/messages", "portal=developer&clinic=B", memberships)).toEqual({ kind: "developer", clinicId: "B" });
    expect(resolve("/account", "portal=parents", memberships)).toEqual({ kind: "parents", clinicId: null });
    expect(resolve("/account", "portal=developer&clinic=foreign", memberships)).toEqual({ kind: "clinic", clinicId: "A" });
  });
  it("chooses a stable default and rejects repeated context fields", () => {
    const memberships = [member("B"), member("A")];
    expect(resolve("/messages", "", memberships)).toEqual(resolve("/messages", "", [...memberships].reverse()));
    expect(resolve("/messages", "portal=parents&portal=developer&clinic=B", memberships)).toEqual({ kind: "clinic", clinicId: "A" });
    expect(resolve("/account", "", [member("A", "tech_admin")])).toEqual({ kind: "developer", clinicId: "A" });
    expect(resolve("/account", "", [member("A", "tech_admin", { status: "revoked" })])).toEqual({ kind: "parents", clinicId: null });
  });
  it("builds only the shared internal context link", () => {
    expect(portalHref("/account", { kind: "developer", clinicId: "A" })).toBe("/account?portal=developer&clinic=A");
    expect(portalHref("/messages", { kind: "parents", clinicId: null })).toBe("/messages?portal=parents");
  });
});
