import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ requireClinicStaff: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: stubs.requireClinicStaff }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), notFound: () => { throw new Error("not found"); } }));

import { QueueBoard, type QueueEntry } from "@/app/clinic/[clinicId]/today/board";
import { appointmentStatusLabel, callNextNotice, checkInMessage, splitAppointments } from "@/app/clinic/[clinicId]/today/queue-logic";
import { CaseCard, type ReviewCase } from "@/app/clinic/[clinicId]/review/cases";

const entry = (over: Partial<QueueEntry>): QueueEntry => ({ queueEntryId: "q1", ticket: "A1", status: "waiting", station: null, priority: "routine", priorityReason: null, walkIn: true, childId: "kid", childName: "Ana Cruz", recordNo: "R-1", queuedAt: "2026-10-01T00:00:00Z", version: 1, ...over });

describe("check-in and call-next notices", () => {
  it("names the ticket and the child after a booked check-in", () => {
    expect(checkInMessage("1001-002", "Maya Rivera")).toBe("Ticket 1001-002 issued for Maya Rivera.");
  });

  it("shows 'Now calling' only while that ticket is waiting to be refreshed or still called", () => {
    const called = { called: true, ticket: "A1" };
    expect(callNextNotice(called, [entry({ status: "waiting" })])?.title).toBe("Now calling A1");
    expect(callNextNotice(called, [entry({ status: "called" })])?.title).toBe("Now calling A1");
    expect(callNextNotice(called, [entry({ status: "in_service" })])).toBeNull();
    expect(callNextNotice(called, [entry({ status: "completed" })])).toBeNull();
    expect(callNextNotice(called, [])).toBeNull();
  });

  it("says nobody is waiting only while nobody is", () => {
    expect(callNextNotice({ called: false }, [])?.title).toBe("Nobody is waiting");
    expect(callNextNotice({ called: false }, [entry({ status: "waiting", ticket: "B2" })])).toBeNull();
  });
});

describe("expected appointments", () => {
  it("keeps cancelled and moved bookings out of the expected list", () => {
    const list = ["confirmed", "checked_in", "fulfilled", "cancelled", "no_show", "rescheduled"].map((status, i) => ({ appointmentId: String(i), status }));
    const { expected, cancelled } = splitAppointments(list);
    expect(expected.map((a) => a.status)).toEqual(["confirmed", "checked_in", "fulfilled", "no_show"]);
    expect(cancelled.map((a) => a.status)).toEqual(["cancelled", "rescheduled"]);
  });

  it("labels every status in words", () => {
    for (const s of ["confirmed", "checked_in", "fulfilled", "cancelled", "no_show", "rescheduled", "something_new"]) {
      const label = appointmentStatusLabel(s).label;
      expect(label).not.toContain("_");
      expect(label[0]).toBe(label[0]!.toUpperCase());
    }
  });

  it("renders cancelled bookings only inside a collapsed group", async () => {
    stubs.requireClinicStaff.mockResolvedValue({
      membership: { capabilities: ["queue.manage", "appointment.manage", "child.search"], clinicTimezone: "Asia/Manila" },
      rpc: {
        rpc: (name: string) =>
          Promise.resolve(
            name === "list_appointments"
              ? [
                  { appointmentId: "a1", status: "confirmed", channel: "online", childId: "k1", childName: "Ben", recordNo: "R-2", startsAt: "2026-10-01T01:00:00Z", endsAt: "2026-10-01T02:00:00Z", reason: null },
                  { appointmentId: "a2", status: "cancelled", channel: "online", childId: "k2", childName: "Maya", recordNo: "R-3", startsAt: "2026-10-01T01:00:00Z", endsAt: "2026-10-01T02:00:00Z", reason: null },
                ]
              : [],
          ),
      },
    });
    const { default: Today } = await import("@/app/clinic/[clinicId]/today/page");
    const html = renderToStaticMarkup(await Today({ params: Promise.resolve({ clinicId: "c" }) }));
    expect(html).toMatch(/<details[^>]*>\s*<summary[^>]*>Cancelled today \(1\)<\/summary>[\s\S]*Maya/);
    expect(html).not.toMatch(/>cancelled</);
    expect(html.indexOf("Maya")).toBeGreaterThan(html.indexOf("Cancelled today"));
  });
});

describe("finishing a visit", () => {
  it("has no pre-selected outcome and requires a choice", () => {
    const html = renderToStaticMarkup(createElement(QueueBoard, { clinicId: "c", entries: [entry({ status: "in_service" })], canOpenRecord: true }));
    expect(html).toMatch(/<select[^>]*required=""/);
    expect(html).toContain("Choose outcome…");
    expect(html).not.toMatch(/<option[^>]*value="vaccinated"[^>]*selected/);
  });
});

describe("review cards", () => {
  it("give each card region a distinct accessible name", () => {
    const base: ReviewCase = { caseId: "11111111-aaaa", kind: "duplicate", status: "open", reason: "", createdAt: "", evidence: {}, childId: "k", candidateChildId: null, child: { displayName: "Ana", localRecordNo: "R-1", dob: null }, candidate: null, guardianName: null };
    const render = (c: ReviewCase, n: number) => renderToStaticMarkup(createElement(CaseCard, { clinicId: "c", c, canVerify: false, canResolve: false, canEdit: false, position: { n, of: 2 } }));
    const name = (html: string) => /<section[^>]*aria-label="([^"]+)"/.exec(html)?.[1];
    const a = name(render(base, 1));
    const b = name(render({ ...base, caseId: "22222222-bbbb" }, 2));
    expect(a).toContain("Ana");
    expect(a).not.toBe(b);
  });
});
