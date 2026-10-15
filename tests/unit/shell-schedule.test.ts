import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ScheduleView, type ScheduleRequirement } from "@/components/schedule-view";

const render = (requirements: ScheduleRequirement[], showInternals = false) => renderToStaticMarkup(createElement(ScheduleView, { requirements, showInternals }));

describe("family schedule view (UI-08)", () => {
  it("shows the earliest date and a plain reason for an item that is not yet eligible", () => {
    const html = render([{ requirement: "A2", status: "not_yet_eligible", targetOn: "2026-10-14", windowStart: "2026-09-20", windowEnd: "2026-10-10", earliestEligibleOn: "2026-10-14", reasons: [{ code: "before_earliest_eligible", on: "2026-10-14" }] }]);
    expect(html).toContain("Earliest date");
    expect(html).toContain("14 Oct 2026");
    expect(html).toMatch(/too early/i);
    expect(html).not.toContain("before_earliest_eligible");
  });

  it("explains a waiting step without inventing timing", () => {
    const html = render([{ requirement: "B2", status: "not_yet_eligible", reasons: [{ code: "predecessor_pending" }] }]);
    expect(html).toMatch(/earlier dose/i);
    expect(html).not.toContain("predecessor_pending");
  });

  it("describes a window with no end as open-ended", () => {
    const html = render([{ requirement: "C1", status: "upcoming", windowStart: "2026-10-21", windowEnd: null }]);
    expect(html).toMatch(/open-ended/i);
    expect(html).not.toContain("No end limit");
  });

  it("prints dates at 14px or larger and has no entrance animation", () => {
    const html = render([{ requirement: "D1", status: "upcoming", targetOn: "2026-11-01" }]);
    expect(html).toMatch(/<dl class="[^"]*text-sm/);
    expect(html).not.toMatch(/<dl class="[^"]*text-xs/);
    expect(html).not.toMatch(/stagger|animate-in|enter-up|transition-all/);
  });

  it("keeps the staff view's internal reason text", () => {
    const html = render([{ requirement: "A2", status: "not_yet_eligible", earliestEligibleOn: "2026-10-14", reasons: [{ code: "before_earliest_eligible", on: "2026-10-14" }] }], true);
    expect(html).toContain("Earliest eligible");
    expect(html).toContain("Too early. The earliest eligible date is shown.");
  });
});
