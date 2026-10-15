import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ ctx: {} as Record<string, unknown> }));
vi.mock("@/lib/env", () => ({ getConfig: () => ({ mode: "supabase" }), ConfigError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ getRpcClient: async () => ({ session: async () => ({ userId: "user" }), rpc: async () => state.ctx }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { getViewer, requireClinicStaff } from "@/lib/server/viewer";

const activeMembership = { clinicId: "clinic", clinicName: "Clinic", clinicTimezone: "Asia/Manila", status: "active", validUntil: null, capabilities: ["queue.manage"] };

describe("server viewer access", () => {
  it("treats an inactive profile as unavailable even when Auth still has a valid session", async () => {
    state.ctx = { status: "suspended", memberships: [] };
    expect((await getViewer()).ctx).toBeNull();
  });
  it("does not admit a clinic membership past its validity time", async () => {
    state.ctx = { status: "active", mfa: true, memberships: [{ clinicId: "clinic", status: "active", validUntil: "2000-01-01T00:00:00Z" }] };
    await expect(requireClinicStaff("clinic")).rejects.toThrow("redirect:/clinic");
  });
  it("sends staff who have not finished two-step sign-in to account security instead of a failing clinic page", async () => {
    state.ctx = { status: "active", mfa: false, memberships: [activeMembership] };
    await expect(requireClinicStaff("clinic")).rejects.toThrow("redirect:/account/security");
  });
  it("still sends a non-member to the clinic chooser before asking for two-step sign-in", async () => {
    state.ctx = { status: "active", mfa: false, memberships: [] };
    await expect(requireClinicStaff("clinic")).rejects.toThrow("redirect:/clinic");
  });
  it("admits an active member once two-step sign-in is satisfied (the local demo reports mfa: true)", async () => {
    state.ctx = { status: "active", mfa: true, memberships: [activeMembership] };
    const v = await requireClinicStaff("clinic");
    expect(v.membership.clinicId).toBe("clinic");
  });
});
