import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// Components are called as plain functions with their hooks simulated, as in family-controls.test.ts.
const stub = vi.hoisted(() => ({ run: vi.fn(), reset: vi.fn(), refresh: vi.fn(), setState: vi.fn(), mode: undefined as unknown, state: { phase: "idle" } as unknown }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [stub.mode ?? initial, stub.setState],
  useTransition: () => [false, (action: () => void) => action()],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useSyncExternalStore: (_subscribe: unknown, getSnapshot: () => unknown) => getSnapshot(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stub.refresh }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: stub.state, run: stub.run, reset: stub.reset }) }));

type Props = { children?: ReactNode; onSubmit?: (event: unknown) => Promise<void>; onClick?: () => Promise<void>; role?: string; title?: string };
type Node = ReactElement<Props>;
function nodes(node: unknown): Node[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  const element = node as Node;
  if (typeof element.type === "function") return nodes((element.type as (p: Props) => unknown)(element.props));
  return [element, ...nodes(element.props?.children)];
}
const text = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  const element = node as Node;
  if (typeof element.type === "function") return text((element.type as (p: Props) => unknown)(element.props));
  return [element.props?.title ?? "", text(element.props?.children)].join(" ");
};

const appointment = { appointmentId: "appointment", childId: "child-1", status: "confirmed", serviceDate: "2026-10-01", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T01:00:00Z", sessionId: "s1", clinicTimezone: "Asia/Manila" };
const sessions = [
  { sessionId: "s1", serviceDate: "2026-10-01", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T01:00:00Z", hasRoom: true },
  { sessionId: "s2", serviceDate: "2026-10-07", startsAt: "2026-10-07T00:00:00Z", endsAt: "2026-10-07T01:00:00Z", hasRoom: true },
];

describe("family visit changes are confirmed in a region that survives refresh (UI-04)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    stub.mode = undefined;
    stub.state = { phase: "idle" };
    const visits = await import("@/app/children/[childId]/visits");
    visits.clearVisitNotice("child-1");
  });

  it("announces a cancellation with its date", async () => {
    stub.mode = "cancel";
    stub.run.mockResolvedValue({ ok: true, data: {} });
    const { AppointmentItem, getVisitNotice } = await import("@/app/children/[childId]/visits");
    const tree = AppointmentItem({ a: appointment, sessions, currentClinicTimezone: "Asia/Manila" });
    const confirm = nodes(tree).find((node) => text(node).includes("Yes, cancel visit") && node.props.onClick)!;
    await confirm.props.onClick!();
    expect(stub.refresh).toHaveBeenCalled();
    expect(getVisitNotice("child-1")).toMatchObject({ tone: "success", title: "Visit cancelled for Thu, 1 Oct 2026" });
  });

  it("announces a move with the new date", async () => {
    stub.mode = "move";
    stub.run.mockResolvedValue({ ok: true, data: {} });
    vi.stubGlobal("FormData", class { get() { return "s2"; } });
    const { AppointmentItem, getVisitNotice } = await import("@/app/children/[childId]/visits");
    const form = nodes(AppointmentItem({ a: appointment, sessions, currentClinicTimezone: "Asia/Manila" })).find((node) => node.type === "form")!;
    await form.props.onSubmit!({ preventDefault() {}, currentTarget: {} });
    vi.unstubAllGlobals();
    expect(getVisitNotice("child-1")?.title).toMatch(/^Visit moved to Wed, 7 Oct 2026/);
  });

  it("renders the latest change as a focusable status notice inside the booking area, replacing a stale booking error", async () => {
    const { BookVisit, announceVisitChange } = await import("@/app/children/[childId]/visits");
    announceVisitChange("child-1", { tone: "danger", title: "That time could not be booked", message: "old error" });
    announceVisitChange("child-1", { tone: "success", title: "Visit cancelled for Thu, 1 Oct 2026" });
    const all = nodes(BookVisit({ childId: "child-1", sessions, clinicTimezone: "Asia/Manila" }));
    const status = all.find((node) => node.props?.role === "status")!;
    expect(text(status)).toContain("Visit cancelled for Thu, 1 Oct 2026");
    expect(all.some((node) => node.props?.role === "alert")).toBe(false);
    expect(all.some((node) => (node.props as { tabIndex?: number }).tabIndex === -1)).toBe(true);
  });

  it("maps the double-booking conflict to plain family copy", async () => {
    stub.run.mockResolvedValue({ ok: false, status: 409, code: "conflict", reason: "duplicate_session_booking", message: "this child already has an appointment in this session" });
    vi.stubGlobal("FormData", class { get(key: string) { return key === "sessionId" ? "s2" : ""; } });
    const { BookVisit, getVisitNotice } = await import("@/app/children/[childId]/visits");
    const form = nodes(BookVisit({ childId: "child-1", sessions, clinicTimezone: "Asia/Manila" })).find((node) => node.type === "form")!;
    await form.props.onSubmit!({ preventDefault() {}, currentTarget: { reset: vi.fn() } });
    vi.unstubAllGlobals();
    const notice = getVisitNotice("child-1")!;
    expect(notice.tone).toBe("danger");
    expect(notice.message).not.toContain("appointment in this session");
    expect(notice.message).toMatch(/already has a visit booked/i);
  });

  it("clears the booking form and confirms the booked time", async () => {
    stub.run.mockResolvedValue({ ok: true, data: {} });
    vi.stubGlobal("FormData", class { get(key: string) { return key === "sessionId" ? "s2" : ""; } });
    const reset = vi.fn();
    const { BookVisit, getVisitNotice } = await import("@/app/children/[childId]/visits");
    const form = nodes(BookVisit({ childId: "child-1", sessions, clinicTimezone: "Asia/Manila" })).find((node) => node.type === "form")!;
    await form.props.onSubmit!({ preventDefault() {}, currentTarget: { reset } });
    vi.unstubAllGlobals();
    expect(reset).toHaveBeenCalled();
    expect(stub.refresh).toHaveBeenCalled();
    expect(getVisitNotice("child-1")).toMatchObject({ tone: "success" });
    expect(getVisitNotice("child-1")!.title).toMatch(/^Visit booked for Wed, 7 Oct 2026/);
  });
});
