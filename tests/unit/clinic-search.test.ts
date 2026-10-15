import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, callApi: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: vi.fn(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = typeof next === "function" ? next(hooks.values[index]) : next; }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.cursor++;
    return hooks.values[index] ?? (hooks.values[index] = { current: initial });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ callApi: hooks.callApi, useMutation: () => ({ state: { phase: "idle" }, run: vi.fn(), reset: vi.fn() }) }));

import { CorrectionForm } from "@/app/clinic/[clinicId]/children/[childId]/administration";
import { WalkInPanel } from "@/app/clinic/[clinicId]/today/board";
import { ChildSearch } from "@/app/clinic/[clinicId]/workspace";
import { QrScanner } from "@/app/clinic/[clinicId]/qr-scanner";

type Element = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
function render(component: () => unknown) { hooks.cursor = 0; return nodes(component()); }
function find(tree: Element[], predicate: (p: Record<string, unknown>) => boolean) { return tree.find((node) => predicate(node.props))!.props; }
const hit = { childId: "child-a", displayName: "Child A", localRecordNo: "A" };
const apiResult = { ok: true, data: [hit] };
const inputEvent = (value: string) => ({ target: { value } });

describe("clinic child search decisions", () => {
  beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.callApi.mockReset(); });

  it("clears the correction recipient as soon as the query changes, and ignores an older response", async () => {
    const component = () => CorrectionForm({ clinicId: "clinic", eventId: "event", lots: [], locations: [] });
    let tree = render(component);
    (find(tree, (p) => p.children === "Request a correction").onClick as () => void)();
    tree = render(component);
    (find(tree, (p) => p.label === "What needs correcting?").onChange as (e: unknown) => void)(inputEvent("reattribute_child"));
    tree = render(component);
    hooks.callApi.mockResolvedValueOnce(apiResult);
    await (find(tree, (p) => p.label === "Find the correct child").onChange as (e: unknown) => void)(inputEvent("Child"));
    await Promise.resolve();
    tree = render(component);
    (find(tree, (p) => p.type === "radio").onChange as () => void)();
    tree = render(component);
    expect(find(tree, (p) => p.children === "Send for approval").disabled).toBe(false);
    let resolveOld!: (value: unknown) => void;
    hooks.callApi.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    (find(tree, (p) => p.label === "Find the correct child").onChange as (e: unknown) => void)(inputEvent("Other"));
    tree = render(component);
    expect(find(tree, (p) => p.children === "Send for approval").disabled).toBe(true);
    (find(tree, (p) => p.label === "Find the correct child").onChange as (e: unknown) => void)(inputEvent(""));
    resolveOld(apiResult);
    await Promise.resolve();
    tree = render(component);
    expect(tree.filter((node) => node.props.type === "radio")).toHaveLength(0);
  });

  it("invalidates a walk-in search when its query is edited", () => {
    const component = () => WalkInPanel({ clinicId: "clinic" });
    let tree = render(component);
    // Simulate the completed server search state before editing the query.
    hooks.values[0] = [hit];
    tree = render(component);
    expect(tree.filter((node) => node.props.children === "Add to queue")).toHaveLength(1);
    (find(tree, (p) => p.label === "Find the child").onChange as () => void)();
    tree = render(component);
    expect(tree.filter((node) => node.props.children === "Add to queue")).toHaveLength(0);
  });

  it("clears registry matches when the name or birth-date filter changes", () => {
    const component = () => ChildSearch({ clinicId: "clinic" });
    let tree = render(component);
    hooks.values[1] = [hit];
    tree = render(component);
    expect(tree.some((node) => node.props.items)).toBe(true);
    (find(tree, (p) => p.label === "Date of birth (optional)").onChange as () => void)();
    tree = render(component);
    expect(tree.some((node) => node.props.items)).toBe(false);
  });

  it("stops a camera stream that resolves after the user cancels permission", async () => {
    let grant!: (value: unknown) => void;
    const stop = vi.fn();
    vi.stubGlobal("window", { BarcodeDetector: class { detect = vi.fn(); } });
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise((resolve) => { grant = resolve; }) } });
    try {
      const component = () => QrScanner({ onCode: vi.fn() });
      let tree = render(component);
      const starting = (find(tree, (p) => p.onClick !== undefined).onClick as () => Promise<void>)();
      tree = render(component);
      (find(tree, (p) => p.children === "Stop camera").onClick as () => void)();
      grant({ getTracks: () => [{ stop }] });
      await starting;
      expect(stop).toHaveBeenCalledOnce();
      tree = render(component);
      expect(tree.some((node) => node.type === "video")).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

