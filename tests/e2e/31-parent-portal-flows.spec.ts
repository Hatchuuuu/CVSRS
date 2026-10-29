import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { journeyTest as test, signInFamily } from "./support";

test("parent task pages and destinations remain accessible across desktop tablet and phone", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const family = await signInFamily(browser);
  try {
    await family.context.route("**/*", route => {
      const host = new URL(route.request().url()).hostname;
      return ["localhost", "127.0.0.1", "[::1]"].includes(host) ? route.continue() : route.abort();
    });
    await family.page.emulateMedia({ reducedMotion: "reduce" });
    for (const width of [390, 768, 1440]) {
      await family.page.setViewportSize({ width, height: 1000 });
      for (const path of ["/children", "/children/register", "/children/link", "/vaccination-records", "/appointments", "/help", "/messages?portal=parents", "/account?portal=parents"]) {
        await family.page.goto(path);
        await expect(family.page.locator("main h1")).toBeVisible();
        if (path.startsWith("/account?")) {
          const save = family.page.getByRole("region", { name: "Your details", exact: true }).getByRole("button", { name: "Save", exact: true });
          await expect(save).toBeEnabled();
          await expect(save).toHaveCSS("opacity", "1");
        }
        await expect(family.page.getByRole("heading", { name: /Something went wrong|Page unavailable/, exact: true })).toHaveCount(0);
        if (path === "/children/register" || path === "/children/link") {
          const submit = family.page.getByRole("button", { name: path === "/children/register" ? "Add child" : "Send request", exact: true });
          await expect(submit).toBeEnabled();
          // Privacy readiness enables the control before its disabled-opacity transition finishes.
          await expect(submit).toHaveCSS("opacity", "1");
        }
        expect(await family.page.evaluate(() => document.documentElement.scrollWidth), `${path} width ${width}`).toBeLessThanOrEqual(width + 1);
        await family.page.addScriptTag({ content: readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8") });
        const violations = await family.page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run(node: Document, options: object): Promise<{ violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> } }).axe;
          return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, failureSummary: n.failureSummary })) }));
        });
        expect(violations, `${path} width ${width}`).toEqual([]);
        await family.page.screenshot({ path: info.outputPath(`${path.split("?")[0]!.replaceAll("/", "-")}-${width}.png`), fullPage: true, animations: "disabled" });
      }
    }
    await family.page.goto("/children");
    await expect(family.page.getByLabel("Child's given name(s)", { exact: true })).toHaveCount(0);
    await family.page.getByRole("link", { name: "Register a child", exact: true }).first().click();
    await expect(family.page).toHaveURL(/\/children\/register$/);
    await family.page.getByRole("link", { name: "Cancel and return to My Children", exact: true }).click();
    await expect(family.page).toHaveURL(/\/children$/);
    await family.page.goto("/messages#txt-h");
    await family.page.getByRole("link", { name: "Open contact preferences", exact: true }).click();
    await expect(family.page).toHaveURL(/\/account\?.*#contact-h$/);
    await expect(family.page.getByRole("region", { name: "Contact preferences", exact: true })).toBeInViewport();
  } finally { await family.context.close(); }
});
