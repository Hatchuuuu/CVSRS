import { beforeEach, describe, expect, it, vi } from "vitest";

const stubs = vi.hoisted(() => ({
  requireClinicStaff: vi.fn(),
  requireViewer: vi.fn(),
  getViewer: vi.fn(),
}));

vi.mock("@/lib/server/viewer", () => stubs);
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Static image imports are a bundler feature; the landing page's photographs are not under test here.
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({
  notFound: () => { throw new Error("not found"); },
  useRouter: () => ({ refresh: () => {} }),
}));

describe("server page read failures", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects an unavailable message inbox instead of displaying no messages", async () => {
    stubs.requireViewer.mockResolvedValue({ rpc: { rpc: () => Promise.resolve(null) } });
    const { default: Messages } = await import("@/app/messages/page");
    await expect(Messages()).rejects.toThrow("Messages could not be loaded");
  });

  it("rejects a failed clinic queue read instead of showing zero patients", async () => {
    const rpc = vi.fn((name: string) => name === "list_queue" ? Promise.reject(new Error("queue unavailable")) : Promise.resolve([]));
    stubs.requireClinicStaff.mockResolvedValue({ rpc: { rpc }, membership: { capabilities: ["queue.manage", "appointment.manage"] } });
    const { default: ClinicToday } = await import("@/app/clinic/[clinicId]/today/page");
    await expect(ClinicToday({ params: Promise.resolve({ clinicId: "clinic" }) })).rejects.toThrow("queue unavailable");
  });

  it("rejects a failed privacy notice read instead of exposing the add and link flow", async () => {
    const rpc = vi.fn((name: string) => {
      if (name === "my_children") return Promise.resolve([]);
      if (name === "list_public_clinics") return Promise.resolve([{ id: "clinic", name: "Clinic" }]);
      return Promise.reject(new Error("notice unavailable"));
    });
    stubs.requireViewer.mockResolvedValue({ rpc: { rpc } });
    const { default: MyChildren } = await import("@/app/children/page");
    await expect(MyChildren()).rejects.toThrow("notice unavailable");
  });

  it("reports failed public clinic discovery instead of claiming no clinic is listed", async () => {
    stubs.getViewer.mockResolvedValue({ mode: "supabase", session: null, rpc: { rpc: () => Promise.reject(new Error("clinics unavailable")) }, ctx: null });
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: Home } = await import("@/app/page");
    // The rest of the landing page still renders; only the directory shows that it could not be loaded.
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("The health center list could not be loaded");
    expect(html).not.toContain("No health centers are listed yet");
    expect(html).not.toContain("lp-directory-count");
  });
});
