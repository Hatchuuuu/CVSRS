import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ requireClinicStaff: vi.fn(), requireViewer: vi.fn(), getViewer: vi.fn() }));
vi.mock("@/lib/server/viewer", () => stubs);
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); }, useRouter: () => ({ refresh() {} }) }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An RPC stub that holds every read open until released, so a test can see which reads were started together. */
function gatedRpc(results: (name: string) => unknown, immediate: string[] = []) {
  const started: string[] = [];
  const waiting: (() => void)[] = [];
  const rpc = (name: string) => {
    started.push(name);
    if (immediate.includes(name)) return Promise.resolve(results(name));
    return new Promise((resolve) => waiting.push(() => resolve(results(name))));
  };
  return { rpc, started, release: () => waiting.splice(0).forEach((go) => go()) };
}

beforeEach(() => vi.clearAllMocks());

describe("clinic child record loads in two stages", () => {
  const allCaps = ["child.search", "child.read_clinical", "evidence.verify", "vaccination.record", "guardian.verify", "certificate.issue"];
  const reads = ["evaluate_child", "list_child_history", "list_active_products", "get_open_encounter", "list_stock", "list_child_guardian_contacts", "list_catchup_plans", "list_clinical_holds", "list_record_transfers", "list_child_certificates", "list_child_notes", "staff_list_card_submissions"];
  const child = { childId: "child", displayName: "Fictional Child", localRecordNo: "TEST", dobPrecision: "unknown", sex: "not_recorded", recordStatus: "active", guardians: [] };
  function result(name: string) {
    if (name === "staff_get_child") return child;
    if (name === "evaluate_child") return { status: "no_active_schedule" };
    if (name === "get_open_encounter") return null;
    if (name === "list_stock") return { locations: [], lots: [] };
    if (name === "list_record_transfers") return { clinics: [] };
    return [];
  }
  async function open(caps: string[]) {
    const g = gatedRpc(result, ["staff_get_child"]);
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: caps, clinicTimezone: "Asia/Manila" }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    const { default: ChildPage } = await import("@/app/clinic/[clinicId]/children/[childId]/page");
    const page = ChildPage({ params: Promise.resolve({ clinicId: "clinic", childId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) });
    await flush();
    return { g, page };
  }

  it("starts every independent read together once the child is found", async () => {
    const { g, page } = await open(allCaps);
    expect(g.started[0]).toBe("staff_get_child");
    expect([...g.started.slice(1)].sort()).toEqual([...reads].sort());
    g.release();
    await expect(page).resolves.toBeTruthy();
  });

  it("keeps each read behind its capability", async () => {
    const { g, page } = await open(["child.search", "child.read_clinical"]);
    expect([...g.started].sort()).toEqual(["evaluate_child", "list_catchup_plans", "list_child_history", "list_child_notes", "list_clinical_holds", "staff_get_child", "staff_list_card_submissions"]);
    g.release();
    await page;
  });

  it("reads nothing else when the child is not visible", async () => {
    const g = gatedRpc(() => null, ["staff_get_child"]);
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: allCaps, clinicTimezone: "Asia/Manila" }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    const { default: ChildPage } = await import("@/app/clinic/[clinicId]/children/[childId]/page");
    await expect(ChildPage({ params: Promise.resolve({ clinicId: "clinic", childId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) })).rejects.toThrow("not found");
    expect(g.started).toEqual(["staff_get_child"]);
  });

  it("treats a mistyped record address as not found without asking the database", async () => {
    const g = gatedRpc(() => null);
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: allCaps, clinicTimezone: "Asia/Manila" }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    const { default: ChildPage } = await import("@/app/clinic/[clinicId]/children/[childId]/page");
    await expect(ChildPage({ params: Promise.resolve({ clinicId: "clinic", childId: "not-a-uuid" }) })).rejects.toThrow("not found");
    const { default: ScheduleVersion } = await import("@/app/clinic/[clinicId]/clinical/schedules/[versionId]/page");
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: ["rules.approve"], clinicTimezone: "Asia/Manila" }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    await expect(ScheduleVersion({ params: Promise.resolve({ clinicId: "clinic", versionId: "not-a-uuid" }) })).rejects.toThrow("not found");
    expect(g.started).toEqual([]);
  });
});

describe("clinical setup pages read in parallel", () => {
  it("loads the clinical master and the privacy notice together", async () => {
    const g = gatedRpc((name) => (name === "list_clinical_master" ? { demoMode: false, antigens: [], products: [], schedules: [] } : { configured: false }));
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: ["admin.config", "rules.approve"] }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    const { default: ClinicalConfig } = await import("@/app/clinic/[clinicId]/clinical/page");
    const page = ClinicalConfig({ params: Promise.resolve({ clinicId: "clinic" }) });
    await flush();
    expect([...g.started].sort()).toEqual(["get_privacy_notice", "list_clinical_master"]);
    g.release();
    await expect(page).resolves.toBeTruthy();
  });

  it("does not read the privacy notice without admin.config", async () => {
    const g = gatedRpc(() => ({ demoMode: false, antigens: [], products: [], schedules: [] }));
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: ["rules.approve"] }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    const { default: ClinicalConfig } = await import("@/app/clinic/[clinicId]/clinical/page");
    const page = ClinicalConfig({ params: Promise.resolve({ clinicId: "clinic" }) });
    await flush();
    expect(g.started).toEqual(["list_clinical_master"]);
    g.release();
    await page;
  });

  it("loads a schedule version and its impact together", async () => {
    const version = { id: "v", program: "P", label: "L", status: "draft", isDemo: false, source: "S", effectiveFrom: null, effectiveTo: null, proposedBy: null, approvedBy: null, cohort: {}, rules: [], fixtures: [] };
    const g = gatedRpc((name) => (name === "get_schedule_version" ? version : { cohortChildren: 0, childrenOnAnotherVersion: 0 }));
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: ["rules.approve"] }, ctx: { profileId: "staff" }, rpc: { rpc: g.rpc } });
    const { default: ScheduleVersion } = await import("@/app/clinic/[clinicId]/clinical/schedules/[versionId]/page");
    const page = ScheduleVersion({ params: Promise.resolve({ clinicId: "clinic", versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) });
    await flush();
    expect([...g.started].sort()).toEqual(["get_schedule_version", "preview_schedule_impact"]);
    g.release();
    await expect(page).resolves.toBeTruthy();
  });

  it("still shows the unavailable page for an unknown schedule version", async () => {
    stubs.requireClinicStaff.mockResolvedValue({ membership: { capabilities: ["rules.approve"] }, ctx: { profileId: "staff" }, rpc: { rpc: (name: string) => (name === "get_schedule_version" ? Promise.resolve(null) : Promise.reject(new Error("impact unavailable"))) } });
    const { default: ScheduleVersion } = await import("@/app/clinic/[clinicId]/clinical/schedules/[versionId]/page");
    await expect(ScheduleVersion({ params: Promise.resolve({ clinicId: "clinic", versionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }) })).rejects.toThrow("not found");
  });
});

describe("child registration privacy notices", () => {
  it("lets a failed batch notice read reach the error boundary with no per-clinic fallback", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "my_children") return Promise.resolve([]);
      if (name === "list_public_clinics") return Promise.resolve([{ id: "a", name: "A" }, { id: "b", name: "B" }]);
      if (name === "get_pending_privacy_notices") return Promise.reject(new Error("notices unavailable"));
      return Promise.resolve({ configured: false, acknowledged: true });
    });
    stubs.requireViewer.mockResolvedValue({ rpc: { rpc } });
    const { default: MyChildren } = await import("@/app/children/register/page");
    await expect(MyChildren()).rejects.toThrow("notices unavailable");
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain("get_privacy_notice");
  });

  it("makes one privacy read per page load", async () => {
    const rpc = vi.fn((name: string) => Promise.resolve(name === "list_public_clinics" ? [{ id: "a", name: "A" }] : []));
    stubs.requireViewer.mockResolvedValue({ rpc: { rpc } });
    const { default: MyChildren } = await import("@/app/children/register/page");
    await MyChildren();
    expect(rpc.mock.calls.map(([name]) => name).sort()).toEqual(["get_pending_privacy_notices", "list_public_clinics"]);
  });
});
