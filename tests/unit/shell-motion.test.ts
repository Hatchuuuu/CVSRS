import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
const read = (path: string) => readFileSync(path, "utf8");
const SHELL_FILES = [
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/clinic/[clinicId]/layout.tsx",
  "src/app/clinic/[clinicId]/staff-nav.tsx",
  "src/app/children/[childId]/visits.tsx",
  "src/components/ui.tsx",
  "src/components/schedule-view.tsx",
  "src/components/sign-out-button.tsx",
  "src/components/theme-provider.tsx",
  "src/components/mobile-nav.tsx",
  "src/components/header-height.tsx",
];

describe("motion system (UI-15)", () => {
  it("does not redefine tw-animate-css's animate-in utility", () => {
    expect(css).not.toMatch(/^\s*\.animate-in\b/m);
    expect(css).toMatch(/^\s*\.enter-up\s*\{/m);
  });

  it("keeps entrance content visible under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.enter-up/);
    expect(reduced).toMatch(/\.enter-stagger > \*/);
  });

  it("keeps link press and arrow hover feedback still under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"), css.indexOf("@media print"));
    for (const selector of ["a:active", 'svg[class*="group-hover"]', ".lp-btn:hover svg", ".lp-link:hover svg"]) {
      expect(reduced, selector).toContain(selector);
    }
    expect(reduced).toMatch(/a:active[^}]+transform:\s*none\s*!important/s);
  });

  it("stops the called-ticket pulse after a few cycles", () => {
    const rule = css.match(/\.pulse-border\s*\{([^}]*)\}/)![1]!;
    expect(rule).not.toMatch(/infinite/);
    expect(rule).toMatch(/\b[2-5]\b\s*;?/);
  });

  it("uses explicit transition properties and no entrance animation in shell components", () => {
    for (const file of SHELL_FILES) {
      const source = read(file);
      expect(source, file).not.toContain("transition-all");
      expect(source, file).not.toMatch(/["`\s]animate-in["`\s]/);
      expect(source, file).not.toContain("stagger-children");
    }
  });

  it("limits entrance motion to the public home page", () => {
    for (const file of SHELL_FILES.filter((f) => f !== "src/app/page.tsx")) {
      expect(read(file), file).not.toMatch(/enter-up|enter-stagger/);
    }
  });

  it("derives sticky offsets from the measured header height (UI-11)", () => {
    expect(css).toMatch(/--header-h:/);
    expect(read("src/components/ui.tsx")).toContain("var(--header-h)");
    expect(read("src/components/workspace-sidebar.tsx")).toContain("var(--header-h)");
  });
});
