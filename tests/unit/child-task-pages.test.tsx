import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ rpc: vi.fn(), ready: false, error: undefined as string | undefined }));
vi.mock("@/lib/server/viewer", () => ({ requireViewer: async () => ({ rpc: { rpc: s.rpc } }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/client/api", () => ({ useMutation: () => ({ state: { phase: "idle" }, run: vi.fn() }) }));
vi.mock("@/app/children/privacy-notice", () => ({
  PrivacyNotices: ({ notices }: { notices: { text: string }[] }) => <div>{notices.map(n => n.text)}</div>,
  useClinicPrivacy: () => ({ ready: s.ready, error: s.error }),
  SelectedClinicPrivacy: () => <p>{s.error ?? (s.ready ? "Accepted" : "Privacy acceptance required")}</p>,
}));
beforeEach(() => { s.ready = false; s.error = undefined; s.rpc.mockReset(); s.rpc.mockImplementation(async (name: string) => name === "list_public_clinics" ? [{ id: "clinic", name: "Clinic" }] : []); });
for (const task of ["register", "link"]) {
  it(`${task} is a deliberate task with privacy-gated submission and a return link`, async () => {
    const { default: Page } = task === "register" ? await import("@/app/children/register/page") : await import("@/app/children/link/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain('href="/children"');
    expect(html).toContain("Privacy acceptance required");
    expect(html).toMatch(/type="submit"[^>]*disabled/);
    expect(s.rpc).not.toHaveBeenCalledWith("my_children");
  });
  it(`${task} fails closed when the notice list cannot be read`, async () => {
    s.rpc.mockImplementation(async (name: string) => name === "get_pending_privacy_notices" ? null : []);
    const { default: Page } = task === "register" ? await import("@/app/children/register/page") : await import("@/app/children/link/page");
    await expect(Page()).rejects.toThrow("Privacy notices could not be loaded");
  });
  it(`${task} keeps failed selected-clinic privacy checks disabled`, async () => {
    s.error = "Privacy service unavailable";
    const { default: Page } = task === "register" ? await import("@/app/children/register/page") : await import("@/app/children/link/page");
    const html = renderToStaticMarkup(await Page());
    expect(html).toContain("Privacy service unavailable");
    expect(html).toMatch(/type="submit"[^>]*disabled/);
  });
  it(`${task} explains when no clinics are available`, async () => {
    s.rpc.mockResolvedValue([]);
    const { default: Page } = task === "register" ? await import("@/app/children/register/page") : await import("@/app/children/link/page");
    expect(renderToStaticMarkup(await Page())).toContain("No clinics available");
  });
}
it("care read null is an error, while published topics get an index", async () => {
  const { default: Page } = await import("@/app/help/page");
  s.rpc.mockResolvedValue(null);
  await expect(Page()).rejects.toThrow("Care information could not be loaded");
  s.rpc.mockResolvedValue([{ clinic: "Clinic", code: "care", title: "After your visit", body: "Approved text", source: "Clinic", reviewedOn: null }]);
  const html = renderToStaticMarkup(await Page());
  expect(html).toContain('aria-label="Care topics"');
  expect(html).toContain('href="#care-topic-0"');
});
