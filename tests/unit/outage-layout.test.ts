import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/app/clinic/[clinicId]/outage-forms/page.tsx", "utf8");

describe("outage paper previews", () => {
  it("contains each wide table in a keyboard-accessible scroll region", () => {
    expect(source.match(/tabIndex=\{0\}/g)).toHaveLength(3);
    expect(source.match(/overflow-x-auto/g)).toHaveLength(3);
    expect(source.match(/print:overflow-visible/g)).toHaveLength(3);
  });

  it("preserves white paper and dark ink independently of the application theme", () => {
    expect(source.match(/bg-white text-black/g)).toHaveLength(3);
    expect(source.match(/print:min-w-0/g)).toHaveLength(3);
  });
});
