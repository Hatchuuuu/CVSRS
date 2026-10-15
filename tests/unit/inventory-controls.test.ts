import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const stubs = vi.hoisted(() => ({ requireClinicStaff: vi.fn(), getConfig: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: stubs.requireClinicStaff }));
vi.mock("@/lib/env", async (original) => ({ ...(await original<typeof import("@/lib/env")>()), getConfig: stubs.getConfig }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), notFound: () => { throw new Error("not found"); } }));

describe("available controls match inventory and authentication contracts", () => {
  beforeEach(() => vi.clearAllMocks());
  const stock = { asOf: "2026-10-01", locations: [{ id: "store", name: "Fridge", kind: "usable", status: "active" }], lots: [{ lotId: "recalled", lot: "RECALLED-LOT", product: "Demo", productCode: "D", stockUnit: "vials", expiresOn: "2027-01-01", disposition: "recalled", expired: false, physicalOnHand: "5", usable: "0", locations: [] }] };
  function viewer(capabilities: string[]) {
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities }, rpc: { rpc: (name: string) => Promise.resolve(name === "list_stock" ? stock : [{ id: "product", name: "Demo", code: "D" }]) } });
  }
  it("allows recalled lots to be counted and discarded without receiving more", async () => {
    viewer(["inventory.manage"]);
    const { default: Inventory } = await import("@/app/clinic/[clinicId]/inventory/page");
    const html = renderToStaticMarkup(await Inventory({ params: Promise.resolve({ clinicId: "clinic" }) }));
    expect(html.match(/value="recalled"/g)).toHaveLength(2);
  });
  it("does not offer restricted stock tabs to vaccination staff", async () => {
    viewer(["vaccination.record"]);
    const { default: Inventory } = await import("@/app/clinic/[clinicId]/inventory/page");
    const html = renderToStaticMarkup(await Inventory({ params: Promise.resolve({ clinicId: "clinic" }) }));
    expect(html).not.toContain('href="/clinic/clinic/inventory/transfers"');
    expect(html).not.toContain('href="/clinic/clinic/inventory/cold-chain"');
  });
  it("shows the product's stock unit when sending a transfer", async () => {
    const transferStock = { ...stock, lots: [{ ...stock.lots[0], disposition: "usable", usable: "5", stockUnit: "doses" }] };
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: ["inventory.manage"] }, ctx: { profileId: "staff" }, rpc: { rpc: (name: string) => Promise.resolve(name === "list_stock" ? transferStock : { incoming: [], outgoing: [], clinics: [{ id: "destination", name: "North" }] }) } });
    const { default: Transfers } = await import("@/app/clinic/[clinicId]/inventory/transfers/page");
    const html = renderToStaticMarkup(await Transfers({ params: Promise.resolve({ clinicId: "clinic" }) }));
    expect(html).toContain("5 doses usable");
    expect(html).toContain("Quantity (stock units)");
    expect(html).not.toContain("Quantity (vials)");
  });
  it("offers the new-password form when connected to the sign-in service, and says so honestly when not", async () => {
    const { default: ResetPassword } = await import("@/app/account/reset-password/page");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_xxxxxxxxxxxxxxxxxxxx");
    stubs.getConfig.mockImplementation(() => ({ mode: "supabase" }));
    expect(renderToStaticMarkup(await ResetPassword())).toContain('type="password"');
    const { ConfigError } = await import("@/lib/env");
    stubs.getConfig.mockImplementation(() => { throw new ConfigError("Service is not configured", "unconfigured"); });
    const html = renderToStaticMarkup(await ResetPassword());
    expect(html).toContain("Sign-in is unavailable here right now.");
    expect(html).not.toContain('type="password"');
    vi.unstubAllEnvs();
  });

});

describe("lot trace lists this clinic's children and only counts other clinics (RV2-C-01)", () => {
  // Shape returned by trace_lot_use since 0034: per-child entries for this clinic, then one summary per other clinic.
  const mixed = [
    { scope: "this_clinic", eventId: "e1", childId: "k1", childName: "Ana Cruz", recordNo: "CV-0001", administeredOn: "2026-09-30", status: "verified", eventStatus: "active", source: "clinic_administered", revisionNo: 1, clinicId: "c1" },
    { scope: "this_clinic", eventId: "e2", childId: "k2", childName: "Ben Reyes", recordNo: "CV-0002", administeredOn: "2026-09-29", status: "pending_review", eventStatus: "voided", source: "clinic_administered", revisionNo: 2, clinicId: "c1" },
    { scope: "other_clinic", clinicId: "c2", clinicName: "North Health Centre", records: 3 },
    { scope: "other_clinic", clinicId: "c3", clinicName: null, records: 1 },
  ];

  it("renders both entry types without throwing or printing undefined", async () => {
    const { LotTraceList } = await import("@/app/clinic/[clinicId]/inventory/forms");
    const html = renderToStaticMarkup(LotTraceList({ trace: mixed as never }));
    expect(html).toContain("Ana Cruz");
    expect(html).toContain("CV-0001");
    expect(html).toContain("verified");
    expect(html).toContain("voided");
    expect(html).toMatch(/3 doses from this lot were recorded at North Health Centre/);
    expect(html).toMatch(/1 dose from this lot was recorded at another clinic/);
    expect(html).not.toMatch(/undefined|null|NaN/);
  });

  it("names no child for another clinic's entries", async () => {
    const { LotTraceList } = await import("@/app/clinic/[clinicId]/inventory/forms");
    const html = renderToStaticMarkup(LotTraceList({ trace: [mixed[2]] as never }));
    expect(html).not.toContain("<strong>");
    expect(html).not.toContain("No child has a recorded dose");
  });

  it("says when nobody received the lot", async () => {
    const { LotTraceList } = await import("@/app/clinic/[clinicId]/inventory/forms");
    expect(renderToStaticMarkup(LotTraceList({ trace: [] }))).toContain("No child has a recorded dose from this lot.");
  });
});
