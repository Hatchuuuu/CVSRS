import { afterEach, beforeEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, effects: [] as (() => void | (() => void))[], request: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === "function" ? next(hooks.values[i]) : next; }];
  },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects.push(effect); },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/client/api", () => ({ callApi: hooks.request, useMutation: () => ({ state: { phase: "idle" }, run: vi.fn() }) }));
import { useClinicPrivacy } from "@/app/children/privacy-notice";

function PrivacyHarness(clinicId: string) { hooks.cursor = 0; return useClinicPrivacy(clinicId); }
beforeEach(() => { hooks.values = []; hooks.effects = []; hooks.request.mockReset(); vi.stubGlobal("window", new EventTarget()); });
afterEach(() => vi.unstubAllGlobals());

it("invalidates an in-flight notice when another form accepts that clinic's notice", async () => {
  let finish!: (value: unknown) => void;
  hooks.request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ ok: true, data: { configured: true, acknowledged: true } });
  PrivacyHarness("clinic");
  const cleanup = hooks.effects.pop()!() as () => void;
  const event = new Event("clinic-privacy-accepted");
  Object.defineProperty(event, "detail", { value: "clinic" });
  window.dispatchEvent(event);
  finish({ ok: true, data: { configured: true, acknowledged: false, version: "stale" } });
  await Promise.resolve();
  expect(PrivacyHarness("clinic").notice).toBeUndefined();
  cleanup();
  hooks.effects.pop()!();
  await Promise.resolve();
  expect(PrivacyHarness("clinic").ready).toBe(true);
});

it("loads the selected clinic notice directly, including clinics outside the pending notice window", async () => {
  hooks.request.mockResolvedValue({ ok: true, data: { configured: true, acknowledged: false, version: "v1", text: "Selected clinic policy" } });
  expect(PrivacyHarness("clinic-101").ready).toBe(false);
  hooks.effects.pop()!();
  await Promise.resolve();
  const result = PrivacyHarness("clinic-101");
  expect(hooks.request).toHaveBeenCalledWith("/api/v1/clinics/clinic-101/privacy-notice");
  expect(result.ready).toBe(false);
  expect(result.notice?.text).toBe("Selected clinic policy");
});

it("does not let a late previous-clinic response unlock the selected clinic", async () => {
  let finish!: (value: unknown) => void;
  hooks.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  PrivacyHarness("old");
  const cleanup = hooks.effects.pop()!() as () => void;
  cleanup();
  expect(PrivacyHarness("new").ready).toBe(false);
  finish({ ok: true, data: { configured: false, acknowledged: true } });
  await Promise.resolve();
  expect(PrivacyHarness("new").ready).toBe(false);
});

it("keeps submission blocked on a failed read and unlocks after a successful retry", async () => {
  hooks.request.mockResolvedValueOnce({ ok: false, message: "Connection unavailable" }).mockResolvedValueOnce({ ok: true, data: { configured: false, acknowledged: true } });
  PrivacyHarness("clinic");
  hooks.effects.pop()!();
  await Promise.resolve();
  const failed = PrivacyHarness("clinic");
  expect(failed.ready).toBe(false);
  expect(failed.error).toBe("Connection unavailable");
  failed.reload();
  PrivacyHarness("clinic");
  hooks.effects.pop()!();
  await Promise.resolve();
  expect(PrivacyHarness("clinic").ready).toBe(true);
});
