import type { RpcName } from "@/lib/db/port";
import type { Column } from "./csv";

export interface ReportDef {
  slug: string;
  title: string;
  lead: string;
  rpc: RpcName;
  /** The database's own name for the export audit record. */
  auditName: string;
  ranged: boolean;
  columns: Column[];
  /** Definition keys that explain the columns. */
  terms: string[];
}

export const REPORTS: ReportDef[] = [
  {
    slug: "daily-activity",
    title: "Daily activity",
    lead: "Bookings, arrivals, outcomes, vaccinations and certificates for each day.",
    rpc: "report_daily_activity",
    auditName: "daily_activity",
    ranged: true,
    columns: [
      { key: "date", label: "Date" },
      { key: "booked", label: "Booked" },
      { key: "cancelled", label: "Cancelled" },
      { key: "noShow", label: "No-show" },
      { key: "arrivals", label: "Arrivals" },
      { key: "walkIns", label: "Walk-ins" },
      { key: "completed", label: "Completed" },
      { key: "deferred", label: "Deferred" },
      { key: "left", label: "Left" },
      { key: "vaccinationsGiven", label: "Vaccinations given" },
      { key: "certificatesIssued", label: "Certificates issued" },
    ],
    terms: ["booked", "cancelled", "noShow", "arrivals", "walkIns", "completed", "deferred", "left", "vaccinationsGiven", "certificatesIssued"],
  },
  {
    slug: "vaccinations-by-product",
    title: "Vaccinations by product",
    lead: "How many vaccinations were given for each product in the period.",
    rpc: "report_vaccinations_by_product",
    auditName: "vaccinations_by_product",
    ranged: true,
    columns: [
      { key: "productCode", label: "Product code" },
      { key: "product", label: "Product" },
      { key: "count", label: "Vaccinations given" },
    ],
    terms: ["vaccinationsGiven"],
  },
  {
    slug: "stock-summary",
    title: "Stock summary",
    lead: "Vaccine movements by lot, with a check that the ledger and the shelf count agree.",
    rpc: "report_stock_summary",
    auditName: "stock_summary",
    ranged: true,
    columns: [
      { key: "productCode", label: "Product code" },
      { key: "product", label: "Product" },
      { key: "lot", label: "Lot" },
      { key: "expiresOn", label: "Expires" },
      { key: "disposition", label: "Status" },
      { key: "received", label: "Received" },
      { key: "issued", label: "Issued" },
      { key: "wastage", label: "Wastage" },
      { key: "adjustments", label: "Adjustments" },
      { key: "onHand", label: "On hand" },
      { key: "ledgerTotal", label: "Ledger total" },
      { key: "reconciles", label: "Agrees" },
    ],
    terms: ["received", "issued", "wastage", "adjustments", "onHand", "ledgerTotal"],
  },
  {
    slug: "paper-reconciliation",
    title: "Paper log check",
    lead: "Compare the paper log with what the system holds. Differences are explained, not edited.",
    rpc: "report_paper_reconciliation",
    auditName: "paper_reconciliation",
    ranged: true,
    columns: [
      { key: "date", label: "Date" },
      { key: "productCode", label: "Product code" },
      { key: "product", label: "Product" },
      { key: "paperCount", label: "Paper log" },
      { key: "systemCount", label: "System" },
      { key: "difference", label: "Difference" },
      { key: "status", label: "Status" },
      { key: "note", label: "Note" },
    ],
    terms: ["paperCount", "systemCount", "difference"],
  },
];

export const findReport = (slug: string) => REPORTS.find((r) => r.slug === slug);

/** Default period: the last 7 days in the clinic's local date. */
export function defaultRange(today: string): { from: string; to: string } {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 6);
  return { from: d.toISOString().slice(0, 10), to: today };
}
