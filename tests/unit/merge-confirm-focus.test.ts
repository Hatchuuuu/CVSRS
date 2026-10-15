import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0, effects: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (next: unknown) => { hooks.states[index] = next; }];
  },
  useRef: (initial: unknown) => hooks.refs[hooks.refIndex++] ?? (hooks.refs[hooks.refIndex - 1] = { current: initial }),
  useEffect: (effect: () => void) => hooks.effects.push(effect),
  useId: () => "merge-consequence",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: vi.fn() }) }));

import { CaseCard, MergeConfirm, type ReviewCase } from "@/app/clinic/[clinicId]/review/cases";

type Node = ReactElement<Record<string, unknown>>;
const nodes = (value: unknown): Node[] => {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
};
const text = (value: unknown): string => Array.isArray(value) ? value.map(text).join("") : typeof value === "string" ? value : value && typeof value === "object" && "props" in value ? text((value as Node).props.children) : "";
const body = {};
const c: ReviewCase = { caseId: "case", kind: "duplicate", status: "open", reason: "Similar names", createdAt: "2026-10-01T00:00:00Z", evidence: {}, childId: "one", candidateChildId: "two", child: { displayName: "Ana", localRecordNo: "R-1", dob: null }, candidate: { displayName: "Ana", localRecordNo: "R-2", dob: null }, guardianName: null };

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.effects = [];
  vi.stubGlobal("document", { body, activeElement: body });
});
afterEach(() => vi.unstubAllGlobals());

describe("merge confirmation keyboard recovery", () => {
  for (const record of ["R-1", "R-2"]) {
    it(`returns cancellation focus to the selected keep-${record} button`, () => {
      const card = CaseCard({ clinicId: "clinic", c, canVerify: true, canResolve: true, canEdit: true });
      const duplicate = nodes(card).find((node) => typeof node.type === "function" && node.type.name === "DuplicateCase")!;
      const render = () => {
        hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effects = [];
        return nodes((duplicate.type as (props: typeof duplicate.props) => unknown)(duplicate.props));
      };
      let tree = render();
      hooks.effects.splice(0).forEach((effect) => effect());
      const trigger = { focus: vi.fn() };
      const choice = tree.find((node) => text(node.props.children) === `Same child — keep ${record}`)!;
      if (choice.props.ref) (choice.props.ref as { current: unknown }).current = trigger;
      (choice.props.onClick as (event: unknown) => void)({ currentTarget: trigger });
      tree = render();
      const merge = tree.find((node) => node.type === MergeConfirm)!;
      const confirmation = nodes(MergeConfirm(merge.props as Parameters<typeof MergeConfirm>[0]));
      const cancel = confirmation.find((node) => text(node.props.children) === "Do not merge")!;
      const safe = { focus: vi.fn(), closest: () => null, getClientRects: () => ({ length: 1 }), matches: () => cancel.props["data-autofocus"] === true };
      const group = [...tree, ...confirmation].find((node) => node.props.role === "group");
      if (group) (group.props.ref as { current: unknown }).current = { querySelectorAll: () => [safe] };
      hooks.effects.splice(0).forEach((effect) => effect());
      (cancel.props.onClick as () => void)();
      render();
      // Removing the focused cancellation button falls back to the document body.
      hooks.effects.splice(0).forEach((effect) => effect());
      expect(trigger.focus).toHaveBeenCalledOnce();
      expect(safe.focus).toHaveBeenCalledOnce();
    });
  }
});
