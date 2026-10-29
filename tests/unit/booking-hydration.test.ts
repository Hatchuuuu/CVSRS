import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: vi.fn(), reset: vi.fn() }) }));
import { AppointmentItem, BookVisit } from "@/app/children/[childId]/visits";

it("prevents native GET booking submission before the mutation handler hydrates", () => {
  const html = renderToStaticMarkup(createElement(BookVisit, {
    childId: "synthetic-child",
    clinicTimezone: "Asia/Manila",
    sessions: [{ sessionId: "synthetic-session", serviceDate: "2026-10-17", startsAt: "2026-10-17T00:00:00Z", endsAt: "2026-10-17T01:00:00Z", hasRoom: true }],
  }));
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
  expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
});

it("keeps appointment actions disabled until their interaction handlers hydrate", () => {
  const html = renderToStaticMarkup(createElement(AppointmentItem, {
    a: { appointmentId: "synthetic-appointment", childId: "synthetic-child", sessionId: "synthetic-session", status: "confirmed", serviceDate: "2026-10-17", startsAt: "2026-10-17T00:00:00Z", endsAt: "2026-10-17T01:00:00Z", clinicTimezone: "Asia/Manila" },
    sessions: [],
    currentClinicTimezone: "Asia/Manila",
  }));
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Change time<\/button>/);
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel visit<\/button>/);
});
