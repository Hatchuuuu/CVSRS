import { beforeEach, expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ requireViewer: vi.fn() }));
vi.mock("@/lib/server/viewer", () => stubs);
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, useRouter: () => ({ refresh() {} }) }));
beforeEach(() => vi.clearAllMocks());
it.each(["guardian_get_schedule", "guardian_child_history", "guardian_list_sessions", "my_appointments", "guardian_queue_status", "guardian_list_certificates", "guardian_get_catchup_plan", "my_checkins", "my_record_transfers"])("does not pretend missing data when %s fails", async (failed) => {
  const rpc = vi.fn(async (name: string) => {
    if (name === "my_children") return [{ childId: "child", accessScope: "full", clinicId: "clinic" }];
    if (name === failed) throw new Error("read unavailable");
    return null;
  });
  stubs.requireViewer.mockResolvedValue({ rpc: { rpc } });
  const { default: GuardianChild } = await import("@/app/children/[childId]/page");
  await expect(GuardianChild({ params: Promise.resolve({ childId: "child" }) })).rejects.toThrow("read unavailable");
});
