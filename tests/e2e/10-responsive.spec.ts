import { expect } from "@playwright/test";
import { journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";

test("family and clinic workflows reflow on phones, tablets and wide desktops; menus support keyboard recovery", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const { clinicId, childId } = readVisitState();
  const family = await signInFamily(browser);
  const lead = await signInStaff(browser, "lead");
  try {
    for (const width of [320, 768, 1440]) {
      for (const [page, paths] of [
        [family.page, ["/children", `/children/${childId}`, "/messages", "/account"]],
        [lead.page, [`/clinic/${clinicId}/today`, `/clinic/${clinicId}/children/${childId}`, `/clinic/${clinicId}/review`, `/clinic/${clinicId}/followup`, `/clinic/${clinicId}/reports`]],
      ] as const) {
        await page.setViewportSize({ width, height: 900 });
        for (const path of paths) {
          await page.goto(path, { timeout: 90_000 });
          await expect(page.locator("main h1").first()).toBeVisible();
          if (path === "/children") await expect(page.getByText("Checking the clinic's privacy notice...", { exact: true })).toHaveCount(0, { timeout: 60_000 });
          expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path} at ${width}px`).toBe(true);
          await page.screenshot({ path: info.outputPath(`${width}-${path.replaceAll("/", "_")}.png`), fullPage: true, caret: "initial" });
        }
      }
    }
    await family.page.setViewportSize({ width: 320, height: 900 });
    await family.page.goto("/children");
    await family.page.keyboard.press("Tab");
    await expect(family.page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await family.page.keyboard.press("Enter");
    await expect(family.page.locator("main")).toBeFocused();
    const menu = family.page.getByRole("button", { name: /^Menu/ });
    await menu.focus();
    await family.page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await family.page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  } finally {
    await family.context.close();
    await lead.context.close();
  }
});
