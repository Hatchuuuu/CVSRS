import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
const palette = (selector: string) => Object.fromEntries(Array.from(css.match(new RegExp(`${selector}\\s*\\{([^}]+)`))![1]!.matchAll(/--color-([\w-]+):\s*(#[0-9a-f]{6})/gi), (match) => [match[1], match[2]])) as Record<string, string>;
const luminance = (hex: string) => {
  const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
};
const ratio = (first: string, second: string) => (Math.max(luminance(first), luminance(second)) + 0.05) / (Math.min(luminance(first), luminance(second)) + 0.05);

describe("semantic palette contrast contracts", () => {
  for (const [theme, values] of [["light", palette("@theme")], ["dark", palette("\\.dark")]] as const) {
    it(`${theme} text and status pairs meet minimum text contrast`, () => {
      for (const [foreground, background] of [["ink", "surface"], ["ink-soft", "canvas"], ["on-primary", "primary"], ["success", "success-bg"], ["attention", "attention-bg"], ["danger", "danger-bg"], ["review", "review-bg"], ["info", "info-bg"]]) {
        expect(ratio(values[foreground!]!, values[background!]!), `${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme} field boundaries and focus indicator contrast with adjacent surfaces`, () => {
      for (const surface of ["surface", "canvas", "sunken"]) {
        expect(ratio(values["line-strong"]!, values[surface]!), `field/${surface}`).toBeGreaterThanOrEqual(3);
        expect(ratio(values.info!, values[surface]!), `focus/${surface}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});
