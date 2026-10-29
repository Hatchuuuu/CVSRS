import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const stub = vi.hoisted(() => ({ rows: [] as object[] }));
vi.mock("@/lib/server/developer", () => ({ requireDeveloper: async () => ({ ctx: { profileId: "viewer" }, membership: { clinicTimezone: "Asia/Manila", capabilities: ["admin.users"] }, rpc: { rpc: async () => stub.rows } }) }));
vi.mock("@/app/clinic/[clinicId]/access/staff-forms", () => ({ StaffRowActions: () => null, RequestStaffForm: () => null }));
vi.mock("@/app/clinic/[clinicId]/access/staff-location-form", () => ({ StaffLocationForm: () => null }));
import { StaffMemberships } from "@/components/technical/staff-memberships";
const row = (extra = {}) => ({ membershipId: "one", profileId: "person", displayName: "Synthetic Approver", role: "tech_admin", capabilities: [], status: "active", version: 1, validUntil: null, requestedBy: "other", requiresClinicalApproval: false, barangay: null, cityMunicipality: null, ...extra });
beforeEach(() => { stub.rows = []; });
it("shows expired access as expired rather than active", async () => {
  stub.rows = [row({ validUntil: "2020-01-01" })];
  const html = renderToStaticMarkup(await StaffMemberships({ clinicId: "own", status: "expired" }));
  expect(html).toContain("Synthetic Approver");
  expect(html).toContain("expired");
});
it("warns when an active approval-capable membership expires within seven days", async () => {
  stub.rows = [row({ validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() })];
  const html = renderToStaticMarkup(await StaffMemberships({ clinicId: "own" }));
  expect(html).toContain("Approval-capable access expires within seven days");
  expect(html).toContain("/developer/own/operations/runbook");
});
it("does not issue the approver warning for ordinary clinical staff", async () => {
  stub.rows = [row({ role: "clinical_staff", validUntil: new Date(Date.now() + 3 * 86_400_000).toISOString() })];
  const html = renderToStaticMarkup(await StaffMemberships({ clinicId: "own" }));
  expect(html).not.toContain("Approval-capable access expires within seven days");
});
