import { beforeEach, expect, it, vi } from "vitest";
import type { Membership } from "@/lib/server/viewer";

const staff = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: staff }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import { requireDeveloper } from "@/lib/server/developer";

const membership = (over: Partial<Membership> = {}): Membership => ({ membershipId: "m", clinicId: "own", clinicName: "Clinic", clinicTimezone: "Asia/Manila", role: "tech_admin", status: "active", validUntil: null, capabilities: ["admin.users"], ...over });
beforeEach(() => { staff.mockReset(); });
it.each([
  [], [membership({ role: "clinical_lead" })], [membership({ status: "revoked" })],
  [membership({ validUntil: "2020-01-01" })], [membership({ clinicId: "foreign" })],
])("denies without active assigned technical membership: %j", async (...memberships) => {
  staff.mockResolvedValue({ ctx: { memberships }, membership: {} });
  await expect(requireDeveloper("own")).rejects.toThrow("NOT_FOUND");
});
it("admits a technical role even when a clinical role comes first", async () => {
  const result = { ctx: { memberships: [membership({ role: "clinical_lead" }), membership()] }, membership: { capabilities: ["admin.users"] } };
  staff.mockResolvedValue(result);
  expect(await requireDeveloper("own")).toBe(result);
});
it("preserves the existing MFA completion redirect", async () => {
  staff.mockRejectedValue(new Error("MFA_REDIRECT"));
  await expect(requireDeveloper("own")).rejects.toThrow("MFA_REDIRECT");
});

