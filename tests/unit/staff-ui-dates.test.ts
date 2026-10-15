import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ requireClinicStaff: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: stubs.requireClinicStaff }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }), notFound: () => { throw new Error("not found"); } }));

import { CertificatesPanel } from "@/app/clinic/[clinicId]/children/[childId]/certificates";

// 07:30 in Manila on 2 Oct is 23:30Z on 1 Oct: slicing the ISO string would show the wrong day.
const EARLY_MORNING = "2026-10-01T23:30:00Z";

describe("timestamps are shown on the clinic's calendar day", () => {
  it("certificate issue date", () => {
    const html = renderToStaticMarkup(
      createElement(CertificatesPanel, {
        clinicId: "c",
        childId: "k",
        canIssue: false,
        clinicTimezone: "Asia/Manila",
        certificates: [{ id: "11111111-1111-1111-1111-111111111111", certificateNo: "CERT-1", status: "issued", reviewNeeded: false, issuedAt: EARLY_MORNING, replacesNo: null, entryCount: 2, hasDocument: true, revokedAt: null, revocationReason: null }],
      }),
    );
    expect(html).toContain("issued 2 Oct 2026");
    // Download is a button that fetches (inline error on failure), not a link that navigates to JSON.
    expect(html).not.toContain('href="/api/v1/certificates/');
    expect(html).toContain("Download PDF");
  });

  it("stock transfer sent date", async () => {
    const transfer = { id: "t", sentBy: "x", reference: "TR-1", status: "in_transit", fromClinic: "North", toClinic: "Here", lot: "L1", product: "BCG", stockUnit: "vials", expiresOn: "2027-01-01", quantitySent: "5", quantityReceived: null, shortfall: null, sentAt: EARLY_MORNING, note: null, resolutionNote: null };
    stubs.requireClinicStaff.mockResolvedValue({
      membership: { capabilities: ["inventory.manage"], clinicTimezone: "Asia/Manila" },
      ctx: { profileId: "me" },
      rpc: { rpc: (name: string) => Promise.resolve(name === "list_stock_transfers" ? { outgoing: [], incoming: [transfer], clinics: [] } : { locations: [], lots: [] }) },
    });
    const { default: Transfers } = await import("@/app/clinic/[clinicId]/inventory/transfers/page");
    const html = renderToStaticMarkup(await Transfers({ params: Promise.resolve({ clinicId: "c" }) }));
    expect(html).toContain("sent 2 Oct 2026");
  });
});

describe("report export", () => {
  it("is a fetch-to-blob button, not a navigating link", async () => {
    stubs.requireClinicStaff.mockResolvedValue({
      membership: { capabilities: ["report.run"], clinicTimezone: "Asia/Manila" },
      rpc: { rpc: (name: string) => Promise.resolve(name === "report_backlog" ? null : { rows: [], asOf: EARLY_MORNING, definitions: { version: "1", terms: {} } }) },
    });
    const { default: Reports } = await import("@/app/clinic/[clinicId]/reports/page");
    const html = renderToStaticMarkup(await Reports({ params: Promise.resolve({ clinicId: "c" }), searchParams: Promise.resolve({ from: "2026-09-01", to: "2026-09-30" }) }));
    expect(html).toContain("Download CSV");
    expect(html).not.toMatch(/<a[^>]*\/export\?/);
  });

  it("starts independent report reads together", async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    stubs.requireClinicStaff.mockResolvedValue({
      membership: { capabilities: ["report.run"], clinicTimezone: "Asia/Manila" },
      rpc: { rpc: (name: string) => { started.push(name); return gate.then(() => (name === "report_backlog" ? null : { rows: [], asOf: EARLY_MORNING, definitions: { version: "1", terms: {} } })); } },
    });
    const { default: Reports } = await import("@/app/clinic/[clinicId]/reports/page");
    const page = Reports({ params: Promise.resolve({ clinicId: "c" }), searchParams: Promise.resolve({}) });
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toContain("report_backlog");
    expect(started.length).toBeGreaterThanOrEqual(2);
    release();
    await page;
  });
});
