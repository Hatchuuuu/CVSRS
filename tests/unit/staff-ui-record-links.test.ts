import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ requireClinicStaff: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: stubs.requireClinicStaff }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), notFound: () => { throw new Error("not found"); } }));

import { childRecordHref } from "@/app/clinic/[clinicId]/followup/record-link";
import { membershipStatusChip } from "@/app/clinic/[clinicId]/access/status";

const worklist = {
  asOf: "2026-10-01T00:00:00Z",
  schedule: "active",
  staleChildren: 0,
  items: [{ childId: "kid", childName: "Ana Cruz", recordNo: "R-1", dob: "2025-03-04", behind: 1, due: 0, review: 0, needs: [], computedAt: "2026-10-01T00:00:00Z", attempts: 0, lastAttempt: null, guardian: null }],
};
const queue = [
  { queueEntryId: "q1", ticket: "A1", status: "in_service", station: "Station 1", priority: "routine", priorityReason: null, walkIn: false, childId: "kid", childName: "Ana Cruz", recordNo: "R-1", queuedAt: "2026-10-01T00:00:00Z", version: 1 },
];
const appts = [{ appointmentId: "a1", status: "confirmed", channel: "online", childId: "kid2", childName: "Ben Cruz", recordNo: "R-2", startsAt: "2026-10-01T01:00:00Z", endsAt: "2026-10-01T02:00:00Z", reason: null }];

function viewer(capabilities: string[], data: Record<string, unknown>) {
  stubs.requireClinicStaff.mockResolvedValue({
    membership: { capabilities, clinicTimezone: "Asia/Manila" },
    ctx: { profileId: "me" },
    rpc: { rpc: (name: string) => Promise.resolve(name in data ? data[name] : []) },
  });
}

describe("record links follow what the viewer may open", () => {
  beforeEach(() => vi.clearAllMocks());

  it("links only with child.search", () => {
    expect(childRecordHref("c", "kid", new Set(["child.search"]))).toBe("/clinic/c/children/kid");
    expect(childRecordHref("c", "kid", ["bhw.followup"])).toBeNull();
    expect(childRecordHref("c", "", ["child.search"])).toBeNull();
  });

  it("gives a barangay health worker no dead links on the follow-up list", async () => {
    viewer(["bhw.followup"], { list_followup_worklist: worklist });
    const { default: Followup } = await import("@/app/clinic/[clinicId]/followup/page");
    const html = renderToStaticMarkup(await Followup({ params: Promise.resolve({ clinicId: "c" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain("Ana Cruz");
    expect(html).not.toContain("/clinic/c/children/");
  });

  it("keeps the follow-up record link for staff who can open records", async () => {
    viewer(["child.read_clinical", "child.search"], { list_followup_worklist: worklist });
    const { default: Followup } = await import("@/app/clinic/[clinicId]/followup/page");
    const html = renderToStaticMarkup(await Followup({ params: Promise.resolve({ clinicId: "c" }), searchParams: Promise.resolve({}) }));
    expect(html).toContain('href="/clinic/c/children/kid"');
  });

  it("links the queue row and the expected appointment to the child record", async () => {
    viewer(["queue.manage", "appointment.manage", "child.search"], { list_queue: queue, list_appointments: appts, list_sessions: [] });
    const { default: Today } = await import("@/app/clinic/[clinicId]/today/page");
    const html = renderToStaticMarkup(await Today({ params: Promise.resolve({ clinicId: "c" }) }));
    expect(html).toContain('href="/clinic/c/children/kid"');
    expect(html).toContain('href="/clinic/c/children/kid2"');
  });

  it("does not link today's names for staff who cannot open records", async () => {
    viewer(["queue.manage", "appointment.manage"], { list_queue: queue, list_appointments: appts, list_sessions: [] });
    const { default: Today } = await import("@/app/clinic/[clinicId]/today/page");
    const html = renderToStaticMarkup(await Today({ params: Promise.resolve({ clinicId: "c" }) }));
    expect(html).toContain("Ana Cruz");
    expect(html).not.toContain("/clinic/c/children/");
  });
});

describe("staff access status", () => {
  it("labels each membership status on its own", () => {
    expect(membershipStatusChip("active")).toEqual({ tone: "success", label: "Active" });
    expect(membershipStatusChip("pending_approval").label).toBe("Waiting for approval");
    expect(membershipStatusChip("suspended").label).toBe("Paused");
    expect(membershipStatusChip("something_else").label).toBe("something else");
  });

  it("shows a suspended membership as paused with no approve control", async () => {
    viewer(["admin.users", "grant.approve.clinical"], {
      list_staff_memberships: [{ membershipId: "m", profileId: "p", displayName: "Nurse Joy", role: "nurse", capabilities: [], status: "suspended", version: 1, validUntil: null, requestedBy: "x", requiresClinicalApproval: false }],
    });
    const { default: Access } = await import("@/app/clinic/[clinicId]/access/page");
    const html = renderToStaticMarkup(await Access({ params: Promise.resolve({ clinicId: "c" }) }));
    expect(html).toContain("Paused");
    expect(html).not.toContain("Waiting for approval");
    expect(html).not.toMatch(/>\s*Approve/);
  });
});

describe("walk-in search formats dates of birth", () => {
  it("has no raw ISO date fallback in the board source", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/app/clinic/[clinicId]/today/board.tsx", "utf8");
    expect(src).not.toMatch(/\.dob \?\?/);
  });
});
