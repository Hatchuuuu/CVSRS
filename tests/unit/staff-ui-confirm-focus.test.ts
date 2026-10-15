import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

// No DOM library is installed, so the hooks run through a tiny hook runner: refs persist across "renders" by call
// order, effects run after the test has attached refs (as React commits refs before effects), and elements are plain objects with the few DOM members the helpers use.
const hooks = vi.hoisted(() => ({ refs: [] as { current: unknown }[], index: 0, effects: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useRef: (initial: unknown) => {
    const i = hooks.index++;
    return (hooks.refs[i] ??= { current: initial });
  },
  useEffect: (effect: () => void) => {
    hooks.effects.push(effect);
  },
  useId: () => "confirm-text",
}));

interface Fake {
  focus: ReturnType<typeof vi.fn>;
  hiddenAncestor?: boolean;
  displayed?: boolean;
  preferred?: boolean;
  closest: (selector: string) => unknown;
  getClientRects: () => { length: number };
  matches: (selector: string) => boolean;
}
function el(options: { hiddenAncestor?: boolean; displayed?: boolean; preferred?: boolean } = {}): Fake {
  return {
    focus: vi.fn(),
    closest: (selector) => (options.hiddenAncestor && /\[hidden\]/.test(selector) ? {} : null),
    getClientRects: () => ({ length: options.displayed === false ? 0 : 1 }),
    matches: (selector) => Boolean(options.preferred) && selector.includes("data-autofocus"),
  };
}
const panel = (...items: Fake[]) => ({ querySelectorAll: () => items });

const body = { tagName: "BODY" };
function setActive(active: unknown) {
  vi.stubGlobal("document", { body, activeElement: active });
}

describe("disclosure first focus skips hidden candidates (RV2-D-05)", () => {
  it("does not pick a data-autofocus control inside a hidden sub-panel; falls back to the first visible item", async () => {
    const { firstFocusTarget } = await import("@/components/disclosure");
    const nestedConfirm = el({ preferred: true, hiddenAncestor: true, displayed: false });
    const firstLink = el();
    expect(firstFocusTarget(panel(firstLink, nestedConfirm) as never)).toBe(firstLink);
  });

  it("still prefers a visible data-autofocus / current-page item over the first focusable", async () => {
    const { firstFocusTarget } = await import("@/components/disclosure");
    const first = el();
    const current = el({ preferred: true });
    expect(firstFocusTarget(panel(first, current) as never)).toBe(current);
  });

  it("skips elements that are not displayed even without a [hidden] ancestor", async () => {
    const { firstFocusTarget } = await import("@/components/disclosure");
    const collapsed = el({ displayed: false });
    const shown = el();
    expect(firstFocusTarget(panel(collapsed, shown) as never)).toBe(shown);
    expect(firstFocusTarget(null)).toBeNull();
  });

  it("filters aria-hidden and inert ancestors through the same selector", () => {
    const source = readFileSync("src/components/disclosure.ts", "utf8");
    expect(source).toMatch(/\[hidden\]/);
    expect(source).toMatch(/aria-hidden="true"/);
    expect(source).toMatch(/\[inert\]/);
  });
});

describe("confirm steps keep keyboard focus (RV1-01)", () => {
  beforeEach(() => {
    hooks.refs = [];
    vi.unstubAllGlobals();
  });

  async function setup() {
    const { useConfirmStep } = await import("@/components/confirm-step");
    const trigger = el();
    const cancel = el({ preferred: true });
    const yes = el();
    const render = (open: boolean, pending = false) => {
      hooks.index = 0;
      // A hand-rolled hook harness (hooks are mocked above), not a React render, so the hook rule does not apply.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const step = useConfirmStep(open, pending);
      step.triggerRef.current = trigger as never;
      step.groupProps.ref.current = (open ? panel(yes, cancel) : null) as never;
      hooks.effects.splice(0).forEach((effect) => effect());
      return step;
    };
    return { render, trigger, cancel, yes };
  }

  it("moves focus to the safe control when the step opens, and back to the trigger on cancel", async () => {
    const { render, trigger, cancel, yes } = await setup();
    setActive(trigger);
    render(false);
    // The trigger unmounts when the step opens, so focus has fallen to <body>.
    setActive(body);
    render(true);
    expect(cancel.focus).toHaveBeenCalledTimes(1);
    expect(yes.focus).not.toHaveBeenCalled();
    // Cancel removes the group, focus falls to <body> again and goes back to the (re-mounted) trigger.
    render(false);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("opens into the group even when focus stayed in a field (Enter in a reason field)", async () => {
    const { render, cancel } = await setup();
    const field = el();
    setActive(field);
    render(false);
    render(true);
    expect(cancel.focus).toHaveBeenCalledTimes(1);
  });

  it("does not steal focus when typing in the form closes the step", async () => {
    const { render, trigger } = await setup();
    setActive(body);
    render(false);
    render(true);
    setActive(el());
    render(false);
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("returns focus to the group after a failed attempt that disabled the focused button", async () => {
    const { render, cancel } = await setup();
    setActive(body);
    render(false);
    render(true);
    render(true, true);
    render(true, false);
    expect(cancel.focus).toHaveBeenCalledTimes(2);
  });

  it("returns focus to the trigger after success closes the step", async () => {
    const { render, trigger } = await setup();
    setActive(body);
    render(false);
    render(true);
    render(true, true);
    render(false, false);
    expect(trigger.focus).toHaveBeenCalledTimes(1);
  });

  it("re-renders with nothing changed never move focus", async () => {
    const { render, trigger, cancel } = await setup();
    setActive(body);
    render(false);
    render(false);
    render(true);
    render(true);
    expect(cancel.focus).toHaveBeenCalledTimes(1);
    expect(trigger.focus).not.toHaveBeenCalled();
  });

  it("describes the safe control with the consequence text", async () => {
    const { render } = await setup();
    setActive(body);
    const step = render(true);
    expect(step.textProps.id).toBe("confirm-text");
    expect(step.cancelProps["aria-describedby"]).toBe("confirm-text");
    expect(step.cancelProps["data-autofocus"]).toBe(true);
  });
});

describe("every confirm flow uses the shared step", () => {
  const flows = [
    "src/app/children/forms.tsx",
    "src/app/clinic/[clinicId]/children/[childId]/actions.tsx",
    "src/app/clinic/[clinicId]/settings/forms.tsx",
    "src/app/clinic/[clinicId]/clinical/schedules/[versionId]/schedule-actions.tsx",
    "src/app/clinic/[clinicId]/transfers/forms.tsx",
    "src/app/clinic/[clinicId]/inventory/forms.tsx",
    "src/app/clinic/[clinicId]/children/[childId]/certificates.tsx",
  ];
  it.each(flows)("%s", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source).toContain("useConfirmStep(");
    expect(source).toContain("triggerRef");
    expect(source).toContain("groupProps");
    expect(source).toContain("cancelProps");
  });
});
