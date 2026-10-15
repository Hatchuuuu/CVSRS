import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError, errorResponse, fromDbError } from "@/lib/api/errors";
import { callApi, type ApiFailure } from "@/lib/client/api";
import { acceptApplicationBody, requestStaffBody, submitApplicationBody } from "@/lib/validation/staff";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

// I4-05: the duplicate-session booking conflict is recognised by a stable hint carried end to end, never by the message wording.
describe("duplicate-session booking hint", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps the database hint to a stable reason and keeps the authored conflict message", () => {
    const e = fromDbError({ code: "CV409", message: "any wording at all", hint: "cvsrs:duplicate_session_booking" });
    expect(e).toMatchObject({ code: "conflict", status: 409, message: "any wording at all", reason: "duplicate_session_booking" });
  });

  it("sets no reason without the hint, for an unknown hint, or for a hint on another SQLSTATE", () => {
    expect(fromDbError({ code: "CV409", message: "this child already has an appointment in this session" }).reason).toBeUndefined();
    expect(fromDbError({ code: "CV409", message: "x", hint: "cvsrs:something_else" }).reason).toBeUndefined();
    expect(fromDbError({ code: "CV422", message: "x", hint: "cvsrs:duplicate_session_booking" }).reason).toBeUndefined();
    expect(fromDbError({ code: "CV409", message: "x", hint: "cvsrs:operation_key_reused" }).code).toBe("already_saved");
  });

  it("puts the reason in the API error envelope only when there is one", async () => {
    const withReason = await errorResponse(fromDbError({ code: "CV409", message: "m", hint: "cvsrs:duplicate_session_booking" }), "r1").json();
    expect(withReason.error).toEqual({ code: "conflict", message: "m", retryable: false, reason: "duplicate_session_booking" });
    const without = await errorResponse(new AppError("conflict", 409, "m"), "r2").json();
    expect(without.error).not.toHaveProperty("reason");
  });

  it("carries a known reason to ApiFailure and drops unknown ones", async () => {
    const respond = (body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status: 409 })));
    respond({ error: { code: "conflict", message: "m", reason: "duplicate_session_booking" } });
    expect(await callApi("/api/v1/appointments", { method: "POST", body: {}, key: crypto.randomUUID() })).toMatchObject({ ok: false, code: "conflict", reason: "duplicate_session_booking" });
    respond({ error: { code: "conflict", message: "m", reason: "made_up" } });
    const res = await callApi("/api/v1/appointments", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(res.ok === false && "reason" in res).toBe(false);
  });

  it("the family wording follows the reason, not the message text", async () => {
    const { familyVisitError } = await import("@/app/children/[childId]/visits");
    const fail = (over: Partial<ApiFailure>): ApiFailure => ({ ok: false, status: 409, code: "conflict", message: "", ...over });
    const reworded = familyVisitError(fail({ reason: "duplicate_session_booking", message: "Ang batang ito ay may booking na sa oras na ito." }));
    expect(reworded).toMatchObject({ tone: "danger", title: "That time could not be booked" });
    expect(reworded.message).toMatch(/already has a visit booked/i);
    // The old database wording without the hint is now an ordinary conflict, shown as authored.
    const oldText = familyVisitError(fail({ message: "this child already has an appointment in this session" }));
    expect(oldText).toEqual({ tone: "danger", title: "That could not be booked", message: "this child already has an appointment in this session" });
  });
});

// I4-06: request bodies cannot carry extra fields that would widen what is filed or granted (the database re-checks everything too).
describe("staff access request bodies are closed", () => {
  const clinicId = "8f5f3a52-7b8e-4d5c-9a51-1b2c3d4e5f60";
  it("an application cannot carry capabilities, a status, an organization or another person", () => {
    for (const extra of [{ capabilities: ["admin.users"] }, { status: "active" }, { organizationId: clinicId }, { profileId: clinicId }]) {
      expect(submitApplicationBody.safeParse({ clinicId, role: "assistant", ...extra }).success).toBe(false);
    }
    expect(submitApplicationBody.safeParse({ clinicId, role: "superuser" }).success).toBe(false);
    expect(submitApplicationBody.safeParse({ clinicId, role: "assistant" }).success).toBe(true);
  });
  it("accepting or requesting access cannot name another clinic, an approver or an active status", () => {
    for (const extra of [{ clinicId }, { approvedBy: clinicId }, { status: "active" }]) {
      expect(acceptApplicationBody.safeParse({ expectedVersion: 1, ...extra }).success).toBe(false);
      expect(requestStaffBody.safeParse({ email: "a@example.test", role: "assistant", ...extra }).success).toBe(false);
    }
    expect(acceptApplicationBody.safeParse({ expectedVersion: 1, capabilities: ["god.mode"] }).success).toBe(false);
  });
});
