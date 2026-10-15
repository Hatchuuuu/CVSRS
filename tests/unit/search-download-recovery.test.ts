import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const hooks = vi.hoisted(() => ({ values: [] as unknown[], cursor: 0 }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.cursor++;
    if (!(index in hooks.values)) hooks.values[index] = initial;
    return [hooks.values[index], (next: unknown) => { hooks.values[index] = next; }];
  },
  useRef: (initial: unknown) => ({ current: initial }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ChildList, ChildSearch } from "@/app/clinic/[clinicId]/workspace";
import { DownloadButton } from "@/components/download-button";

const child = { childId: "kid", displayName: "Returning Child", localRecordNo: "R-1", dob: null, dobPrecision: "unknown", recordStatus: "inactive" };
beforeEach(() => { hooks.values = []; hooks.cursor = 0; });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("search result clarity", () => {
  it.each([["provisional", "Awaiting verification"], ["active", "Verified record"]])("preserves the established %s search label", (recordStatus, label) => {
    const html = renderToStaticMarkup(ChildList({ clinicId: "clinic", items: [{ ...child, recordStatus }] }));
    expect(html).toContain(label);
  });
  it("labels inactive matches as inactive, rather than awaiting verification", () => {
    const html = renderToStaticMarkup(ChildList({ clinicId: "clinic", items: [child] }));
    expect(html).toContain("Inactive record");
    expect(html).not.toContain("Awaiting verification");
  });

  it("asks staff to refine a search that reaches the result limit", () => {
    hooks.values = [false, Array.from({ length: 20 }, (_, index) => ({ ...child, childId: `kid-${index}` })), null];
    const html = renderToStaticMarkup(ChildSearch({ clinicId: "clinic" }));
    expect(html).toContain("Showing up to 20 matches");
    expect(html).toContain("date of birth");
  });
});

describe("download recovery", () => {
  it("aborts a stalled body after its deadline, shows an error and enables retry", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_href: string, init?: RequestInit) => ({
      ok: true,
      blob: () => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Timed out", "AbortError")), { once: true });
      }),
    })));
    const tree = DownloadButton({ href: "/certificate", filename: "c.pdf", label: "Download", failureText: "Please retry." });
    const button = (tree.props.children as ReactElement<{ onClick: () => Promise<void> }>[])[0]!;
    const pending = button.props.onClick();
    await Promise.resolve();
    expect(timeout).toHaveBeenCalledWith(15_000);
    controller.abort();
    await pending;
    expect(hooks.values).toEqual([false, "Please retry."]);
  });
});
