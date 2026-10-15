import { afterEach, describe, expect, it, vi } from "vitest";
import { callApi } from "@/lib/client/api";

const respond = (status: number, body: unknown) => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

describe("callApi outcome classification", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("treats a reused operation key as an unconfirmed save, never as a plain failure", async () => {
    respond(409, { error: { code: "already_saved", message: "An earlier attempt was already saved." }, requestId: "r1" });
    const res = await callApi("/api/v1/x", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(res).toMatchObject({ ok: false, status: 409, code: "already_saved", unknown: true, requestId: "r1" });
  });

  it("keeps an ordinary state conflict definitive", async () => {
    respond(409, { error: { code: "conflict", message: "The record changed." } });
    const res = await callApi("/api/v1/x", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(res.ok).toBe(false);
    expect("unknown" in res && res.unknown).toBeFalsy();
  });

  it("names every invalid field in the summary, not only those a form renders inline", async () => {
    respond(422, { error: { code: "unprocessable", message: "Some details need attention.", fieldErrors: { "dose.administeredOn": "Enter a valid date.", _: "Check the form." } } });
    const res = await callApi("/api/v1/x", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toBe("Some details need attention. Administered on: Enter a valid date. Check the form.");
      expect(res.fieldErrors).toEqual({ "dose.administeredOn": "Enter a valid date.", _: "Check the form." });
    }
  });

  it("marks a network failure as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    const res = await callApi("/api/v1/x");
    expect(res).toMatchObject({ ok: false, status: 0, code: "network", unknown: true });
  });

  it.each([500, 502, 504, 200])("does not claim an uncertain mutation saved nothing after HTTP %s", async (status) => {
    respond(status, status === 500 ? { error: { code: "internal", message: "Something went wrong." } } : {});
    const res = await callApi("/api/v1/x", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(res).toMatchObject({ ok: false, unknown: true });
  });
});

describe("server messages read as sentences", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("capitalises a terse database conflict message and ends it, leaving finished sentences alone", async () => {
    respond(409, { error: { code: "conflict", message: "insufficient stock" } });
    const res = await callApi("/api/v1/x", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(!res.ok && res.message).toBe("Insufficient stock.");
    respond(409, { error: { code: "conflict", message: "The record changed. Refresh and try again." } });
    const done = await callApi("/api/v1/x", { method: "POST", body: {}, key: crypto.randomUUID() });
    expect(!done.ok && done.message).toBe("The record changed. Refresh and try again.");
  });
});
