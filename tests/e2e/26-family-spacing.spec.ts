import { expect } from "@playwright/test";
import { journeyTest as test, signInFamily } from "./support";

test("family pages share the same workspace margins", async ({ browser }, info) => {
  const family = await signInFamily(browser);
  try {
    for (const width of [390, 1440, 1920]) {
      await family.page.setViewportSize({ width, height: 1000 });
      const bounds: { left: number; right: number }[] = [];
      for (const path of ["/help", "/messages", "/children"]) {
        await family.page.goto(path);
        const title = family.page.locator(".app-page-title");
        await expect(title).toBeVisible();
        bounds.push(await title.evaluate(el => { const rect = el.getBoundingClientRect(); return { left: rect.left, right: rect.right }; }));
        expect(await family.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        if (path === "/children") await family.page.screenshot({ path: info.outputPath(`children-${width}.png`), fullPage: true, animations: "disabled" });
      }
      for (const rect of bounds.slice(1)) {
        expect(Math.abs(rect.left - bounds[0]!.left)).toBeLessThanOrEqual(1);
        expect(Math.abs(rect.right - bounds[0]!.right)).toBeLessThanOrEqual(1);
      }
    }
  } finally { await family.context.close(); }
});
