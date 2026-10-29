import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: async () => ({ rpc: { rpc: stubs.rpc }, membership: { capabilities: ["audit.read"], clinicTimezone: "Asia/Manila" } }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
import Audit from "@/app/clinic/[clinicId]/audit/page";

const at = "2026-10-17T00:00:00.123456Z";
const id = "11111111-1111-4111-8111-111111111111";
const page = (filters: Record<string, string | string[]> = {}) => Audit({ params: Promise.resolve({ clinicId: "clinic" }), searchParams: Promise.resolve(filters) });
beforeEach(() => { stubs.rpc.mockReset(); stubs.rpc.mockResolvedValue({ rows: [], nextBefore: null, nextBeforeId: null }); });

describe("audit filter recovery", () => {
  it.each([
    [{ from: "2026-02-30" }, "Enter a valid start date"],
    [{ to: "yesterday" }, "Enter a valid end date"],
    [{ from: "0000-01-01" }, "Enter a valid start date"],
    [{ from: ["2026-10-01", "2026-10-02"] }, "Enter a valid start date"],
    [{ from: "2026-10-17", to: "2026-10-01" }, "The end date must be on or after the start date"],
    [{ action: "a".repeat(61) }, "Use no more than 60 characters"],
    [{ action: ["certificate.", "report."] }, "one action filter"],
  ])("refuses invalid filters rather than widening the search: %j", async (filters, message) => {
    const html = renderToStaticMarkup(await page(filters));
    expect(stubs.rpc).not.toHaveBeenCalled();
    expect(html).toContain(message);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("Clear filters");
    expect(html).not.toContain("Nothing matches");
  });

  it("keeps clinic-day boundaries and offers a reset for a valid filtered search", async () => {
    const html = renderToStaticMarkup(await page({ action: "certificate.", from: "2026-10-01", to: "2026-10-17" }));
    expect(stubs.rpc).toHaveBeenCalledWith("search_audit", expect.objectContaining({ p_action: "certificate.", p_from: "2026-09-30T16:00:00.000Z", p_to: "2026-10-17T15:59:59.999Z" }));
    expect(html).toContain('href="/clinic/clinic/audit"');
    expect(html).toContain("Clear filters");
  });

  it("offers the newest matching entries even when an older page is empty", async () => {
    const html = renderToStaticMarkup(await page({ action: "certificate.", from: "2026-10-01", before: at, beforeId: id }));
    expect(html).toContain("No older entries match");
    expect(html).toContain('aria-label="Audit pages"');
    expect(html).toMatch(/href="\/clinic\/clinic\/audit\?action=certificate\.&amp;from=2026-10-01"[^>]*>Newest entries/);
    expect(html).not.toContain(">Older entries</a>");
  });
});
