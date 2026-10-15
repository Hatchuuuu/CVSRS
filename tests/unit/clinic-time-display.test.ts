import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ requireViewer: vi.fn() }));
vi.mock("@/lib/server/viewer", () => stubs);
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, useRouter: () => ({ refresh() {}, push() {} }), useParams: () => ({}) }));

// 23:30Z on 1 Oct is 07:30 on 2 Oct in Manila: the clinic calendar day, not the UTC one, must be shown.
const EARLY_MORNING = "2026-10-01T23:30:00Z";
const originalTz = process.env.TZ;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = "UTC";
});
afterEach(() => {
  vi.useRealTimers();
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

/** Depth-first search of a server-rendered element tree for the first element of a given component. */
function findElement(node: ReactNode, type: unknown): ReactElement<Record<string, unknown>> | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findElement(child, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === type) return el;
  return findElement(el.props?.children as ReactNode, type);
}

describe("staff record dates use the clinic calendar", () => {
  it("dates a hold placed early in the Manila morning on the Manila day", async () => {
    const { HoldsPanel } = await import("@/app/clinic/[clinicId]/children/[childId]/holds");
    const hold = { id: "h", status: "active" as const, reason: "Review", note: null, reviewOn: null, startsAt: EARLY_MORNING, ruleRequirement: null, resolvedAt: null, resolutionNote: null, placedBy: null };
    const html = renderToStaticMarkup(createElement(HoldsPanel, { clinicId: "c", clinicTimezone: "Asia/Manila", childId: "k", holds: [hold], canPlace: false, canRelease: false }));
    expect(html).toContain("Placed 2 Oct 2026");
  });
});

describe("staff time entry defaults to clinic time", () => {
  const lot = { lotId: "lot", lot: "L1", product: "Demo", productCode: "D", expiresOn: "2027-01-01", disposition: "usable", expired: false, usable: "5", locations: [{ locationId: "fridge", onHand: "5" }] };
  const locations = [{ id: "fridge", name: "Fridge", kind: "usable", status: "active" }];

  it("fills “Actual time given” with Manila wall time on a device set to UTC and names the zone", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T23:00:00Z"), toFake: ["Date"] });
    const { AdministerPanel, ExceptionForm } = await import("@/app/clinic/[clinicId]/children/[childId]/administration");
    const html = renderToStaticMarkup(createElement(AdministerPanel, { clinicId: "c", clinicTimezone: "Asia/Manila", encounterId: "e", childName: "Child", recordNo: "R", lots: [lot], locations }));
    expect(html).toContain('value="2026-10-01T07:00"');
    expect(html).toContain('max="2026-10-01T07:00"');
    expect(html).toContain("Clinic time (Asia/Manila)");
    const exception = renderToStaticMarkup(createElement(ExceptionForm, { clinicId: "c", clinicTimezone: "Asia/Manila", childId: "k", encounterId: null, products: [], lots: [lot], locations }));
    expect(exception).toContain('value="2026-10-01T07:00"');
    expect(exception).toContain("Clinic time (Asia/Manila)");
  });

  it("fills a cold-chain reading time with clinic wall time and names the zone", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-30T23:00:00Z"), toFake: ["Date"] });
    const { ReadingForm } = await import("@/app/clinic/[clinicId]/inventory/cold-chain/forms");
    const html = renderToStaticMarkup(createElement(ReadingForm, { clinicId: "c", clinicTimezone: "Asia/Manila", locations: [{ id: "fridge", label: "Fridge" }] }));
    expect(html).toContain('value="2026-10-01T07:00"');
    expect(html).toContain("Clinic time (Asia/Manila)");
  });
});

describe("family screens show clinic time", () => {
  function guardianRpc(certificateIssuedAt: string) {
    return vi.fn(async (name: string) => {
      if (name === "my_children") return [{ childId: "child", displayName: "Fictional Child", localRecordNo: "T1", dob: "2025-03-04", recordStatus: "active", accessScope: "full", clinicId: "clinic", clinicName: "Clinic", clinicTimezone: "Asia/Manila" }];
      if (name === "guardian_get_schedule") return { status: "no_active_schedule" };
      if (name === "guardian_list_certificates") return [{ id: "cert", certificateNo: "C-1", status: "issued", reviewNeeded: false, issuedAt: certificateIssuedAt }];
      if (name === "guardian_child_history" || name === "guardian_list_sessions" || name === "my_appointments") return [];
      return null;
    });
  }

  it("dates a certificate issued early in the Manila morning on the Manila day", async () => {
    stubs.requireViewer.mockResolvedValue({ rpc: { rpc: guardianRpc(EARLY_MORNING) } });
    const { default: GuardianChild } = await import("@/app/children/[childId]/page");
    const html = renderToStaticMarkup(await GuardianChild({ params: Promise.resolve({ childId: "child" }) }));
    expect(html).toContain("Issued 2 Oct 2026");
  });

  it("gives the correction request the birth date on file", async () => {
    stubs.requireViewer.mockResolvedValue({ rpc: { rpc: guardianRpc(EARLY_MORNING) } });
    const { default: GuardianChild } = await import("@/app/children/[childId]/page");
    const { EditRequestForm } = await import("@/app/children/[childId]/edit-request");
    const form = findElement(await GuardianChild({ params: Promise.resolve({ childId: "child" }) }), EditRequestForm);
    expect(form?.props.current).toEqual({ displayName: "Fictional Child", dob: "2025-03-04" });
  });

  it("shows message times in the child's clinic zone with no UTC label", async () => {
    stubs.requireViewer.mockResolvedValue({
      rpc: {
        rpc: async (name: string) => {
          if (name === "my_messages") return { unread: 0, items: [{ id: "m", kind: "booking", title: "Booked", body: "See you", childId: "child", createdAt: EARLY_MORNING, read: true }] };
          if (name === "my_children") return [{ childId: "child", clinicTimezone: "Asia/Manila" }];
          return null;
        },
      },
    });
    const { default: Messages } = await import("@/app/messages/page");
    const html = renderToStaticMarkup(await Messages());
    const { formatClinicDateTime } = await import("@/lib/format");
    expect(html).toContain(formatClinicDateTime(EARLY_MORNING, "Asia/Manila"));
    expect(html).toMatch(/Oct 2, 2026|2 Oct 2026/);
    expect(html).toContain("7:30");
    expect(html).not.toContain("UTC");
  });
});

describe("waiting-room display", () => {
  it("renders no clock text on the server, so hydration cannot disagree with it", async () => {
    const { DisplayBoard } = await import("@/app/display/[clinicId]/board");
    const html = renderToStaticMarkup(createElement(DisplayBoard, { clinicId: "c", initial: { asOf: EARLY_MORNING, nowCalling: [], waiting: [] } }));
    expect(html).toContain("Numbers only.");
    expect(html).not.toMatch(/Updated/);
  });
});
