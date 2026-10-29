import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";

const axeSource = readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8");

async function inspect(page: Page, path: string, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  if (/\/clinic\/[^/]+\/admin$/.test(path)) await expect(page).toHaveURL(/\/developer\/[^/]+\/staff$/);
  await expect(page.locator("main h1").first()).toBeVisible();
  if (path.startsWith("/clinic/")) await expect(page.getByRole("heading", { level: 1, name: "Page unavailable", exact: true })).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.documentElement.scrollWidth), `${path} at ${width}px`).toBeLessThanOrEqual(width + 1);
  await page.addScriptTag({ content: axeSource });
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const result = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return result.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }));
  });
  expect(violations, `${path} at ${width}px`).toEqual([]);
}

test("secondary operational screens retain readable responsive layouts and accessible controls", async ({ browser }, info) => {
  test.setTimeout(360_000);
  const { clinicId } = readVisitState();
  const errors: string[] = [];
  for (const [role, routes] of [
    ["lead", ["inventory/transfers", "inventory/cold-chain", "outage-forms", "clinical", "questions", "content", "reports", "audit"]],
    ["admin", ["access", "settings", "admin"]],
    ["nurse", ["inventory"]],
  ] as const) {
    const staff = await signInStaff(browser, role);
    staff.page.on("pageerror", error => errors.push(error.message));
    try {
      for (const route of routes) {
        for (const width of route === "reports" ? [320, 390, 768, 1440] : [390, 768, 1440]) {
          await inspect(staff.page, `/clinic/${clinicId}/${route}`, width);
          if (route === "reports") {
            expect(await staff.page.locator("thead").first().evaluate(el => el.getBoundingClientRect().height)).toBeLessThan(100);
          }
          if (route === "outage-forms") {
            for (const media of ["screen", "print"] as const) {
              await staff.page.emulateMedia({ media });
              await expect(staff.page.locator("[data-paper-form] td").first()).toHaveCSS("padding-top", "12px");
              await expect(staff.page.locator("[data-paper-form] th").first()).toHaveCSS("color", "rgb(0, 0, 0)");
            }
            await staff.page.emulateMedia({ media: "screen" });
          }
          await staff.page.screenshot({ path: info.outputPath(`${role}-${route.replaceAll("/", "-")}-${width}.png`), fullPage: true, animations: "disabled" });
        }
      }
    } finally { await staff.context.close(); }
  }
  expect(errors).toEqual([]);
});

test("application styling stays out of the landing page after client navigation", async ({ browser }, info) => {
  const family = await signInFamily(browser);
  async function settledLanding(name: string) {
    await family.page.waitForLoadState("networkidle");
    await family.page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, image => image.decode()));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    // The development server's transient Rendering badge is outside the application UI.
    return family.page.screenshot({ path: info.outputPath(name), fullPage: true, animations: "disabled", style: "nextjs-portal { display: none !important; }" });
  }
  try {
    await family.page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [390, 1440]) {
      await family.page.setViewportSize({ width, height: 1000 });
      await family.page.goto("/");
      const baseline = await settledLanding(`landing-before-${width}.png`);
      await family.page.getByRole("link", { name: "View my children", exact: true }).click();
      await expect(family.page).toHaveURL(/\/children/);
      await expect(family.page.locator(".family-records")).toBeVisible();
      await family.page.getByRole("link", { name: "eVacTrack home", exact: true }).click();
      await expect(family.page.locator(".landing-page")).toBeVisible();
      expect((await settledLanding(`landing-after-${width}.png`)).equals(baseline), `Landing remains identical at ${width}px`).toBe(true);
    }
  } finally { await family.context.close(); }
});

test("unavailable pages have a primary heading and a usable way back", async ({ page }) => {
  await inspect(page, "/unavailable-application-quality-test", 390);
  await expect(page.getByRole("heading", { level: 1, name: "Page unavailable" })).toBeVisible();
  await page.getByRole("link", { name: "Go to the start page", exact: true }).click();
  await expect(page.locator(".landing-page")).toBeVisible();
});
