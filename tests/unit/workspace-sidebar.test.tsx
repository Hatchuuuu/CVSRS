import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ path: "/children" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceNavLink } from "@/components/workspace-nav-link";

beforeEach(() => { state.path = "/children"; });
it("shows family identity without clinic tools for parents", () => {
  const html = renderToStaticMarkup(<WorkspaceSidebar clinics={[]} unread={0}>Family links</WorkspaceSidebar>);
  expect(html).toContain("Family portal");
  expect(html).not.toContain('aria-label="Clinic Navigation"');
});
it("shows only the active clinic's capability-based tools", () => {
  state.path = "/clinic/b/inventory";
  const html = renderToStaticMarkup(<WorkspaceSidebar clinics={[
    { clinicId: "a", clinicName: "Clinic Alpha", roles: ["tech_admin"], capabilities: ["admin.users"] },
    { clinicId: "b", clinicName: "Clinic Beta", roles: ["inventory"], capabilities: ["inventory.manage"] },
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
