import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "../../src/lib/reports/csv";

describe("CSV export (BP27)", () => {
  it("neutralises spreadsheet formulas", () => {
    for (const bad of ["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\tx", "\rx"]) expect(csvCell(bad).replace(/^"/, "")).toMatch(/^'/);
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell(-5)).toBe("-5"); // real negative numbers are not text
  });
  it("quotes commas, quotes and newlines, and writes withheld cells as text, never zero", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    const out = toCsv([{ n: null, p: "x" }, { n: 0, p: "y" }], [{ key: "p", label: "Product" }, { key: "n", label: "Count" }], { withheldText: "withheld" });
    expect(out).toBe("﻿Product,Count\r\nx,withheld\r\ny,0\r\n");
  });
});
