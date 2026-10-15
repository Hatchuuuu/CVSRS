import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const stub = vi.hoisted(() => ({ active: vi.fn(), refs: { current: [] as unknown[] } }));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), useId: () => "services", useState: () => [0, stub.active], useRef: () => stub.refs }));
import { ServiceExplorer, type Service } from "@/app/_landing/service-explorer";

it("changes keyboard tabs immediately even when reduced motion is not enabled", () => {
  const scrollIntoView = vi.fn();
  const focus = vi.fn();
  stub.refs.current = [{ focus, scrollIntoView }, { focus, scrollIntoView }];
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
  const services = ["records", "booking"].map((id) => ({ id, name: id, hint: "", title: id, text: "", points: [], action: { href: "/sign-up", label: "Create account" }, demo: null })) as Service[];
  const tree = ServiceExplorer({ services });
  const tablist = tree.props.children[0] as ReactElement<{ onKeyDown: (event: unknown) => void }>;
  tablist.props.onKeyDown({ key: "ArrowRight", preventDefault: vi.fn() });
  expect(stub.active).toHaveBeenCalledWith(1);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "instant" }));
  vi.unstubAllGlobals();
});

it("keeps repeated service and FAQ explanatory text readable without entrance delays", () => {
  const css = readFileSync("src/app/_landing/landing.css", "utf8");
  expect(css).not.toMatch(/\.lp-panel:not\(\[hidden\]\) \.lp-panel-body\s*\{[^}]*animation:/);
  expect(css).not.toMatch(/\.lp-faq-list details\[open\] \.lp-faq-answer p\s*\{[^}]*animation:/);
  expect(css).not.toMatch(/block-size 320ms/);
});
