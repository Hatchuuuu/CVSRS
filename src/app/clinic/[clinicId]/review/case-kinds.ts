/**
 * Decides how a review case is shown. Kinds mirror `record_review_cases_kind_check` (latest: 0012_visits.sql).
 * One kind can come from several producers, so `stock` cases are told apart by the shape of their evidence.
 */
export const REVIEW_CASE_KINDS = ["duplicate", "link", "identity_edit", "correction", "clinical", "stock", "sync", "appointment"] as const;
export type ReviewCaseKind = (typeof REVIEW_CASE_KINDS)[number];

/** `list_review_cases` returns at most this many open cases, oldest first. */
export const REVIEW_QUEUE_LIMIT = 50;

export type StockCaseShape = "count" | "transfer_shortfall" | "exception_stock" | "unknown";

const present = (v: unknown) => v !== undefined && v !== null && v !== "";

/**
 * - count: `adjust_stock` parked a count above the auto-approve threshold (`observed`, `book`, `delta`, `countReference`).
 * - transfer_shortfall: `receive_stock_transfer` found fewer units than were sent (`transferId`, `sent`, `received`).
 * - exception_stock: care was recorded as an exception and no stock issue could be posted (`eventId`, `lotId`, `problems`).
 * Only a count can be approved as an adjustment; the others are decided elsewhere.
 */
export function classifyStockCase(evidence: Record<string, unknown> | null | undefined): StockCaseShape {
  if (!evidence) return "unknown";
  if (present(evidence.observed)) return "count";
  if (present(evidence.transferId)) return "transfer_shortfall";
  if (present(evidence.eventId) || Array.isArray(evidence.problems) || present(evidence.lotId)) return "exception_stock";
  return "unknown";
}

export type CaseRenderer =
  | "link"
  | "duplicate"
  | "identity_edit"
  | "correction"
  | "clinical_exception"
  | "clinical_reported"
  | "stock_count"
  | "stock_transfer"
  | "stock_exception"
  | "appointment"
  | "generic";

export function caseRenderer(c: { kind: string; evidence: Record<string, unknown> | null | undefined }): CaseRenderer {
  switch (c.kind) {
    case "link":
    case "duplicate":
    case "identity_edit":
    case "correction":
    case "appointment":
      return c.kind;
    case "clinical":
      return c.evidence?.exception === true ? "clinical_exception" : "clinical_reported";
    case "stock": {
      const shape = classifyStockCase(c.evidence);
      return shape === "count" ? "stock_count" : shape === "transfer_shortfall" ? "stock_transfer" : shape === "exception_stock" ? "stock_exception" : "generic";
    }
    default:
      return "generic";
  }
}

const TITLES: Record<CaseRenderer, string> = {
  link: "Guardian link request",
  duplicate: "Possible duplicate record",
  identity_edit: "Guardian edit request",
  correction: "Correction to a vaccination record",
  clinical_exception: "Vaccination record to review",
  clinical_reported: "Vaccination record to review",
  stock_count: "Stock count difference",
  stock_transfer: "Transfer arrived short",
  stock_exception: "Stock not deducted for care given",
  appointment: "Booking affected by a closed session",
  generic: "Item to review",
};

export const caseTitle = (renderer: CaseRenderer) => TITLES[renderer];

/** The queue reads one page, oldest first. Say so when the page is full, so newer cases are not assumed absent. */
export function queueCapNotice(count: number, limit = REVIEW_QUEUE_LIMIT): string | null {
  return count >= limit ? `Showing the oldest ${limit} open cases. Newer cases appear here as these are closed.` : null;
}

/** A stock quantity from evidence (jsonb number or numeric string), or null when it was not recorded. */
export function quantity(v: unknown): string | null {
  if (typeof v !== "number" && typeof v !== "string") return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("en-PH", { maximumFractionDigits: 4 }) : null;
}

/** A text value from evidence, or null. Never turns objects or missing values into display text. */
export function textOf(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
