import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { account, env, journeyTest as test, NEW_PASSWORD, PASSWORD, readVisitState, signIn, verifyTotp } from "./support";

test("parent clinic and developer tasks reflow at actual 200 percent browser zoom", async ({ browserName }, info) => {
  test.setTimeout(300_000);
  expect(browserName).toBe("chromium");
  const { clinicId, childId, totp } = readVisitState();
  const profile = info.outputPath("zoom-profile");
  mkdirSync(join(profile, "Default"), { recursive: true });
  // Chromium stores default-partition browser zoom under partition.default_zoom_level.x.
  writeFileSync(join(profile, "Default/Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }));
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", headless: true, baseURL: env.baseUrl, viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  try {
    await context.route("**/*", route => ["localhost", "127.0.0.1", "[::1]"].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
    const page = context.pages()[0] ?? await context.newPage();
    for (const [role, paths] of [
      ["parent", ["/children", "/children/register", "/children/link", "/vaccination-records", "/appointments", "/help", "/messages?portal=parents", "/account?portal=parents"]],
      ["nurse", [`/clinic/${clinicId}/today`, `/clinic/${clinicId}/children/${childId}`, `/clinic/${clinicId}/followup`]],
      ["admin", ["staff", "staff/create", "settings", "operations", "audit"].map(path => `/developer/${clinicId}/${path}`)],
    ] as const) {
      await context.clearCookies();
      await signIn(page, account(role), role === "parent" ? NEW_PASSWORD : PASSWORD, role !== "parent");
      if (role === "parent") await expect(page).toHaveURL(/\/children$/);
      else await verifyTotp(page, totp![role]!);
      for (const [index, path] of paths.entries()) {
        await page.goto(path);
        await expect(page.locator("main h1")).toBeVisible();
        if (path.startsWith("/account?")) {
          const save = page.getByRole("region", { name: "Your details", exact: true }).getByRole("button", { name: "Save", exact: true });
          await expect(save).toBeEnabled();
          await expect(save).toHaveCSS("opacity", "1");
        }
        if (path.endsWith("/staff/create")) {
          const create = page.getByRole("button", { name: "Create staff account", exact: true });
          await expect(create).toBeEnabled();
          await expect(create).toHaveCSS("opacity", "1");
        }
        await expect(page.getByRole("heading", { name: "Page unavailable", exact: true })).toHaveCount(0);
        const metrics = await page.evaluate(() => ({ width: innerWidth, ratio: devicePixelRatio, scroll: document.documentElement.scrollWidth }));
        expect(metrics.width, `${role} ${path}: real browser zoom`).toBe(640);
        expect(metrics.ratio).toBe(2);
        expect(metrics.scroll, `${role} ${path}: no horizontal page overflow`).toBeLessThanOrEqual(641);
        await page.screenshot({ path: info.outputPath(`${role}-${index}-200-percent.png`), animations: "disabled" });
      }
    }
  } finally { await context.close(); }
});
