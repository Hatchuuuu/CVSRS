import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireViewer: async () => ({ rpc: { rpc: stubs.rpc } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/app/children/[childId]/visits", () => ({
  BookVisit: ({ childId }: { childId: string }) => <div>Booking controls for {childId}</div>,
  AppointmentItem: ({ a }: { a: { appointmentId: string; status: string } }) => <li>{a.appointmentId}: {a.status}</li>,
}));
const full = { childId: "full-child", displayName: "Verified Child", localRecordNo: "CV-1", accessScope: "full", clinicId: "clinic", clinicName: "Health center", clinicTimezone: "Asia/Manila" };
const limited = { ...full, childId: "limited-child", displayName: "Waiting Child", accessScope: "identity_only" };
beforeEach(() => {
  stubs.rpc.mockReset();
  stubs.rpc.mockImplementation(async (name: string) => name === "my_children" ? [limited, full] : []);
});

describe("family vaccination-record entry", () => {
  it("opens existing authorized history and next steps while explaining restricted access", async () => {
    const { default: Records } = await import("@/app/vaccination-records/page");
    const html = renderToStaticMarkup(await Records());
    expect(html).toContain('href="/children/full-child#his-h"');
    expect(html).toContain('href="/children/full-child#sch-h"');
    expect(html).toContain('href="/children/full-child#cert-h"');
    expect(html).not.toContain('/children/limited-child#his-h');
    expect(html).toContain("Clinic verification needed");
  });
  it("directs a family with no children to registration", async () => {
    stubs.rpc.mockResolvedValue([]);
    const { default: Records } = await import("@/app/vaccination-records/page");
    expect(renderToStaticMarkup(await Records())).toContain('href="/children#add-h"');
  });
  it("does not turn a failed child read into an empty family", async () => {
    stubs.rpc.mockResolvedValue(null);
    const { default: Records } = await import("@/app/vaccination-records/page");
    await expect(Records()).rejects.toThrow("Children could not be loaded");
  });
});

describe("family appointment entry", () => {
  it("defaults to an authorized child and limits displayed bookings to that child", async () => {
    stubs.rpc.mockImplementation(async (name: string) => name === "my_children" ? [limited, full] : name === "my_appointments" ? [
      { appointmentId: "visible-booking", childId: full.childId, status: "confirmed", startsAt: "2026-10-18T00:00:00Z" },
      { appointmentId: "visible-history", childId: full.childId, status: "cancelled", startsAt: "2026-10-17T00:00:00Z" },
      { appointmentId: "other-booking", childId: "another-child", status: "confirmed", startsAt: "2026-10-18T00:00:00Z" },
    ] : []);
    const { default: Appointments } = await import("@/app/appointments/page");
    const html = renderToStaticMarkup(await Appointments({}));
    expect(html).toContain("visible-booking");
    expect(html).toContain("visible-history");
    expect(html).not.toContain("other-booking");
    expect(html).toContain("Booking controls for full-child");
    expect(stubs.rpc).toHaveBeenCalledWith("guardian_list_sessions", expect.objectContaining({ p_clinic_id: "clinic" }));
  });
  it("never reads bookings or times for a restricted child", async () => {
    const { default: Appointments } = await import("@/app/appointments/page");
    const html = renderToStaticMarkup(await Appointments({ searchParams: Promise.resolve({ child: limited.childId }) }));
    expect(html).toContain("Clinic verification needed");
    expect(html).not.toContain("Booking controls");
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["someone-elses-child", [full.childId, limited.childId]])("refuses a foreign or ambiguous child selector: %j", async child => {
    const { default: Appointments } = await import("@/app/appointments/page");
    await expect(Appointments({ searchParams: Promise.resolve({ child }) })).rejects.toThrow("not found");
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it("offers registration when there is no linked child", async () => {
    stubs.rpc.mockResolvedValue([]);
    const { default: Appointments } = await import("@/app/appointments/page");
    const html = renderToStaticMarkup(await Appointments({}));
    expect(html).toContain('href="/children#add-h"');
    expect(stubs.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(["my_children", "my_appointments", "guardian_list_sessions"])("does not describe a missing %s result as empty data", async failed => {
    stubs.rpc.mockImplementation(async (name: string) => name === failed ? null : name === "my_children" ? [full] : []);
    const { default: Appointments } = await import("@/app/appointments/page");
    await expect(Appointments({})).rejects.toThrow("could not be loaded");
  });
});
