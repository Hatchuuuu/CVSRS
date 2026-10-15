import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const stub = vi.hoisted(() => ({ run: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: stub.refresh }), notFound() { throw new Error("not found"); } }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: stub.run }) }));
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), useState: () => [true, vi.fn()] }));
vi.mock("@/lib/server/viewer", () => ({ requireClinicStaff: async () => ({ membership: { capabilities: ["rules.approve"] }, ctx: { profileId: "reviewer" }, rpc: { rpc: async () => [
  { versionId: "pending", status: "submitted", code: "pending", language: "en", title: "Pending text", body: "Fixture", source: "Fixture", authoredById: "writer" },
  { versionId: "active", status: "active", code: "active", language: "en", title: "Active text", body: "Fixture", source: "Fixture", authoredById: "writer" },
] } }) }));

import Content from "@/app/clinic/[clinicId]/content/page";
import { WithReason } from "@/app/clinic/[clinicId]/content/forms";

type Element = ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}

beforeEach(() => { stub.run.mockReset(); stub.run.mockResolvedValue({ ok: true }); stub.refresh.mockReset(); });

describe("care-content server/client boundary", () => {
  it("passes serializable review actions into client controls", async () => {
    const tree = await Content({ params: Promise.resolve({ clinicId: "clinic" }) });
    const controls = nodes(tree).filter((el) => el.type === WithReason);
    expect(controls.map((el) => el.props.action)).toEqual(["approve", "reject", "retire"]);
    for (const control of controls) expect(Object.values(control.props).some((value) => typeof value === "function")).toBe(false);
  });

  it.each([
    ["approve", { decision: "approve", note: "Checked source" }],
    ["reject", { decision: "reject", note: "Checked source" }],
    ["retire", { reason: "Checked source" }],
  ] as const)("constructs the existing %s command inside the client", async (action, expected) => {
    vi.stubGlobal("FormData", class { get() { return " Checked source "; } });
    try {
      const control = WithReason({ label: "Decide", path: "/fixture", action, fieldLabel: "Reason" });
      const form = nodes(control).find((el) => el.type === "form")!;
      await (form.props.onSubmit as (e: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: {} });
      expect(stub.run).toHaveBeenCalledWith(expected);
      expect(stub.refresh).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
