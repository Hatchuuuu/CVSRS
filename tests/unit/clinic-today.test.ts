import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: async () => ({ rpc: { rpc: state.rpc }, membership: { capabilities: ["queue.manage", "appointment.manage"], clinicTimezone: "Asia/Manila", clinicName: "Test Clinic" } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), notFound: () => { throw new Error("not found"); } }));
import Today from "@/app/clinic/[clinicId]/today/page";
beforeEach(() => state.rpc.mockReset());
it.each(["list_sessions", "list_appointments", "list_queue", "service_day_backlog"])("rejects missing %s data instead of reporting an empty clinic day", async failed => {
  state.rpc.mockImplementation(async (name: string) => name === failed ? null : name === "service_day_backlog" ? { open: [], recentlyClosed: [] } : []);
  await expect(Today({ params: Promise.resolve({ clinicId: "c1" }) })).rejects.toThrow("Clinic activity could not be loaded");
});
