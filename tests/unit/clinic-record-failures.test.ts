import { describe, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ requireClinicStaff: vi.fn() }));
vi.mock("@/lib/server/viewer", () => stubs);
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, useRouter: () => ({ refresh: vi.fn() }) }));
import ChildPage from "@/app/clinic/[clinicId]/children/[childId]/page";
const caps = ["child.search", "child.read_clinical", "evidence.verify", "vaccination.record", "guardian.verify", "certificate.issue"];
const child = { childId: "child", displayName: "Fictional Child", localRecordNo: "TEST", dobPrecision: "unknown", sex: "not_recorded", guardians: [] };
const names = ["evaluate_child", "list_child_history", "list_active_products", "get_open_encounter", "list_stock", "list_child_guardian_contacts", "list_catchup_plans", "list_clinical_holds", "list_record_transfers", "list_child_certificates"];
function result(name: string) {
  if (name === "staff_get_child") return child;
  if (name === "evaluate_child") return { status: "no_active_schedule" };
  if (name === "get_open_encounter") return null;
  if (name === "list_stock") return { locations: [], lots: [] };
  if (name === "list_record_transfers") return { clinics: [] };
  return [];
}
describe("clinical record read failures", () => {
  it.each(names)("does not display success or permit care after %s fails", async (failed) => {
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: caps }, ctx: { profileId: "staff" }, rpc: { rpc: (name: string) => name === failed ? Promise.reject(new Error(`${failed} unavailable`)) : Promise.resolve(result(name)) } });
    await expect(ChildPage({ params: Promise.resolve({ clinicId: "clinic", childId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) })).rejects.toThrow(`${failed} unavailable`);
  });
  it("rejects a missing hold list rather than presenting no active holds", async () => {
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: caps }, ctx: { profileId: "staff" }, rpc: { rpc: (name: string) => Promise.resolve(name === "list_clinical_holds" ? null : result(name)) } });
    await expect(ChildPage({ params: Promise.resolve({ clinicId: "clinic", childId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) })).rejects.toThrow("list_clinical_holds");
  });
});
