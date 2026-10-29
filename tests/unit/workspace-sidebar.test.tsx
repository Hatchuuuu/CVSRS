import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ path: "/children" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path, useSearchParams: () => new URLSearchParams() }));
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceNavLink } from "@/components/workspace-nav-link";

beforeEach(() => { state.path = "/children"; });
it("shows family identity without clinic tools for parents", () => {
  const html = renderToStaticMarkup(<WorkspaceSidebar clinics={[]} unread={0}>Family links</WorkspaceSidebar>);
  expect(html).toContain("Parents Portal");
  expect(html).not.toContain('aria-label="Clinic Navigation"');
});
it("shows only the active clinic's capability-based tools", () => {
  state.path = "/clinic/b/inventory";
  const html = renderToStaticMarkup(<WorkspaceSidebar clinics={[
    { clinicId: "a", clinicName: "Clinic Alpha", roles: ["tech_admin"], capabilities: ["admin.users"] },
    { clinicId: "b", clinicName: "Clinic Beta", roles: ["inventory"], capabilities: ["inventory.manage"] },
  ]} memberships={[
    { membershipId: "ma", clinicId: "a", clinicName: "Clinic Alpha", clinicTimezone: "Asia/Manila", role: "tech_admin", status: "active", validUntil: null, capabilities: ["admin.users"] },
    { membershipId: "mb", clinicId: "b", clinicName: "Clinic Beta", clinicTimezone: "Asia/Manila", role: "inventory", status: "active", validUntil: null, capabilities: ["inventory.manage"] },
  ]} unread={0}>Account links</WorkspaceSidebar>);
  expect(html).toContain("Clinic Beta");
  expect(html).toContain("Switch clinic");
  expect(html).toContain("Vaccine stock");
  expect(html).not.toContain("Admin console");
  expect(html).not.toContain("Clinic Alpha");
});
it("highlights the current family section on child pages", () => {
  state.path = "/children/child-id";
  const html = renderToStaticMarkup(<WorkspaceNavLink href="/children">My Children</WorkspaceNavLink>);
  expect(html).toContain('aria-current="page"');
});
it("does not highlight an unrelated section", () => {
  expect(renderToStaticMarkup(<WorkspaceNavLink href="/account">Account</WorkspaceNavLink>)).not.toContain("aria-current");
});
it("offers a single developer switch per desktop and mobile navigation for multi-role workers", () => {
  state.path = "/clinic/a/today";
  const memberships = ["tech_admin", "clinical_staff"].map(role => ({ membershipId: role, clinicId: "a", clinicName: "Clinic", clinicTimezone: "Asia/Manila", role, status: "active", validUntil: null, capabilities: role === "tech_admin" ? ["admin.users", "admin.config"] : ["queue.manage"] }));
  const html = renderToStaticMarkup(<WorkspaceSidebar clinics={[{ clinicId: "a", clinicName: "Clinic", roles: ["tech_admin", "clinical_staff"], capabilities: ["admin.users", "admin.config", "queue.manage"] }]} memberships={memberships} unread={0}>Legacy</WorkspaceSidebar>);
  expect(html.match(/href="\/developer\/a"/g)).toHaveLength(2);
});
