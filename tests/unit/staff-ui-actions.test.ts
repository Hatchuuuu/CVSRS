import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// Hooks are replaced so components can be called as plain functions and their element trees inspected.
// `stub.pick` decides each useState initial value (to open a confirm step); `stub.setState` records requested changes.
const stub = vi.hoisted(() => ({
  run: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
  setState: vi.fn(),
  pick: (initial: unknown) => initial,
  state: { phase: "idle" } as unknown,
}));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useState: (initial: unknown) => [stub.pick(typeof initial === "function" ? (initial as () => unknown)() : initial), stub.setState] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stub.refresh, push: stub.push }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: stub.state, run: stub.run, reset: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,AA") } }));
// The shared focus hook is replaced by sentinels so each flow's wiring (trigger ref, group, safe control) can be checked.
const step = vi.hoisted(() => ({ triggerRef: { current: null }, groupRef: { current: null }, calls: [] as unknown[][] }));
vi.mock("@/components/confirm-step", () => ({
  useConfirmStep: (...args: unknown[]) => {
    step.calls.push(args);
    return { triggerRef: step.triggerRef, groupProps: { ref: step.groupRef, role: "group" }, textProps: { id: "consequence" }, cancelProps: { "data-autofocus": true, "aria-describedby": "consequence" } };
  },
}));

type Props = { children?: ReactNode; onSubmit?: (event: unknown) => unknown; onClick?: () => unknown; name?: string; ref?: unknown; id?: string; type?: string; replacesId?: string; "data-autofocus"?: boolean; "aria-label"?: string };
type Node = ReactElement<Props>;
function nodes(node: unknown): Node[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Node;
  return [n, ...[n.props?.children].flat().flatMap((child) => nodes(child))];
}
const label = (n: Node): string => [n.props?.children].flat().map((c) => (typeof c === "string" ? c : c && typeof c === "object" ? label(c as Node) : "")).join("");
const button = (tree: unknown, text: RegExp) => nodes(tree).find((n) => typeof n.props?.onClick === "function" && text.test(label(n)));
const form = (tree: unknown) => nodes(tree).find((n) => n.type === "form")!;
function submitWith(tree: unknown, data: Record<string, string>) {
  vi.stubGlobal("FormData", class { get(key: string) { return data[key] ?? null; } });
  const result = form(tree).props.onSubmit!({ preventDefault() {}, currentTarget: {} });
  vi.unstubAllGlobals();
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  step.calls = [];
  stub.pick = (initial) => initial;
  stub.state = { phase: "idle" };
  stub.run.mockResolvedValue({ ok: true, data: { token: "t", mismatches: [], repaired: false } });
});

describe("consequential actions ask for a second, explicit confirmation", () => {
  it("guardian QR pass: the first click only opens the confirmation", async () => {
    const { QrPanel } = await import("@/app/children/forms");
    const tree = QrPanel({ childId: "kid", childName: "Ana" });
    await button(tree, /QR pass/)!.props.onClick!();
    expect(stub.run).not.toHaveBeenCalled();
    expect(stub.setState).toHaveBeenCalledWith(true);
  });

  it("guardian QR pass: the confirmation states the consequence and then issues", async () => {
    stub.pick = (initial) => (initial === false ? true : initial);
    const { QrPanel } = await import("@/app/children/forms");
    const tree = QrPanel({ childId: "kid", childName: "Ana" });
    expect(nodes(tree).map(label).join(" ")).toMatch(/stops working/);
    await button(tree, /^Yes/)!.props.onClick!();
    expect(stub.run).toHaveBeenCalledTimes(1);
  });

  it("staff replacement QR pass waits for confirmation", async () => {
    const { StaffQr } = await import("@/app/clinic/[clinicId]/children/[childId]/actions");
    const tree = StaffQr({ clinicId: "c", childId: "kid", childName: "Ana" });
    await button(tree, /QR pass/)!.props.onClick!();
    expect(stub.run).not.toHaveBeenCalled();
    stub.pick = (initial) => (initial === false ? true : initial);
    const open = StaffQr({ clinicId: "c", childId: "kid", childName: "Ana" });
    expect(nodes(open).map(label).join(" ")).toMatch(/stops working/);
    await button(open, /^Yes/)!.props.onClick!();
    expect(stub.run).toHaveBeenCalledTimes(1);
  });

  it("a clinic time zone change is confirmed; other profile edits save directly", async () => {
    const { ProfileForm } = await import("@/app/clinic/[clinicId]/settings/forms");
    const profile = { name: "Clinic", address: "", contact: null, hours: null, timezone: "Asia/Manila" };
    await submitWith(ProfileForm({ clinicId: "c", profile }), { name: "Clinic", timezone: "UTC" });
    expect(stub.run).not.toHaveBeenCalled();
    expect(stub.setState).toHaveBeenCalledWith(expect.objectContaining({ timezone: "UTC" }));
    await submitWith(ProfileForm({ clinicId: "c", profile }), { name: "Clinic 2", timezone: "Asia/Manila" });
    expect(stub.run).toHaveBeenCalledWith(expect.objectContaining({ name: "Clinic 2", timezone: "Asia/Manila" }));
  });

  it("a confirmed time zone change saves the values that were entered", async () => {
    const values = { name: "Clinic", timezone: "UTC" };
    stub.pick = (initial) => (initial === null ? values : initial);
    const { ProfileForm } = await import("@/app/clinic/[clinicId]/settings/forms");
    const tree = ProfileForm({ clinicId: "c", profile: { name: "Clinic", address: "", contact: null, hours: null, timezone: "Asia/Manila" } });
    expect(nodes(tree).map(label).join(" ")).toMatch(/Asia\/Manila[\s\S]*UTC/);
    await button(tree, /^Yes/)!.props.onClick!();
    expect(stub.run).toHaveBeenCalledWith(values);
  });

  it("retiring the active schedule needs confirmation", async () => {
    const { ScheduleActions } = await import("@/app/clinic/[clinicId]/clinical/schedules/[versionId]/schedule-actions");
    const props = { clinicId: "c", versionId: "v", status: "active", canPropose: false, canApprove: true, isProposer: false };
    await submitWith(ScheduleActions(props), { reason: "Replaced by 2027 schedule" });
    expect(stub.run).not.toHaveBeenCalled();
    expect(stub.setState).toHaveBeenCalledWith("Replaced by 2027 schedule");
    stub.pick = (initial) => (initial === null ? "Replaced by 2027 schedule" : initial);
    const open = ScheduleActions(props);
    expect(nodes(open).map(label).join(" ")).toMatch(/cannot be activated again/);
    await button(open, /^Yes, retire/)!.props.onClick!();
    expect(stub.run).toHaveBeenCalledWith({ reason: "Replaced by 2027 schedule" });
  });

  it("releasing a record needs confirmation; plain transfer buttons do not", async () => {
    const { TransferButton } = await import("@/app/clinic/[clinicId]/transfers/forms");
    const confirm = { text: "Release Ana's record to North?", yes: "Yes, release the record", no: "Not now" };
    await button(TransferButton({ label: "Release the record", path: "/p", confirm }), /Release the record/)!.props.onClick!();
    expect(stub.run).not.toHaveBeenCalled();
    await button(TransferButton({ label: "Accept and take over the record", path: "/p" }), /Accept/)!.props.onClick!();
    expect(stub.run).toHaveBeenCalledTimes(1);
  });

  it("repairing stock balances needs confirmation; checking does not", async () => {
    const { ReconcilePanel } = await import("@/app/clinic/[clinicId]/inventory/forms");
    const tree = ReconcilePanel({ clinicId: "c" });
    await button(tree, /Check and repair/)!.props.onClick!();
    expect(stub.run).not.toHaveBeenCalled();
    await button(tree, /^Check$/)!.props.onClick!();
    expect(stub.run).toHaveBeenCalledWith({ repair: false });
  });
});

describe("confirm steps keep keyboard focus: every flow wires the shared step (RV1-01)", () => {
  const open = (initial: unknown) => (initial === false ? true : initial === null ? { name: "Clinic", timezone: "UTC" } : initial);
  async function flows() {
    const { QrPanel } = await import("@/app/children/forms");
    const { StaffQr } = await import("@/app/clinic/[clinicId]/children/[childId]/actions");
    const { ProfileForm } = await import("@/app/clinic/[clinicId]/settings/forms");
    const { ScheduleActions } = await import("@/app/clinic/[clinicId]/clinical/schedules/[versionId]/schedule-actions");
    const { TransferButton } = await import("@/app/clinic/[clinicId]/transfers/forms");
    const { ReconcilePanel } = await import("@/app/clinic/[clinicId]/inventory/forms");
    const { CertificatesPanel } = await import("@/app/clinic/[clinicId]/children/[childId]/certificates");
    const certificate = { id: "cert", certificateNo: "C-1", status: "issued" as const, reviewNeeded: false, issuedAt: null, replacesNo: null, entryCount: 1, hasDocument: false, revokedAt: null, revocationReason: null };
    const replacement = () => {
      const panel = CertificatesPanel({ clinicId: "c", childId: "kid", certificates: [certificate], canIssue: true, clinicTimezone: "Asia/Manila" });
      const issue = nodes(panel).find((n) => typeof n.type === "function" && n.props.replacesId === "cert")!;
      return (issue.type as (p: Props) => unknown)(issue.props);
    };
    return [
      { name: "guardian QR pass", render: () => QrPanel({ childId: "kid", childName: "Ana" }), trigger: /QR pass/, cancel: /Keep the current pass/, text: /stops working/ },
      { name: "staff QR pass", render: () => StaffQr({ clinicId: "c", childId: "kid", childName: "Ana" }), trigger: /QR pass/, cancel: /Keep the current pass/, text: /stops working/ },
      { name: "time zone", render: () => ProfileForm({ clinicId: "c", profile: { name: "Clinic", address: "", contact: null, hours: null, timezone: "Asia/Manila" } }), trigger: /Save/, cancel: /Keep Asia\/Manila/, text: /Change the clinic time zone/ },
      { name: "retire schedule", render: () => ScheduleActions({ clinicId: "c", versionId: "v", status: "active", canPropose: false, canApprove: true, isProposer: false }), trigger: /Retire schedule now/, cancel: /Keep schedule/, text: /cannot be activated again/ },
      { name: "release record", render: () => TransferButton({ label: "Release the record", path: "/p", confirm: { text: "Release Ana's record to North?", yes: "Yes, release", no: "Not now" } }), trigger: /Release the record/, cancel: /Not now/, text: /Release Ana's record/ },
      { name: "repair balances", render: () => ReconcilePanel({ clinicId: "c" }), trigger: /Check and repair/, cancel: /Cancel/, text: /Rebuild the running balances/ },
      { name: "replacement certificate", render: replacement, trigger: /Issue replacement/, cancel: /Keep current certificate/, text: /Issue a replacement\?/ },
    ];
  }

  it("the trigger carries the step's trigger ref while the step is closed", async () => {
    for (const flow of await flows()) {
      stub.pick = (initial) => initial;
      const trigger = nodes(flow.render()).find((n) => n.props?.ref === step.triggerRef);
      expect(trigger, flow.name).toBeDefined();
      expect(label(trigger!), flow.name).toMatch(flow.trigger);
    }
  });

  it("the open step is a labelled group whose safe control takes focus and is described by the consequence", async () => {
    for (const flow of await flows()) {
      stub.pick = open;
      const tree = flow.render();
      const group = nodes(tree).find((n) => n.props?.ref === step.groupRef);
      expect(group, flow.name).toBeDefined();
      expect(group!.props["aria-label"], flow.name).toBeTruthy();
      const inside = nodes(group);
      const safe = inside.filter((n) => n.props?.["data-autofocus"]);
      expect(safe.map(label), flow.name).toEqual([expect.stringMatching(flow.cancel)]);
      expect(label(inside.find((n) => n.props?.id === "consequence")!), flow.name).toMatch(flow.text);
      expect(nodes(tree).some((n) => n.props?.ref === step.triggerRef), flow.name).toBe(false);
    }
  });

  it("each flow tells the step whether it is open and whether its confirm request is pending", async () => {
    for (const flow of await flows()) {
      stub.pick = open;
      stub.state = { phase: "pending" };
      step.calls = [];
      flow.render();
      expect(step.calls.at(-1), flow.name).toEqual([true, true]);
    }
  });
});

describe("staff downloads stay on the page when they fail", () => {
  it("shows the API's message inline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, json: () => Promise.resolve({ error: { message: "Too many requests. Wait a minute." }, requestId: "req-1" }) }));
    const { DownloadButton } = await import("@/components/download-button");
    const tree = DownloadButton({ href: "/api/v1/clinics/c/reports/r/export?from=a&to=b", filename: "r.csv", label: "Download CSV", failureText: "The CSV could not be downloaded." });
    await nodes(tree).find((n) => n.type === "button")!.props.onClick!();
    expect(stub.setState).toHaveBeenCalledWith(expect.stringContaining("Too many requests. Wait a minute."));
    expect(stub.setState).toHaveBeenCalledWith(expect.stringContaining("req-1"));
    vi.unstubAllGlobals();
  });

  it("picks the server's file name", async () => {
    const { filenameFromDisposition } = await import("@/components/download-button");
    expect(filenameFromDisposition('attachment; filename="CERT-0001.pdf"', "x.pdf")).toBe("CERT-0001.pdf");
    expect(filenameFromDisposition(null, "x.pdf")).toBe("x.pdf");
  });
});
