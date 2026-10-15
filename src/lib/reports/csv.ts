/** CSV for spreadsheet users. Cells that a spreadsheet would run as a formula are neutralised (BP27). */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export interface Column {
  key: string;
  label: string;
}

/** Withheld (suppressed) cells are written as "withheld", never as zero. */
export function toCsv(rows: Record<string, unknown>[], columns: Column[], opts: { withheldText?: string } = {}): string {
  const head = columns.map((c) => csvCell(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => (r[c.key] === null && opts.withheldText ? csvCell(opts.withheldText) : csvCell(r[c.key]))).join(","));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n";
}
