import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ usePathname: () => "/clinic/c1/today" }));
import { clinicNavItems } from "@/lib/auth/clinic-navigation";
import { StaffNav } from "@/app/clinic/[clinicId]/staff-nav";

describe("clinic task navigation", () => {
  it.each([
    ["nurse", ["child.search", "child.read_clinical", "vaccination.record"], ["daily", "records", "management"]],
    ["midwife", ["child.search", "child.read_clinical", "vaccination.record"], ["daily", "records", "management"]],
    ["BHW", ["child.search", "bhw.followup"], ["daily"]],
    ["assistant", ["child.search", "queue.manage"], ["daily", "management"]],
    ["inventory clerk", ["inventory.manage"], ["management"]],
    ["clinical lead", ["grant.approve.clinical", "correction.approve"], ["records", "management"]],
  ])("groups permitted tasks for %s", (_role, capabilities, groups) => {
    const items = clinicNavItems("c1", capabilities);
    expect([...new Set(items.map(item => item.group))].sort()).toEqual([...groups].sort());
    expect(items.every(item => item.href.startsWith("/clinic/c1"))).toBe(true);
  });
  it("links technical-only users to the Developer Console", () => {
    const items = clinicNavItems("c1", ["admin.users", "admin.config"], ["tech_admin"]);
    expect(items.some(item => item.href === "/developer/c1")).toBe(true);
    expect(items.some(item => item.href.startsWith("/clinic/"))).toBe(false);
  });
  it("retains clinical approvals and technical workspace access for a multi-role user", () => {
    const items = clinicNavItems("c1", ["admin.users", "admin.config", "child.search", "grant.approve.clinical"], ["tech_admin", "clinical_lead"]);
    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ href: "/clinic/c1/admin", group: "management" }),
      expect.objectContaining({ href: "/clinic/c1/access", group: "management" }),
      expect.objectContaining({ href: "/developer/c1", group: "management" }),
    ]));
  });
  it("renders labelled groups in desktop and mobile lists without empty groups", () => {
    for (const embedded of [true, false]) {
      const html = renderToStaticMarkup(createElement(StaffNav, { items: clinicNavItems("c1", ["child.search", "guardian.verify"]), embedded }));
      expect(html).toContain("Clinic day");
      expect(html).toContain("Records and review");
      expect(html).not.toContain(">Management<");
      expect(html).toContain("Record transfers");
    }
  });
  it("does not infer a technical membership from custom capabilities", () => {
    expect(clinicNavItems("c1", ["admin.users", "admin.config"]).some(item => item.href.startsWith("/developer/"))).toBe(false);
  });
  it("exposes nothing without a capability", () => expect(clinicNavItems("c1", [])).toEqual([]));
});
