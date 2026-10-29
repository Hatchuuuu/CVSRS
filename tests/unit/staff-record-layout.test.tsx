import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ caps: ["child.search", "child.register", "bhw.followup"], rpc: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: async () => ({ rpc: { rpc: state.rpc }, membership: { capabilities: state.caps, clinicTimezone: "Asia/Manila" }, ctx: { profileId: "staff" } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), notFound: () => { throw new Error("not found"); } }));
import ChildPage from "@/app/clinic/[clinicId]/children/[childId]/page";
const childId = "11111111-1111-4111-8111-111111111111";
const page = () => ChildPage({ params: Promise.resolve({ clinicId: "clinic", childId }) });
beforeEach(() => {
  state.caps = ["child.search", "child.register", "bhw.followup"];
  state.rpc.mockReset();
  state.rpc.mockImplementation(async (name: string) => {
    if (name === "staff_get_child") return { childId, displayName: "Test Child", localRecordNo: "CV-1", dobPrecision: "unknown", sex: "not_recorded", recordStatus: "provisional", version: 1, guardians: [{ relationshipId: "guardian", name: "Test Guardian", relationship: "aunt_uncle", status: "provisional", hasAccount: true }] };
    if (name === "get_open_encounter") return null;
    if (name === "evaluate_child") return { status: "no_active_schedule" };
    if (name === "list_stock") return { lots: [], locations: [] };
    if (name === "list_record_transfers") return { clinics: [] };
    return [];
  });
});

it("places record actions and guardians ahead of notes, with a quiet correction disclosure", async () => {
  const html = renderToStaticMarkup(await page());
  const order = ["a-h", "g-h", "notes-h", "e-h"].map(id => html.indexOf(`id="${id}"`));
  expect(order.every(index => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(html).toContain('aria-label="Child record sections"');
  expect(html).toContain("Edit identity details");
  expect(html).not.toContain("Child medical profile");
});

it("explains the guardian permission without exposing clinical sections or verification controls", async () => {
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("Confirm child identity");
  expect(html).toContain("Guardian verification requires an authorized staff member");
  expect(html).not.toContain(">Verify this guardian</button>");
  for (const id of ["sch-h", "his-h", "give-h", "n-h"]) {
    expect(html).not.toContain(`id="${id}"`);
    expect(html).not.toContain(`href="#${id}"`);
  }
  expect(state.rpc.mock.calls.some(([name]) => name === "list_child_history")).toBe(false);
});

it("retains authorized verification and clinical workflows with valid section shortcuts", async () => {
  state.caps.push("guardian.verify", "child.read_clinical", "vaccination.record", "appointment.manage");
  const html = renderToStaticMarkup(await page());
  expect(html).toContain(">Verify this guardian</button>");
  for (const id of ["a-h", "g-h", "sch-h", "his-h", "notes-h", "e-h"]) {
    expect(html).toContain(`href="#${id}"`);
    expect(html).toContain(`id="${id}"`);
  }
  expect(html).toContain("Give a vaccine");
  expect(html.indexOf('href="#vis-h"')).toBeLessThan(html.indexOf('href="#his-h"'));
});
