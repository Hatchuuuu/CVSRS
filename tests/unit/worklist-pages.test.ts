import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/server/viewer", () => ({
  requireViewer: async () => ({ rpc: { rpc: stubs.rpc } }),
  requireClinicStaff: async () => ({ rpc: { rpc: stubs.rpc }, membership: { capabilities: ["guardian.verify", "bhw.followup"], clinicTimezone: "Asia/Manila" }, ctx: { profileId: "me" } }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {} }), notFound: () => { throw new Error("not found"); } }));

import Messages from "@/app/messages/page";
import Followup from "@/app/clinic/[clinicId]/followup/page";
import Review from "@/app/clinic/[clinicId]/review/page";

const id = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const at = "2026-10-07T00:00:00.123456Z";
beforeEach(() => stubs.rpc.mockReset());

function href(html: string, text: string) {
  const match = html.match(new RegExp(`<a[^>]*href="([^"]+)"[^>]*>${text}</a>`));
  expect(match, `paging link ${text}`).not.toBeNull();
  return new URL(match![1]!.replaceAll("&amp;", "&"), "https://fixture.test");
}

describe("worklists expose the next page of existing records", () => {
  it("distinguishes an empty older message page from a new inbox", async () => {
    stubs.rpc.mockImplementation(async (name: string) => name === "my_messages" ? { unread: 0, items: [] } : name === "my_children" ? [] : null);
    const first = renderToStaticMarkup(await Messages({}));
    expect(first).toContain("No messages yet");
    const older = renderToStaticMarkup(await Messages({ searchParams: Promise.resolve({ before: at, beforeId: id(50) }) }));
    expect(older).toContain("No older messages");
    expect(older).not.toContain("No messages yet");
    expect(href(older, "Newest messages").pathname).toBe("/messages");
  });
  it("links messages after the last visible message, keeping the lookahead hidden", async () => {
    stubs.rpc.mockImplementation(async (name: string) => name === "my_messages" ? { unread: 51, items: Array.from({ length: 51 }, (_, i) => ({ id: id(i + 1), kind: "test", title: `Message ${i + 1}`, body: "Fixture", childId: null, createdAt: at, read: false })) } : name === "my_children" ? [] : null);
    const html = renderToStaticMarkup(await Messages({}));
    expect(html).toContain("Message 50");
    expect(html).not.toContain("Message 51");
    const next = href(html, "Older messages");
    expect(next.searchParams.get("beforeId")).toBe(id(50));
    expect(next.searchParams.get("before")).toBe(at);
    const second = renderToStaticMarkup(await Messages({ searchParams: Promise.resolve(Object.fromEntries(next.searchParams)) }));
    expect(second).toContain("Newest messages");
    expect(stubs.rpc).toHaveBeenCalledWith("my_messages", expect.objectContaining({ p_before: at, p_before_id: id(50) }));
  });

  it("keeps the selected follow-up filter and every ordering key in the next link", async () => {
    stubs.rpc.mockResolvedValue({ asOf: at, schedule: "active", staleChildren: 0, items: Array.from({ length: 51 }, (_, i) => ({ childId: id(i + 1), childName: `Child ${i + 1}`, recordNo: `R${i}`, dob: null, behind: 2, due: 1, review: 0, needs: [], computedAt: at, attempts: 0, lastAttempt: null, guardian: null })) });
    const html = renderToStaticMarkup(await Followup({ params: Promise.resolve({ clinicId: "clinic" }), searchParams: Promise.resolve({ filter: "due" }) }));
    expect(html).not.toContain("Child 51");
    const next = href(html, "More children");
    expect(next.searchParams.get("filter")).toBe("due");
    expect(JSON.parse(next.searchParams.get("after")!)).toEqual({ behind: 2, due: 1, name: "Child 50", id: id(50) });
  });

  it("links beyond the oldest review cases without resolving them", async () => {
    stubs.rpc.mockResolvedValue(Array.from({ length: 51 }, (_, i) => ({ caseId: id(i + 1), kind: "sync", status: "open", reason: "Fixture", createdAt: at, evidence: {}, childId: null, candidateChildId: null, child: null, candidate: null, guardianName: null })));
    const html = renderToStaticMarkup(await Review({ params: Promise.resolve({ clinicId: "clinic" }) }));
    const next = href(html, "More cases");
    expect(next.searchParams.get("afterId")).toBe(id(50));
    expect(next.searchParams.get("after")).toBe(at);
    expect(html).not.toContain(`case-${id(51)}`);
  });
});
