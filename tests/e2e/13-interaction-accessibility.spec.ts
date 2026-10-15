/**
 * Builds on the synthetic family, clinic and lead from the earlier journeys. Exercises opened states rather than only resting pages.
 * No care, stock, access or merge decision is submitted. Two isolated synthetic child registrations supply a duplicate-review fixture;
 * one fixture is marked inactive and reactivated to verify rediscovery without registering a duplicate.
 * This checks rendered accessibility and keyboard recovery; it does not claim browser-zoom, screen-reader or camera validation.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { apiPost, env, escapeRe, journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";

const AXE = readFileSync(join(process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");

/** Reach the control through the normal tab order, without forcing focus onto a potentially unreachable control. */
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  for (let step = 0; step < 160; step++) {
    if (await target.evaluate((element) => document.activeElement === element)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target, "the control must be reachable in the normal keyboard order").toBeFocused();
}

async function scanOpened(page: Page, state: string) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (context: Document, options: object) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const { violations } = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return {
      violations: violations.map((violation) => `${violation.impact} ${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(" | ")}`),
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  expect(result, `${state}: ${JSON.stringify(result)}`).toEqual({ violations: [], overflow: false });
}

test("family and clinical lead can use nested menus and opened forms by keyboard; merge cancellation preserves each choice", async ({ browser }) => {
  test.setTimeout(420_000);
  const { clinicId, childId } = readVisitState();
  expect(clinicId && childId, "run the earlier isolated browser journeys first").toBeTruthy();
  const family = await signInFamily(browser);
  const lead = await signInStaff(browser, "lead");
  try {
    const f = family.page;
    await f.setViewportSize({ width: 375, height: 900 });
    await f.goto("/children");
    await f.keyboard.press("Tab");
    await expect(f.getByRole("link", { name: "Skip to main content" })).toBeFocused();
    await f.keyboard.press("Enter");
    await expect(f.locator("main")).toBeFocused();

    await f.reload();
    const menu = f.getByRole("button", { name: /^Menu/ });
    await tabTo(f, menu);
    await f.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    const signOut = f.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("button", { name: "Sign out", exact: true });
    await tabTo(f, signOut);
    await expect(signOut).toBeFocused();
    await f.keyboard.press("Enter");
    const signOutDialog = f.getByRole("dialog", { name: "Sign out of eVacTrack?" });
    await expect(signOutDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await f.keyboard.press("Shift+Tab");
    await expect(signOutDialog.getByRole("button", { name: "Sign out", exact: true })).toBeFocused();
    await f.keyboard.press("Tab");
    await expect(signOutDialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await scanOpened(f, "centered sign-out dialog");
    await f.keyboard.press("Escape");
    await expect(signOutDialog).not.toBeVisible();
    await expect(signOut).toBeFocused();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await f.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();

    const add = f.getByRole("region", { name: "Register a new child record" });
    await expect(add.getByText("Checking the clinic's privacy notice...")).toHaveCount(0, { timeout: 60_000 });
    await add.getByLabel("How well do you know the birth date?").selectOption("estimated");
    await expect(add.getByLabel("Earliest possible birth date")).toBeVisible();
    await expect(add.getByLabel("Latest possible birth date")).toBeVisible();
    await scanOpened(f, "family estimated-birth registration form");
    await f.goto(`/children/${childId}`);
    const correction = f.getByRole("button", { name: "Ask the clinic to correct a detail" });
    await tabTo(f, correction);
    await f.keyboard.press("Enter");
    await expect(f.getByLabel("Correct full name")).toBeVisible();
    await scanOpened(f, "family correction form");

    const l = lead.page;
    await l.setViewportSize({ width: 375, height: 900 });
    await l.goto(`/clinic/${clinicId}/today`);
    const clinicMenu = l.getByRole("button", { name: /^Menu/ });
    await tabTo(l, clinicMenu);
    await l.keyboard.press("Enter");
    await expect(clinicMenu).toHaveAttribute("aria-expanded", "true");
    await scanOpened(l, "opened clinic navigation");
    await l.keyboard.press("Escape");
    await expect(clinicMenu).toHaveAttribute("aria-expanded", "false");
    await expect(clinicMenu).toBeFocused();

    await l.goto(`/clinic/${clinicId}/children/${childId}`);
    const inactiveSummary = l.locator("summary").filter({ hasText: "Mark this record inactive" });
    await tabTo(l, inactiveSummary);
    await l.keyboard.press("Enter");
    const inactiveDetails = l.locator("details").filter({ has: inactiveSummary });
    await inactiveDetails.getByRole("radio", { name: "Another reason" }).check();
    await inactiveDetails.getByLabel("Reason", { exact: true }).fill("Keyboard check only; do not submit");
    const inactiveTrigger = inactiveDetails.getByRole("button", { name: "Mark inactive…", exact: true });
    await tabTo(l, inactiveTrigger);
    await l.keyboard.press("Enter");
    const inactiveGroup = l.getByRole("group", { name: "Confirm marking the record inactive" });
    await expect(inactiveGroup.getByRole("button", { name: "Keep it active" })).toBeFocused();
    await scanOpened(l, "inactive-record safe confirmation");
    await l.keyboard.press("Enter");
    await expect(inactiveGroup).toHaveCount(0);
    await expect(inactiveTrigger).toBeFocused();

    await l.goto(`/clinic/${clinicId}/inventory`);
    const repair = l.getByRole("button", { name: "Check and repair balances", exact: true });
    await tabTo(l, repair);
    await l.keyboard.press("Enter");
    const repairGroup = l.getByRole("group", { name: "Confirm balance repair" });
    await expect(repairGroup.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
    await scanOpened(l, "stock repair confirmation at phone width");
    await l.setViewportSize({ width: 1280, height: 900 });
    await scanOpened(l, "stock repair confirmation at desktop width");
    await l.keyboard.press("Enter");
    await expect(repairGroup).toHaveCount(0);
    await expect(repair).toBeFocused();

    // The only writes below create a new synthetic review fixture, and are refused outside the disposable E2E environment.
    const db = new URL(env.dbUrl);
    const app = new URL(env.baseUrl);
    expect(["localhost", "127.0.0.1"]).toContain(db.hostname);
    expect(db.port).toBe("55322");
    expect(["localhost", "127.0.0.1"]).toContain(app.hostname);
    expect(app.port).toBe("3100");
    const name = `Keyboard Review ${randomUUID()}`;
    const records: { childId: string; localRecordNo: string }[] = [];
    for (let index = 0; index < 2; index++) {
      const result = await apiPost(l, `/api/v1/clinics/${clinicId}/children`, { child: { displayName: name, dobPrecision: "unknown" }, confirmedDistinct: true, identityConfirmed: true });
      expect([200, 201], result.text).toContain(result.status);
      expect(result.body.data?.created, result.text).toBe(true);
      expect(result.body.data?.childId).toEqual(expect.any(String));
      expect(result.body.data?.localRecordNo).toEqual(expect.any(String));
      records.push({ childId: String(result.body.data!.childId), localRecordNo: String(result.body.data!.localRecordNo) });
    }
    await l.goto(`/clinic/${clinicId}/review`);
    const duplicate = l.getByRole("region", { name: new RegExp(`${escapeRe(name)} \\(${escapeRe(records[1]!.localRecordNo)}\\)`) }).filter({ hasText: records[0]!.localRecordNo });
    await expect(duplicate).toHaveCount(1);
    for (const record of records) {
      const keep = duplicate.getByRole("button", { name: `Same child — keep ${record.localRecordNo}`, exact: true });
      await tabTo(l, keep);
      await l.keyboard.press("Enter");
      const mergeGroup = duplicate.getByRole("group", { name: "Confirm merge" });
      const cancel = mergeGroup.getByRole("button", { name: "Do not merge", exact: true });
      await expect(cancel).toBeFocused();
      await expect(cancel).toHaveAttribute("aria-describedby", /.+/);
      await expect(mergeGroup.getByLabel("How you know they are the same child (recorded in the audit trail)")).toHaveAttribute("required", "");
      await scanOpened(l, `merge confirmation retaining ${record.localRecordNo}`);
      await l.keyboard.press("Enter");
      await expect(mergeGroup).toHaveCount(0);
      await expect(keep).toBeFocused();
    }
    // Cancellation must leave both separate records intact.
    for (const record of records) {
      const response = await l.request.get(`/api/v1/clinics/${clinicId}/children/${record.childId}`);
      expect(response.status()).toBe(200);
      expect((await response.json()).data.childId).toBe(record.childId);
    }
    const returning = records[0]!;
    const inactive = await apiPost(l, `/api/v1/clinics/${clinicId}/children/${returning.childId}/record-status`, { status: "inactive", reason: "moved" });
    expect(inactive.status, inactive.text).toBe(200);
    await l.goto(`/clinic/${clinicId}`);
    await l.getByLabel("Name or record number").fill(returning.localRecordNo);
    await l.getByRole("search").getByRole("button", { name: "Search", exact: true }).click();
    const hit = l.getByRole("list", { name: "Matching children" }).getByRole("link").filter({ hasText: returning.localRecordNo });
    await expect(hit).toContainText("Inactive record");
    await hit.click();
    await l.getByRole("button", { name: "Make the record active again…", exact: true }).click();
    const reactivate = l.getByRole("group", { name: "Confirm making the record active" });
    await expect(reactivate.getByRole("button", { name: "Keep it inactive" })).toBeFocused();
    await reactivate.getByRole("button", { name: "Yes, make it active", exact: true }).click();
    await expect(l.getByRole("region", { name: "Child identity" })).toContainText("Verified Record");
    await l.reload();
    await expect(l.getByRole("region", { name: "Child identity" })).toContainText("Verified Record");
  } finally {
    await family.context.close();
    await lead.context.close();
  }
});
