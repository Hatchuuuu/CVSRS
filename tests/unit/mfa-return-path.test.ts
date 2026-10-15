import { describe, expect, it, vi } from "vitest";

const CLINIC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
let capabilities = ["queue.manage"];
vi.mock("@/lib/env", () => ({ getConfig: () => ({ mode: "supabase" }), ConfigError: class extends Error {} }));
vi.mock("@/lib/db", () => ({ getRpcClient: async () => ({ session: async () => ({ userId: "user" }), rpc: async () => ({
  status: "active", mfa: false,
  memberships: [{ clinicId: CLINIC, clinicName: "Clinic", clinicTimezone: "Asia/Manila", status: "active", validUntil: null, capabilities }],
}) }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { requireClinicStaff } from "@/lib/server/viewer";

describe("clinic workspace two-step sign-in prompt (FE-03)", () => {
  it("sends staff to account security with their role's start page as the validated return path", async () => {
    await expect(requireClinicStaff(CLINIC)).rejects.toThrow(`redirect:/account/security?next=%2Fclinic%2F${CLINIC}%2Ftoday`);
  });

  it("returns an administrator to the admin console, not the patient search they cannot use", async () => {
    capabilities = ["admin.users", "admin.config"];
    await expect(requireClinicStaff(CLINIC)).rejects.toThrow(`redirect:/account/security?next=%2Fclinic%2F${CLINIC}%2Fadmin`);
  });
});
