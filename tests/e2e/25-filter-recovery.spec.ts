import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { clinicDate, formAlert, journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";

test("audit filters recover without widening results and empty older inbox pages lead back to recent messages", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const { clinicId } = readVisitState();
  const audit = `/clinic/${clinicId}/audit`;
  const older = "before=1900-01-01T00%3A00%3A00Z&beforeId=11111111-1111-4111-8111-111111111111";
  const lead = await signInStaff(browser, "lead");
  const family = await signInFamily(browser);
  try {
    for (const width of [390, 1440]) {
      await lead.page.setViewportSize({ width, height: 1000 });
      await lead.page.goto(`${audit}?from=2026-02-30`);
      await expect(lead.page.getByLabel("From", { exact: true })).toHaveAttribute("aria-invalid", "true");
      await expect(formAlert(lead.page)).toContainText("Correct the highlighted filters");
      await expect(lead.page.getByRole("region", { name: "Audit results" })).toHaveCount(0);
      await lead.page.addScriptTag({ content: readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8") });
      const violations = await lead.page.evaluate(async () => {
        const axe = (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: { id: string }[] }> } }).axe;
        return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => v.id);
      });
      expect(violations).toEqual([]);
      expect(await lead.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await lead.page.screenshot({ path: info.outputPath(`audit-filter-error-${width}.png`), fullPage: true, animations: "disabled" });
      await lead.page.getByLabel("From", { exact: true }).fill(clinicDate(-1));
      await lead.page.getByRole("button", { name: "Search", exact: true }).click();
      await expect(lead.page.getByRole("region", { name: "Audit results" })).toBeVisible();
      await lead.page.getByRole("link", { name: "Clear filters", exact: true }).click();
      await expect(lead.page).toHaveURL(new RegExp(`${audit}$`));
      await expect(lead.page.getByLabel("From", { exact: true })).toHaveValue("");
      await lead.page.getByRole("link", { name: "Older entries", exact: true }).click();
      await expect(lead.page.getByRole("navigation", { name: "Audit pages" }).getByRole("link", { name: "Newest entries" })).toBeVisible();
      await lead.page.goto(`${audit}?action=certificate.&${older}`);
      await expect(lead.page.getByText("No older entries match", { exact: true })).toBeVisible();
      await lead.page.getByRole("link", { name: "Newest entries", exact: true }).click();
      await expect(lead.page.getByLabel("Action starts with")).toHaveValue("certificate.");
      await expect(lead.page.getByRole("region", { name: "Audit results" })).toContainText("certificate.");

      await family.page.setViewportSize({ width, height: 1000 });
      await family.page.goto(`/messages?${older}`);
      await expect(family.page.getByText("No older messages", { exact: true })).toBeVisible();
      await family.page.screenshot({ path: info.outputPath(`older-messages-${width}.png`), fullPage: true, animations: "disabled" });
      await family.page.getByRole("link", { name: "Newest messages", exact: true }).click();
      await expect(family.page).toHaveURL(url => url.pathname === "/messages" && url.searchParams.get("portal") === "parents" && !url.searchParams.has("before") && !url.searchParams.has("beforeId"));
      await expect(family.page.getByRole("list", { name: "Messages", exact: true })).toBeVisible();
    }
  } finally {
    await lead.context.close();
    await family.context.close();
  }
});
