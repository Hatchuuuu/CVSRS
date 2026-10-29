import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "@playwright/test";
import { apiGet, apiPost, journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";

test("reorganized staff record preserves identity, guardian permissions, corrections, QR and notes", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const { clinicId } = readVisitState();
  const family = await signInFamily(browser);
  const bhw = await signInStaff(browser, "bhw");
  const nurse = await signInStaff(browser, "nurse");
  try {
    const created = await apiPost(family.page, "/api/v1/children", { clinicId, child: { displayName: `Record Layout ${Date.now()}`, dobPrecision: "unknown" }, relationship: "mother" });
    expect(created.status, created.text).toBe(200);
    const childId = String(created.body.data!.childId);
    const path = `/clinic/${clinicId}/children/${childId}`;
    const b = bhw.page;
    await b.goto(path);
    await expect(b.getByText("Complete registration verification", { exact: true })).toBeVisible();
    const actions = b.getByRole("region", { name: "Record actions", exact: true });
    const guardians = b.getByRole("region", { name: "Guardians", exact: true });
    await expect(guardians).toContainText("Guardian verification requires an authorized staff member");
    await expect(guardians.getByRole("button", { name: "Verify this guardian", exact: true })).toHaveCount(0);
    const child = await apiGet<{ guardians: { relationshipId: string }[] }>(b, `/api/v1/clinics/${clinicId}/children/${childId}`);
    expect((await apiPost(b, `/api/v1/clinics/${clinicId}/relationships/${child.data!.guardians[0]!.relationshipId}/verify`, { method: "in_person_id" })).status).toBe(403);
    await actions.getByRole("button", { name: "Confirm child identity", exact: true }).click();
    await expect(actions.getByRole("status").filter({ hasText: "Identity confirmed" })).toBeVisible();
    // The success notice precedes router.refresh(); button removal confirms the new record version reached the UI.
    await expect(actions.getByRole("button", { name: "Confirm child identity", exact: true })).toHaveCount(0);
    const corrections = b.getByRole("region", { name: "Correct identity details", exact: true });
    await expect(corrections.getByLabel("Full name", { exact: true })).toBeHidden();
    await corrections.locator("summary").click();
    const updatedName = `Layout Checked ${Date.now()}`;
    await corrections.getByLabel("Full name", { exact: true }).fill(updatedName);
    await corrections.getByLabel("Address", { exact: true }).fill("Synthetic address for layout verification");
    await corrections.getByLabel("Reason for the change").fill("Synthetic checked identity correction");
    await corrections.getByRole("button", { name: "Save corrections", exact: true }).click();
    await expect(corrections.getByRole("status").filter({ hasText: "Details updated" })).toBeVisible();
    await b.reload();
    await expect(b.getByRole("heading", { level: 1 })).toHaveText(updatedName);
    await expect(b.getByText("Synthetic address for layout verification", { exact: false }).first()).toBeVisible();
    await actions.getByRole("button", { name: "Issue QR pass", exact: true }).click();
    await actions.getByRole("button", { name: "Keep the current pass", exact: true }).click();
    await actions.getByRole("button", { name: "Issue QR pass", exact: true }).click();
    const qrResponse = b.waitForResponse(response => response.url().endsWith(`/children/${childId}/qr`) && response.request().method() === "POST");
    await actions.getByRole("button", { name: "Yes, issue a new pass", exact: true }).click();
    const pass = await (await qrResponse).json() as { data: { token: string } };
    await expect(actions.getByRole("img", { name: /QR pass for/ })).toBeVisible();
    const resolved = await apiPost(b, `/api/v1/clinics/${clinicId}/qr/resolve`, { token: pass.data.token });
    expect(resolved.status, resolved.text).toBe(200);
    expect(resolved.body.data!.childId).toBe(childId);
    const notes = b.getByRole("region", { name: "Staff notes", exact: true });
    await notes.getByLabel("Note type").selectOption("follow_up");
    await notes.getByLabel("Staff observation").fill("Synthetic follow-up note from the redesigned staff record");
    await notes.getByRole("button", { name: "Add note", exact: true }).click();
    await expect(notes.getByRole("status").filter({ hasText: "Note saved" })).toBeVisible();
    await family.page.goto(`/children/${childId}`);
    await expect(family.page.getByRole("region", { name: "Notes from the clinic", exact: true })).toHaveCount(0);
    await nurse.page.goto(path);
    const nurseGuardians = nurse.page.getByRole("region", { name: "Guardians", exact: true });
    await nurseGuardians.getByLabel("Verified by", { exact: true }).selectOption("in_person_id");
    await nurseGuardians.getByRole("button", { name: "Verify this guardian", exact: true }).click();
    await expect(nurseGuardians.getByRole("status").filter({ hasText: "Guardian verified" })).toBeVisible();
    await family.page.reload();
    await expect(family.page.getByRole("region", { name: "Vaccination history", exact: true })).toBeVisible();
    await expect(family.page.getByRole("region", { name: "Notes from the clinic", exact: true })).toContainText("Synthetic follow-up note from the redesigned staff record");
    await b.reload();
    await b.screenshot({ path: info.outputPath("verified-bhw-record.png"), fullPage: true, animations: "disabled" });
  } finally { await family.context.close(); await bhw.context.close(); await nurse.context.close(); }
});

test("staff record hierarchy and section links remain accessible across roles and screen sizes", async ({ browser }, info) => {
  test.setTimeout(300_000);
  const { clinicId, childId } = readVisitState();
  const errors: string[] = [];
  for (const role of ["bhw", "nurse", "lead"]) {
    const staff = await signInStaff(browser, role);
    staff.page.on("pageerror", error => errors.push(error.message));
    try {
      for (const width of [390, 768, 1440]) {
        const p = staff.page;
        await p.setViewportSize({ width, height: 1000 });
        await p.goto(`/clinic/${clinicId}/children/${childId}`);
        await expect(p.getByRole("navigation", { name: "Child record sections", exact: true })).toBeVisible();
        expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await p.addScriptTag({ content: readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8") });
        const violations = await p.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: { id: string }[] }> } }).axe;
          return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => v.id);
        });
        expect(violations).toEqual([]);
        if (role === "bhw") {
          await expect(p.getByRole("region", { name: "Vaccination history", exact: true })).toHaveCount(0);
          await expect(p.getByRole("navigation", { name: "Child record sections" }).getByRole("link", { name: "Vaccination history", exact: true })).toHaveCount(0);
        } else await expect(p.getByRole("region", { name: "Vaccination history", exact: true })).toBeVisible();
        await p.screenshot({ path: info.outputPath(`${role}-record-${width}.png`), fullPage: true, animations: "disabled" });
        await p.getByRole("navigation", { name: "Child record sections" }).getByRole("link", { name: "Staff notes", exact: true }).click();
        await expect(p.getByRole("heading", { name: "Staff notes", exact: true })).toBeInViewport();
        const headingTop = await p.locator("#notes-h").evaluate(el => el.getBoundingClientRect().top);
        const headerBottom = await p.locator("[data-site-header]").evaluate(el => el.getBoundingClientRect().bottom);
        expect(headingTop).toBeGreaterThanOrEqual(headerBottom - 1);
        if (width >= 768) {
          const observation = await p.getByLabel("Staff observation").boundingBox();
          const section = await p.getByRole("region", { name: "Staff notes", exact: true }).boundingBox();
          expect(observation!.width).toBeGreaterThan(section!.width * 0.9);
        }
      }
    } finally { await staff.context.close(); }
  }
  expect(errors).toEqual([]);
});
