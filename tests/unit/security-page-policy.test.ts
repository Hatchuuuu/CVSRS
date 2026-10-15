import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mfa: true }));
vi.mock("@/lib/server/viewer", () => ({ requireViewer: async () => ({ ctx: state }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
vi.mock("@/app/account/security/mfa-panel", () => ({ MfaPanel: () => null }));
import AccountSecurity from "@/app/account/security/page";

beforeEach(() => { state.mfa = true; });
it("returns to the clinic when its sign-in policy is already satisfied", async () => {
  const next = "/clinic/97952f15-6575-42ab-b3c1-00581b2aca02/admin";
  await expect(AccountSecurity({ searchParams: Promise.resolve({ next }) })).rejects.toThrow(`redirect:${next}`);
});
it("returns to Account rather than an external destination", async () => {
  await expect(AccountSecurity({ searchParams: Promise.resolve({ next: "https://example.com" }) })).rejects.toThrow("redirect:/account");
});
it("retains the security panel when the deployment still requires verification", async () => {
  state.mfa = false;
  expect(await AccountSecurity({ searchParams: Promise.resolve({}) })).toBeTruthy();
});
