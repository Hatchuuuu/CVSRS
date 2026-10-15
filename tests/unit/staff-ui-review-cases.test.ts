import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), notFound: () => { throw new Error("not found"); } }));

import { caseRenderer, classifyStockCase, queueCapNotice, REVIEW_CASE_KINDS, REVIEW_QUEUE_LIMIT } from "@/app/clinic/[clinicId]/review/case-kinds";
import { CaseCard, MergeConfirm, type ReviewCase } from "@/app/clinic/[clinicId]/review/cases";

const COUNT = { locationId: "loc", lotId: "lot", book: 10, observed: 7, delta: -3, countReference: "SHEET-4", reason: "broken vial", operationKey: "k" };
const TRANSFER = { transferId: "transfer-1", sent: 5, received: 3 };
const EXCEPTION = { eventId: "event-1", lotId: null, reportedLot: "LOT-X", problems: ["lot_unknown", "stock_not_posted"] };

function reviewCase(kind: string, evidence: Record<string, unknown>, extra: Partial<ReviewCase> = {}): ReviewCase {
  return {
    caseId: `case-${kind}`,
    kind: kind as ReviewCase["kind"],
    status: "open",
    reason: "reason text",
    createdAt: "2026-10-01T00:00:00Z",
    evidence,
    childId: "child-1",
    eventId: "event-1",
    createdBy: "someone-else",
    candidateChildId: "child-2",
    child: { displayName: "Ana Cruz", localRecordNo: "R-1", dob: "2025-03-04" },
    candidate: { displayName: "Ana Cruz", localRecordNo: "R-2", dob: null },
    guardianName: "Maria Cruz",
    ...extra,
  };
}

function render(c: ReviewCase) {
  return renderToStaticMarkup(createElement(CaseCard, { clinicId: "c1", c, canVerify: true, canResolve: true, canEdit: true, canApproveStock: true, canApproveCorrection: true, myId: "me" }));
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ");

describe("stock review cases are classified by evidence shape", () => {
  it("recognises the three producers", () => {
    expect(classifyStockCase(COUNT)).toBe("count");
    expect(classifyStockCase(TRANSFER)).toBe("transfer_shortfall");
    expect(classifyStockCase(EXCEPTION)).toBe("exception_stock");
    expect(classifyStockCase({})).toBe("unknown");
    expect(classifyStockCase(null)).toBe("unknown");
  });

  it("offers approve only for a count proposal", () => {
    expect(render(reviewCase("stock", COUNT))).toContain("Approve and post the adjustment");
    for (const ev of [TRANSFER, EXCEPTION, {}]) expect(render(reviewCase("stock", ev))).not.toContain("Approve and post");
  });

  it("sends a short transfer to the transfers page with its sent and received facts", () => {
    const html = render(reviewCase("stock", TRANSFER, { childId: null, child: null }));
    expect(html).toContain('href="/clinic/c1/inventory/transfers"');
    expect(text(html)).toMatch(/5\b[\s\S]*sent[\s\S]*3\b[\s\S]*received|sent[\s\S]*5[\s\S]*received[\s\S]*3/);
  });

  it("shows exception stock facts and links to the record and the stock page", () => {
    const html = render(reviewCase("stock", EXCEPTION));
    expect(html).toContain('href="/clinic/c1/children/child-1"');
    expect(html).toContain('href="/clinic/c1/inventory"');
    expect(text(html)).toContain("LOT-X");
    expect(text(html)).toContain("the lot is not in the system");
  });
});

describe("every review case kind renders an actionable card without missing values", () => {
  it("lists exactly the kinds allowed by the latest record_review_cases_kind_check", () => {
    const sql = readFileSync("supabase/migrations/0012_visits.sql", "utf8");
    const allowed = /record_review_cases_kind_check check \(kind in \(([^)]*)\)\)/.exec(sql)![1]!.split(",").map((s) => s.trim().replace(/'/g, ""));
    expect([...REVIEW_CASE_KINDS].sort()).toEqual(allowed.sort());
  });

  const variants: [string, Record<string, unknown>][] = [
    ["link", { childName: "Ana", dob: "2025-03-04", relationship: "mother" }],
    ["duplicate", {}],
    ["identity_edit", { patch: { displayName: "Ana C." } }],
    ["correction", { kind: "correct_details", proposal: { lotText: "L1" } }],
    ["clinical", { exception: true, problems: ["lot_expired"], stockPosted: false }],
    ["clinical", { reportedProduct: "BCG", reportedDate: "2026-01-02" }],
    ["stock", COUNT],
    ["stock", TRANSFER],
    ["stock", EXCEPTION],
    ["stock", {}],
    ["sync", {}],
    ["appointment", { appointmentId: "a", sessionId: "s", serviceDate: "2026-10-05" }],
    ["future_kind", {}],
  ];
  for (const [kind, evidence] of variants) {
    for (const sparse of [false, true]) {
      it(`${kind} ${JSON.stringify(evidence).slice(0, 40)}${sparse ? " (sparse)" : ""}`, () => {
        const c = sparse ? reviewCase(kind, kind === "clinical" && evidence.exception ? { exception: true } : {}, { child: null, candidate: null, guardianName: null, reason: "" }) : reviewCase(kind, evidence);
        const html = render(c);
        expect(text(html)).not.toMatch(/\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]/);
        // Actionable: a control, or a link that leads to where the case is decided.
        expect(html).toMatch(/<button|<a /);
        expect(html).not.toMatch(/>\s*(future_kind|sync)\s*</);
      });
    }
  }

  it("lets a reviewer close a cancelled-session booking once the family is contacted", () => {
    const html = render(reviewCase("appointment", { appointmentId: "a", sessionId: "s", serviceDate: "2026-10-05" }));
    expect(html).toContain("Family contacted");
    expect(html).toContain("5 Oct 2026");
    expect(html).toContain('href="/clinic/c1/children/child-1"');
    expect(html).toMatch(/name="reason"[^>]*minLength="3"|minLength="3"[^>]*name="reason"/i);
  });

  it("selects a renderer for every allowed kind and a default for unknown kinds", () => {
    for (const kind of REVIEW_CASE_KINDS) expect(caseRenderer({ kind, evidence: {} })).toBeTruthy();
    expect(caseRenderer({ kind: "appointment", evidence: {} })).toBe("appointment");
    expect(caseRenderer({ kind: "sync", evidence: {} })).toBe("generic");
    expect(caseRenderer({ kind: "something_new", evidence: {} })).toBe("generic");
    expect(caseRenderer({ kind: "stock", evidence: TRANSFER })).toBe("stock_transfer");
  });
});

describe("review identity screens format dates of birth", () => {
  it("never shows a raw ISO birth date", () => {
    const dup = render(reviewCase("duplicate", {}));
    expect(dup).toContain("4 Mar 2025");
    expect(dup).toContain("DOB not recorded");
    expect(dup).not.toContain("2025-03-04");
    const link = render(reviewCase("link", { childName: "Ana", dob: "2025-03-04", relationship: "mother" }));
    expect(link).toContain("4 Mar 2025");
    expect(link).not.toContain("2025-03-04");
  });
});

describe("review queue cap", () => {
  it("says the list is the oldest page only when the limit is reached", () => {
    expect(REVIEW_QUEUE_LIMIT).toBe(50);
    expect(queueCapNotice(49)).toBeNull();
    expect(queueCapNotice(50)).toContain("oldest 50");
  });
});

describe("merge confirmation", () => {
  type Node = { type?: unknown; props?: { children?: unknown; onSubmit?: (e: unknown) => void; name?: string; required?: boolean; minLength?: number } };
  const nodes = (n: unknown): Node[] => {
    if (!n || typeof n !== "object") return [];
    const node = n as Node;
    return [node, ...[node.props?.children].flat().flatMap(nodes)];
  };
  it("requires a typed reason and sends it with the merge", () => {
    const onConfirm = vi.fn();
    const tree = MergeConfirm({ caseId: "k", keepNo: "R-1", mergeNo: "R-2", busy: false, onConfirm, onCancel: () => {} });
    const all = nodes(tree);
    const field = all.find((n) => n.props?.name === "reason");
    expect(field?.props?.required).toBe(true);
    expect(field?.props?.minLength).toBe(3);
    const form = all.find((n) => n.type === "form")!;
    vi.stubGlobal("FormData", class { get() { return "  Same mother, same birth record  "; } });
    form.props!.onSubmit!({ preventDefault() {}, currentTarget: {} });
    vi.unstubAllGlobals();
    expect(onConfirm).toHaveBeenCalledWith("Same mother, same birth record");
  });
});
