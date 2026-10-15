import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRpcClient: async () => ({ session: async () => ({ userId: "11111111-1111-4111-8111-111111111111" }), rpc: state.rpc }) }));
vi.mock("@/lib/env", async (original) => ({ ...(await original<typeof import("@/lib/env")>()), getConfig: () => ({ supabaseUrl: "http://127.0.0.1:54321", supabaseKey: "public-test-key" }) }));
import { POST } from "@/app/api/v1/clinics/[clinicId]/staff-accounts/route";
import { resetRateLimits } from "@/lib/security/rate-limit";
const clinic = "22222222-2222-4222-8222-222222222222";
const context = { params: Promise.resolve({ clinicId: clinic }) };
function request() { return new Request(`http://localhost:3000/api/v1/clinics/${clinic}/staff-accounts`, { method: "POST", headers: { origin: "http://localhost:3000", "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ fullName: "Test Nurse", email: "nurse@example.test", temporaryPassword: "Password1234", role: "clinical_staff" }) }); }
beforeEach(() => { vi.clearAllMocks(); resetRateLimits(); vi.stubGlobal("fetch", state.fetch); vi.stubEnv("CVSRS_CERTIFICATE_RENDER_SECRET","a".repeat(64)); });
afterEach(()=> {vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("accepts the actual Auth REST response without returning a session or password", async () => {
  state.rpc.mockImplementation(async (name: string) => name === "get_my_context" ? { profileId: "11111111-1111-4111-8111-111111111111", mfa: true, memberships: [{ clinicId: clinic, status: "active", capabilities: ["admin.users"] }] } : name === "prepare_staff_account_creation" ? {status:"creating"} : {email:"nurse@example.test",status:"pending_approval"});
  state.fetch.mockResolvedValue(Response.json({ user: { id: "33333333-3333-4333-8333-333333333333" }, access_token: "private-token" }));
  const response = await POST(request(), context);
  expect(response.status).toBe(200);
  const json=await response.json();
  expect(json.data).toMatchObject({email:"nurse@example.test",status:"pending_approval"});
  expect(JSON.stringify(json)).not.toMatch(/private-token|Password1234/);
});
it("refuses a clinical approver lacking account-management permission before signup", async () => {
  state.rpc.mockResolvedValue({ mfa: true, memberships: [{ clinicId: clinic, status: "active", capabilities: ["grant.approve.clinical"] }] });
  expect((await POST(request(), context)).status).toBe(403);
  expect(state.fetch).not.toHaveBeenCalled();
});
