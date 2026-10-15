import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, state: { phase: "idle" } as unknown, run: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useMemo: (compute: () => unknown) => compute(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = typeof initial === "function" ? initial() : initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === "function" ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++;
    return hooks.values[i] ?? (hooks.values[i] = { current: initial });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: hooks.state, run: hooks.run, reset() {} }) }));

import { RegisterChildForm } from "@/app/clinic/[clinicId]/workspace";
import { AdministerPanel } from "@/app/clinic/[clinicId]/children/[childId]/administration";

type Element = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const el = value as Element;
  return [el, ...nodes(el.props.children)];
}
function render(component: () => unknown) { hooks.cursor = 0; return nodes(component()); }
const registration = () => RegisterChildForm({ clinicId: "clinic" });
const candidates = { created: false, candidates: [{ childId: "existing", displayName: "Ana", localRecordNo: "R", dob: null, sameDob: false }] };
const hasConfirm = (tree: Element[]) => tree.some((el) => el.props.children === "This is a different child — register anyway");
function submit(tree: Element[]) {
  vi.stubGlobal("FormData", class { get(key: string) { return ({ givenNames: "Ana", dob: "2025-01-01" } as Record<string, string>)[key] ?? null; } });
  const form = tree.find((el) => el.type === "form")!;
  const event = { preventDefault() {}, currentTarget: {}, target: { reset() {} } };
  const pending = (form.props.onSubmit as (e: unknown) => Promise<void>)(event);
  vi.unstubAllGlobals();
  return pending;
}
function edit(tree: Element[]) {
  const form = tree.find((el) => el.type === "form")!;
  (form.props.onChange as (() => void) | undefined)?.();
}

beforeEach(() => { hooks.values = []; hooks.cursor = 0; hooks.state = { phase: "idle" }; hooks.run.mockReset(); });

describe("registration outcomes", () => {
  it("requires a fresh duplicate check after editing the registration", async () => {
    hooks.run.mockImplementation(async () => { hooks.state = { phase: "success", data: candidates }; return { ok: true, data: candidates }; });
    await submit(render(registration));
    const matched = render(registration);
    expect(hasConfirm(matched)).toBe(true);
    edit(matched);
    expect(hasConfirm(render(registration))).toBe(false);
  });

  it("ignores duplicate candidates received after the user edits during the check", async () => {
    let finish!: (value: unknown) => void;
    hooks.run.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = submit(render(registration));
    edit(render(registration));
    hooks.state = { phase: "success", data: candidates };
    finish({ ok: true, data: candidates });
    await pending;
    expect(hasConfirm(render(registration))).toBe(false);
  });

  it("keeps the created record link visible when the form is edited", async () => {
    const data = { created: true, childId: "new-child", localRecordNo: "NEW", candidates: [] };
    hooks.run.mockImplementation(async () => { hooks.state = { phase: "success", data }; return { ok: true, data }; });
    await submit(render(registration));
    edit(render(registration));
    expect(render(registration).some((el) => el.props.href === "/clinic/clinic/children/new-child")).toBe(true);
  });

  it("keeps signed-care confirmation after the last usable dose is consumed", () => {
    hooks.state = { phase: "success", data: { creditedRequirements: [], scheduleEvaluated: false, administeredOn: "2026-10-07" } };
    const html = renderToStaticMarkup(createElement(AdministerPanel, { clinicId: "clinic", clinicTimezone: "Asia/Manila", encounterId: "visit", childName: "Ana", recordNo: "R", lots: [], locations: [] }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Vaccination recorded and signed");
    expect(html).toContain("Saved for <strong>Ana</strong>");
    expect(html).not.toContain("No usable stock");
  });
});
