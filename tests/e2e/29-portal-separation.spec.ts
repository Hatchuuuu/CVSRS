import { expect } from "@playwright/test";
import { journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";

test("parent, clinic and developer navigation remain distinct through shared pages and reload", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const { clinicId } = readVisitState();
  const family = await signInFamily(browser);
  const nurse = await signInStaff(browser, "nurse");
  const admin = await signInStaff(browser, "admin");
  try {
    for (const [session, path, portal] of [
      [family, "/children", "Parents Portal"],
      [nurse, `/clinic/${clinicId}/today`, "Clinics Portal"],
      [admin, `/developer/${clinicId}/staff`, "Developer Console"],
    ] as const) {
      const page = session.page;
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(path);
      const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
      await expect(sidebar.getByText(portal, { exact: true }).first()).toBeVisible();
      await sidebar.getByRole("link", { name: "Settings / Account", exact: true }).click();
      await expect(page).toHaveURL(/\/account\?portal=/);
      await page.reload();
      await expect(sidebar.getByText(portal, { exact: true }).first()).toBeVisible();
      await expect(sidebar.getByRole("link", { name: "Settings / Account", exact: true })).toHaveAttribute("aria-current", "page");
      await sidebar.getByRole("link", { name: /^Messages/ }).click();
      await expect(page).toHaveURL(/\/messages\?portal=/);
      await expect(sidebar.getByText(portal, { exact: true }).first()).toBeVisible();
      await page.getByRole("button", { name: /^Account menu for/ }).click();
      await page.getByRole("group", { name: "Account options" }).getByRole("link", { name: "Account", exact: true }).click();
      await expect(sidebar.getByText(portal, { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: info.outputPath(`${portal.replaceAll(" ", "-")}.png`), fullPage: true, animations: "disabled" });
      expect(errors).toEqual([]);
    }
    await family.page.goto(`/developer/${clinicId}/staff`);
    await expect(family.page).toHaveURL(/\/clinic$/);
    await expect(family.page.getByRole("region", { name: "Create staff account", exact: true })).toHaveCount(0);
    await nurse.page.goto(`/developer/${clinicId}/staff`);
    await expect(nurse.page.getByRole("heading", { name: "Page unavailable", exact: true })).toBeVisible();
    await admin.page.goto("/children");
    await expect(admin.page.getByRole("complementary", { name: "Workspace sidebar" }).getByText("Parents Portal", { exact: true }).first()).toBeVisible();
    await expect(admin.page.getByRole("heading", { name: "My Children", exact: true })).toBeVisible();
    await admin.page.goto(`/developer/00000000-0000-4000-8000-000000000000/staff`);
    await expect(admin.page).toHaveURL(new RegExp(`/developer/${clinicId}/staff$`));
    expect([403, 404]).toContain((await admin.page.request.get("/api/v1/clinics/00000000-0000-4000-8000-000000000000/staff")).status());
    await expect(admin.page.getByRole("region", { name: "Create staff account", exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([family.context.close(), nurse.context.close(), admin.context.close()]);
  }
});
