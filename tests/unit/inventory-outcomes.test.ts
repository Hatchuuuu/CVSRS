import { beforeEach, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0, run: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const i = hooks.cursor++;
    if (!(i in hooks.values)) hooks.values[i] = initial;
    return [hooks.values[i], (next: unknown) => { hooks.values[i] = typeof next === "function" ? next(hooks.values[i]) : next; }];
  },
  useRef: (initial: unknown) => {
    const i = hooks.cursor++;
    return hooks.values[i] ?? (hooks.values[i] = { current: initial });
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: hooks.run }), callApi: vi.fn() }));
import { CloseLocation, LotActions } from "@/app/clinic/[clinicId]/inventory/forms";
import { CancelTransfer, ReceiveTransfer, ResolveShortfall } from "@/app/clinic/[clinicId]/inventory/transfers/forms";
import { clearOutcomeNotice, getOutcomeNotice } from "@/components/outcome-notice";

type Element = ReactElement<{ children?: unknown; onClick?: () => void; onSubmit?: (event: unknown) => Promise<void> }>;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const el = value as Element;
  return [el, ...nodes(el.props.children)];
}
function render(component: () => unknown) { hooks.cursor = 0; return nodes(component()); }
beforeEach(() => {
  hooks.values = []; hooks.run.mockReset().mockResolvedValue({ ok: true, data: { status: "received" } });
  clearOutcomeNotice("inventory:clinic"); clearOutcomeNotice("stock-transfers:clinic");
  vi.stubGlobal("FormData", class { get(key: string) { return ({ reason: "Stock moved", disposition: "quarantined", receivedQuantity: "2", locationId: "fridge", note: "Count checked" } as Record<string, string>)[key] ?? null; } });
});

const cases = [
  { name: "location closure", key: "inventory:clinic", component: () => CloseLocation({ clinicId: "clinic", locationId: "fridge", name: "Fridge" }), open: true },
  { name: "lot status", key: "inventory:clinic", component: () => LotActions({ clinicId: "clinic", lotId: "lot", disposition: "usable", canManage: true, canApprove: false, canLedger: false, clinicTimezone: "UTC" }), open: true },
  { name: "transfer receipt", key: "stock-transfers:clinic", component: () => ReceiveTransfer({ clinicId: "clinic", transferId: "transfer", sent: "2", unit: "vials", locations: [] }), open: false },
  { name: "transfer cancellation", key: "stock-transfers:clinic", component: () => CancelTransfer({ clinicId: "clinic", transferId: "transfer" }), open: true },
  { name: "shortfall decision", key: "stock-transfers:clinic", component: () => ResolveShortfall({ clinicId: "clinic", transferId: "transfer", shortfall: "2", unit: "vials", locations: [] }), open: false },
];

it.each(cases)("keeps $name confirmation after its control disappears", async ({ key, component, open }) => {
  const tree = render(component);
  if (open) tree.find((el) => el.props.onClick)!.props.onClick!();
  const form = render(component).find((el) => el.type === "form")!;
  await form.props.onSubmit!({ preventDefault() {}, currentTarget: {} });
  expect(getOutcomeNotice(key)).toMatchObject({ tone: "success", title: expect.any(String) });
});

it("does not announce a successful receipt when the server refused it", async () => {
  hooks.run.mockResolvedValue({ ok: false, error: "conflict" });
  const form = render(cases[2]!.component).find((el) => el.type === "form")!;
  await form.props.onSubmit!({ preventDefault() {}, currentTarget: {} });
  expect(getOutcomeNotice("stock-transfers:clinic")).toBeNull();
});
