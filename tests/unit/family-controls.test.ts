import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const stub = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn(), setState: vi.fn(), refreshing: false, state: { phase: "idle" } as unknown }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: (initial: unknown) => [initial, stub.setState], useTransition: () => [stub.refreshing, (action: () => void) => action()] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stub.refresh }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: stub.state, run: stub.run }) }));

type Node = ReactElement<{ children?: import("react").ReactNode; onSubmit?: (event: unknown) => Promise<void>; onClick?: () => Promise<void>; role?: string; disabled?: boolean }>;
function nodes(node: Node): Node[] {
  if (!node || typeof node !== "object") return [];
  const children = node.props?.children;
  return [node, ...[children].flat().flatMap((child) => nodes(child as Node))];
}

describe("family mutation feedback and contact preservation", () => {
  beforeEach(() => { vi.clearAllMocks(); stub.refreshing = false; stub.state = { phase: "idle" }; stub.run.mockResolvedValue({ ok: true, data: {} }); });
  it("keeps the existing phone when saving language with a blank number", async () => {
    const { TextSettings } = await import("@/app/messages/text-settings");
    const tree = TextSettings({ prefs: { guardianId: "g", language: "en", phoneMasked: "***4567", hasPhone: true, phoneChecked: true, smsOptIn: true } }) as Node;
    const form = nodes(tree).find((node) => node.type === "form")!;
    const data = { phone: "  ", language: "fil" };
    vi.stubGlobal("FormData", class { get(key: keyof typeof data) { return data[key]; } });
    await form.props.onSubmit!({ preventDefault() {}, currentTarget: {} });
    expect(stub.run).toHaveBeenCalledWith({ language: "fil" });
    vi.unstubAllGlobals();
  });
  it("shows failed mark-all-read requests so the user can retry", async () => {
    stub.state = { phase: "error", error: { message: "Connection failed", unknown: true } };
    const { MarkAllRead } = await import("@/app/messages/mark-read");
    expect(nodes(MarkAllRead() as Node).some((node) => node.props?.role === "alert")).toBe(true);
  });
  it("shows a downloadable certificate failure instead of swallowing it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { DownloadCertificateButton } = await import("@/app/children/[childId]/download-button");
    const tree = DownloadCertificateButton({ certificateId: "certificate" }) as Node;
    await nodes(tree).find((node) => node.type === "button")!.props.onClick!();
    expect(stub.setState).toHaveBeenCalledWith(expect.stringContaining("download"));
    vi.unstubAllGlobals();
  });
});

it("disables appointment actions until refreshed appointment data arrives", async () => {
  stub.refreshing = true;
  const { AppointmentItem } = await import("@/app/children/[childId]/visits");
  const tree = AppointmentItem({ a: { appointmentId: "appointment", childId: "child", status: "confirmed", serviceDate: "2026-10-01", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T01:00:00Z", sessionId: "session", clinicTimezone: "UTC" }, sessions: [], currentClinicTimezone: "UTC" }) as Node;
  const actions = nodes(tree).filter((node) => node.props?.children === "Change time" || node.props?.children === "Cancel visit");
  expect(actions).toHaveLength(2);
  expect(actions.every((node) => node.props.disabled)).toBe(true);
});

