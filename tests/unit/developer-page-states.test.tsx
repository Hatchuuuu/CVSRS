import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const stubs = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/server/developer", () => ({ requireDeveloper: async () => ({ rpc: { rpc: stubs.rpc }, membership: { clinicTimezone: "Asia/Manila" } }) }));

it("invalid technical audit links retain a page heading and recovery without a database read", async () => {
  const { default: Audit } = await import("@/app/developer/[clinicId]/audit/page");
  const html = renderToStaticMarkup(await Audit({ params: Promise.resolve({ clinicId: "clinic" }), searchParams: Promise.resolve({ before: "invalid" }) }));
  expect(html).toMatch(/<h1[^>]*>Technical audit<\/h1>/);
  expect(html).toContain("Invalid audit cursor");
  expect(html).toContain('href="/developer/clinic/audit"');
  expect(stubs.rpc).not.toHaveBeenCalled();
});
