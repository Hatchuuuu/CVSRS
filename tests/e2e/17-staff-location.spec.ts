import { expect } from "@playwright/test";
import { journeyTest as test, readVisitState, signInStaff } from "./support";

test("administrators save, reload and clear a staff member's work assignment", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const admin = await signInStaff(browser, "admin");
  try {
    await admin.page.goto(`/clinic/${clinicId}/access`);
    const row = admin.page.getByRole("list", { name: "Staff access", exact: true }).locator(":scope > li").filter({ hasText: "Barangay health worker" }).first();
    await row.getByRole("button", { name: /^(Add|Edit) assignment$/ }).click();
    await row.getByLabel("Barangay", { exact: true }).fill("Bunao");
    await row.getByLabel("City / municipality", { exact: true }).fill("Dumaguete City");
    await row.getByRole("button", { name: "Save assignment", exact: true }).click();
    await expect(row.getByText("Assignment saved.", { exact: true })).toBeVisible();
    await admin.page.reload();
    await expect(row).toContainText("Bunao, Dumaguete City");
    await row.getByRole("button", { name: "Edit assignment", exact: true }).click();
    await expect(row.getByLabel("Barangay", { exact: true })).toHaveValue("Bunao");
    await row.getByLabel("Barangay", { exact: true }).clear();
    await row.getByLabel("City / municipality", { exact: true }).clear();
    await row.getByRole("button", { name: "Save assignment", exact: true }).click();
    await expect(row).toContainText("Work location not assigned");
  } finally { await admin.context.close(); }
});
