/**
 * Automated accessibility scan (axe-core, WCAG 2.0–2.2 A/AA rules) of the public legal pages and the signed-in screens, with the real
 * records the earlier journeys created, at phone and desktop widths. Also checks for horizontal scrolling. Automated rules catch only part of
 * WCAG; keyboard, screen-reader and zoom checks remain manual (docs/implementation/known-limitations.md L32).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { NEW_PASSWORD, account, readVisitState, signIn, signInStaff } from "./support";

const AXE = readFileSync(join(process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");

async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (c: Document, o: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return {
      violations: r.violations.map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`),
      overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
  return { path, ...result };
}

for (const width of [375, 1280]) {
  test(`signed-in family and staff screens have no automated WCAG A/AA violations at ${width}px`, async ({ browser, page }) => {
    test.setTimeout(300_000);
    const { clinicId, childId } = readVisitState();
    expect(clinicId && childId, "run the earlier journeys first (npm run test:e2e)").toBeTruthy();
    const results = [];

    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/terms", "/privacy", "/accessibility"]) results.push(await scan(page, path));
    await signIn(page, account("parent"), NEW_PASSWORD);
    await expect(page).toHaveURL(/\/children/);
    for (const path of ["/children", `/children/${childId}`, "/messages", "/help", "/account", "/account/security"]) results.push(await scan(page, path));

    for (const who of ["nurse", "lead", "admin"]) {
      const { context, page: staff } = await signInStaff(browser, who);
      await staff.setViewportSize({ width, height: 900 });
      const paths = {
        nurse: ["today", `children/${childId}`, "inventory", "followup", ""],
        lead: ["review", "clinical", "reports", "transfers", "questions"],
        admin: ["admin", "access", "settings", "content", "audit"],
      }[who]!;
      for (const p of paths) results.push(await scan(staff, `/clinic/${clinicId}${p ? `/${p}` : ""}`));
      await context.close();
    }

    const problems = results.filter((r) => r.violations.length || r.overflow);
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });
}
