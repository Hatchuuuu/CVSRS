import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
vi.mock("@/lib/server/developer", () => ({ requireDeveloper: async () => ({ membership: { capabilities: ["admin.users"] } }) }));
vi.mock("@/components/technical/create-staff-account", () => ({ CreateStaffAccount: () => <form>Existing staff creation</form> }));
it("opens staff creation as a dedicated task with the existing form and a way back", async () => {
  const { default: Create } = await import("@/app/developer/[clinicId]/staff/create/page");
  const html = renderToStaticMarkup(await Create({ params: Promise.resolve({ clinicId: "clinic" }) }));
  expect(html).toContain("Existing staff creation");
  expect(html).toContain('href="/developer/clinic/staff"');
  expect(html).toContain("Create staff account");
});
