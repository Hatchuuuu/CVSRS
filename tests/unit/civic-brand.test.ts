import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
const theme = css.match(/@theme\s*\{([^}]+)/)![1]!;

describe("shared civic brand", () => {
  it("uses the reference blue and locally hosted typography throughout the system", () => {
    expect(theme).toContain("--color-primary: #0648ef");
    expect(theme).toContain('--font-sans: "CVSRS Jakarta"');
    for (const weight of [400, 600, 700]) {
      expect(css).toContain(`/fonts/jakarta-${weight}.ttf`);
    }
    expect(css).not.toMatch(/#0f766e|#115e59|#ccfbf1|#5eead4/i);
  });

  it("keeps compact controls and record surfaces across routes", () => {
    expect(theme).toContain("--radius-card: 0.875rem");
    expect(theme).toContain("--radius-control: 0.5rem");
    expect(css).not.toMatch(/letter-spacing:\s*-/);
    expect(css).not.toMatch(/\.card-elevated:hover/);
  });
});
