import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/db", () => ({ getRpcClient: async () => ({ session: async () => ({ userId: "guardian" }), rpc: state.rpc }) }));
import { POST } from "@/app/api/v1/clinics/[clinicId]/privacy-notice/acknowledge/route";
import { resetRateLimits } from "@/lib/security/rate-limit";
const clinicId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const key = "11111111-1111-4111-8111-111111111111";
const text = "A clinic privacy notice long enough to explain which records are kept and who may read them.";
const submit = (body: unknown) => POST(new Request(`https://app.example/api/v1/clinics/${clinicId}/privacy-notice/acknowledge`, {
  method: "POST", headers: { origin: "https://app.example", "idempotency-key": key, "content-type": "application/json" }, body: JSON.stringify(body),
}), { params: Promise.resolve({ clinicId }) });
afterEach(() => { state.rpc.mockReset(); resetRateLimits(); });
describe("viewed privacy notice API contract", () => {
  it("passes the exact displayed version and text to the strict acknowledgement command", async () => {
    state.rpc.mockResolvedValue({ acknowledged: true });
    expect((await submit({ version: "v1", text })).status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith("acknowledge_clinic_privacy_notice", {
      p_operation_key: key, p_clinic_id: clinicId, p_notice_version: "v1", p_notice_text: text,
    });
  });
  it("requires the viewed notice instead of silently accepting whichever policy is current", async () => {
    expect((await submit({})).status).toBe(422);
    expect(state.rpc).not.toHaveBeenCalled();
  });
});
