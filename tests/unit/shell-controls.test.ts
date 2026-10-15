import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/clinic/c1/today" }));

import { SignOutButton } from "@/components/sign-out-button";
import { ThemeChoice } from "@/components/theme-provider";
import { StaffNav } from "@/app/clinic/[clinicId]/staff-nav";

describe("shell controls", () => {
  it("offers a labelled sign-out dialog before posting to the existing route", () => {
    const html = renderToStaticMarkup(createElement(SignOutButton));
    expect(html).toMatch(/<form[^>]*action="\/auth\/sign-out"[^>]*method="post"/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Sign out<\/button>/);
    expect(html).toMatch(/<dialog[^>]*aria-labelledby="[^"]+"[^>]*aria-describedby="[^"]+"/);
    expect(html).toContain("Sign out of eVacTrack?");
    expect(html).toContain("Cancel");
    expect(html).not.toContain("bg-danger");
    expect(html).not.toContain("transition-all");
  });

  it("offers light and dark themes with native radio state (UI-09)", () => {
    const html = renderToStaticMarkup(createElement(ThemeChoice));
    expect(html).toContain("<legend");
    for (const value of ["light", "dark"]) expect(html).toMatch(new RegExp(`<input[^>]*type="radio"[^>]*value="${value}"`));
    expect(html).not.toContain('value="system"');
  });

  it("collapses the clinic navigation into a labelled disclosure below lg (UI-02)", () => {
    const items = Array.from({ length: 13 }, (_, i) => ({ href: i === 0 ? "/clinic/c1/today" : `/clinic/c1/item${i}`, label: i === 0 ? "Today" : `Item ${i}`, icon: "today" as const }));
    const html = renderToStaticMarkup(createElement(StaffNav, { items }));
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*>[\s\S]*Clinic menu/);
    expect(html).toContain("Today");
    // The desktop list stays a vertical sidebar and never hides items behind horizontal scroll.
    expect(html).not.toContain("overflow-x-auto");
  });
});
