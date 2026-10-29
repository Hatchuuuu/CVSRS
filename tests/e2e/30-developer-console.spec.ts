import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { personName } from "../../src/lib/person-name";
import { expect } from "@playwright/test";
import { apiPost, asDatabaseOwner, assertAutoConfirmed, enrolTotp, journeyTest as test, PASSWORD, readVisitState, signIn, signInFamily, signInStaff, signUpFamily } from "./support";

test("developer staff creation clears passwords and independent approval admits nurse, midwife and BHW", async ({ browser }) => {
  test.setTimeout(420_000);
  const { clinicId } = readVisitState();
  const admin = await signInStaff(browser, "admin");
  const lead = await signInStaff(browser, "lead");
  const peerContext = await browser.newContext();
  const peer = await peerContext.newPage();
  try {
    // Non-clinical grants need another access administrator, rather than a clinical-only approver.
    const peerEmail = `console-approver-${randomUUID()}@e2e.test`;
    const peerName = "Console Access Approver";
    await signUpFamily(peer, peerName, peerEmail);
    const requested = await apiPost(lead.page, `/api/v1/clinics/${clinicId}/staff`, { email: peerEmail, role: "tech_admin", capabilities: [] });
    expect(requested.status, requested.text).toBe(200);
    await admin.page.goto(`/clinic/${clinicId}/access`);
    await admin.page.getByRole("button", { name: `Approve access for ${peerName}`, exact: true }).click();
    await expect(admin.page.getByRole("status").filter({ hasText: "Access approved" })).toBeVisible();
    await peerContext.clearCookies();
    await signIn(peer, peerEmail, PASSWORD, true);
    await expect(peer).toHaveURL(/\/account\/security/);
    await enrolTotp(peer);
    await expect(peer).toHaveURL(new RegExp(`/developer/${clinicId}/staff`));
    await admin.page.goto(`/clinic/${clinicId}/admin`);
    await expect(admin.page).toHaveURL(new RegExp(`/developer/${clinicId}/staff$`));
    for (const [title, role] of [["Nurse", "clinical_staff"], ["Midwife", "clinical_staff"], ["BHW", "bhw"]]) {
      await admin.page.getByRole("link", { name: "Create staff account", exact: true }).click();
      const name = personName(`Console ${title} ${Date.now()}`);
      const email = `console-${randomUUID()}@e2e.test`;
      const password = `Synthetic-${randomUUID()}!`;
      const since = new Date();
      const form = admin.page.getByRole("region", { name: "Create staff account", exact: true });
      await expect(form.getByRole("button", { name: "Create staff account", exact: true })).toBeEnabled();
      await expect(form.getByRole("button", { name: "Create staff account", exact: true })).toHaveCSS("opacity", "1");
      await form.getByLabel("Full name", { exact: true }).fill(name);
      await form.getByLabel("Email address", { exact: true }).fill(email);
      await form.getByLabel("Clinic role", { exact: true }).selectOption(role!);
      await form.getByLabel("Job title (optional)").fill(title!);
      await form.getByLabel("Temporary password", { exact: true }).fill(password);
      if (title === "Nurse") await admin.page.route(`**/api/v1/clinics/${clinicId}/staff-accounts`, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await route.abort("failed");
      }, { times: 1 });
      await form.getByRole("button", { name: "Create staff account", exact: true }).click();
      if (title === "Nurse") {
        await expect(form.getByRole("alert")).toBeVisible();
        await form.getByRole("button", { name: "Create staff account", exact: true }).click();
      }
      await expect(form.getByText("Staff account created", { exact: true })).toBeVisible();
      await expect(form.getByLabel("Temporary password", { exact: true })).toHaveValue("");
      await expect(admin.page.locator("body")).not.toContainText(password);
      await assertAutoConfirmed(email, since);
      if (title === "Nurse") {
        const count = await asDatabaseOwner(async (db) => (await db.query("select count(*)::int n from auth.users where lower(email)=lower($1)", [email])).rows[0] as { n: number });
        expect(count.n).toBe(1);
        const details = { fullName: name, email, temporaryPassword: password, role };
        expect((await apiPost(admin.page, `/api/v1/clinics/${clinicId}/staff-accounts`, details)).status).toBe(409);
        const invalid = await apiPost(admin.page, `/api/v1/clinics/${clinicId}/staff-accounts`, { ...details, email: `invalid-${randomUUID()}@e2e.test`, role: "owner" });
        expect(invalid.status).toBe(422);
      }
      await admin.page.getByRole("link", { name: "Back to staff accounts", exact: true }).click();
      await admin.page.waitForURL(new RegExp(`/developer/${clinicId}/staff$`));
      await expect(admin.page.getByRole("button", { name: `Approve access for ${name}`, exact: true })).toHaveCount(0);
      await admin.page.reload();
      await expect(admin.page.getByRole("region", { name: "Access waiting for approval", exact: true })).toContainText(name);
      const approver = role === "bhw" ? peer : lead.page;
      await approver.goto(`/clinic/${clinicId}/access`);
      await approver.getByRole("button", { name: `Approve access for ${name}`, exact: true }).click();
      await expect(approver.getByRole("status").filter({ hasText: "Access approved" })).toBeVisible();
      const staffContext = await browser.newContext();
      try {
        const page = await staffContext.newPage();
        await signIn(page, email, password, true);
        await expect(page).toHaveURL(/\/account\/security/);
        await enrolTotp(page);
        await expect(page).toHaveURL(new RegExp(`/clinic/${clinicId}`));
        await page.goto(`/developer/${clinicId}/staff`);
        await expect(page.getByText("This page is unavailable to your account")).toBeVisible();
      } finally { await staffContext.close(); }
    }
  } finally { await admin.context.close(); await lead.context.close(); await peerContext.close(); }
});

test("developer settings, recorded operations and sanitized audit work on narrow and wide screens", async ({ browser }, info) => {
  test.setTimeout(180_000);
  const { clinicId } = readVisitState();
  const admin = await signInStaff(browser, "admin");
  try {
    await admin.page.goto(`/developer/${clinicId}/settings`);
    const hours = admin.page.getByLabel("Opening hours");
    const original = await hours.inputValue();
    const changed = `Synthetic console hours ${Date.now()}`;
    await hours.fill(changed);
    await admin.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await admin.page.reload(); await expect(hours).toHaveValue(changed);
    await hours.fill(original); await admin.page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    for (const width of [390, 768, 1440]) {
      await admin.page.setViewportSize({ width, height: 1000 });
      for (const path of ["staff", "staff/create", "settings", "operations", "audit"]) {
        await admin.page.goto(`/developer/${clinicId}/${path}`);
        await expect(admin.page.locator("main h1")).toBeVisible();
        if (path === "staff/create") {
          const create = admin.page.getByRole("button", { name: "Create staff account", exact: true });
          await expect(create).toBeEnabled();
          await expect(create).toHaveCSS("opacity", "1");
        }
        expect(await admin.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        await admin.page.addScriptTag({ content: readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8") });
        const violations = await admin.page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run(node: Document, options: object): Promise<{ violations: { id: string }[] }> } }).axe;
          return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => v.id);
        });
        expect(violations, `${path} at ${width}px`).toEqual([]);
        await admin.page.screenshot({ path: info.outputPath(`developer-${path.replaceAll("/", "-")}-${width}.png`), fullPage: true, animations: "disabled" });
      }
    }
    await expect(admin.page.locator("main")).toContainText("clinic.profile_changed");
    await expect(admin.page.locator("main")).not.toContainText("child.created");
    await admin.page.goto(`/developer/${clinicId}/operations`);
    await admin.page.getByRole("button", { name: "Refresh status" }).click();
    await expect(admin.page.getByRole("region", { name: "Recorded backup and restore evidence" })).toBeVisible();
    await admin.page.getByRole("link", { name: "Open local operations runbook" }).click();
    await expect(admin.page.getByRole("heading", { name: "Local operations runbook" })).toBeVisible();
  } finally { await admin.context.close(); }
});

test("parent, clinical-only, foreign-clinic and missing-MFA sessions cannot read technical console data", async ({ browser }) => {
  test.setTimeout(180_000);
  const { clinicId } = readVisitState();
  const family = await signInFamily(browser);
  const nurse = await signInStaff(browser, "nurse");
  const admin = await signInStaff(browser, "admin");
  try {
    await family.page.goto(`/developer/${clinicId}/audit`);
    await expect(family.page).toHaveURL(/\/clinic$/);
    await nurse.page.goto(`/developer/${clinicId}/audit`);
    await expect(nurse.page.getByText("This page is unavailable to your account")).toBeVisible();
    const foreign = await asDatabaseOwner(async (db) => (await db.query("select id from public.clinics where id<>$1 limit 1", [clinicId])).rows[0] as { id: string } | undefined);
    const foreignClinicId = foreign?.id ?? randomUUID();
    await admin.page.goto(`/developer/${foreignClinicId}/audit`);
    await expect(admin.page).toHaveURL(new RegExp(`/developer/${clinicId}/staff$`));
    expect([403, 404]).toContain((await admin.page.request.get(`/api/v1/clinics/${foreignClinicId}/staff`)).status());
    const firstStep = await browser.newContext();
    try {
      const page = await firstStep.newPage();
      await signIn(page, "admin@e2e.example.test", undefined, true);
      await expect(page).toHaveURL(/\/account\/security/);
      await page.goto(`/developer/${clinicId}/staff`);
      await expect(page).toHaveURL(/\/account\/security/);
      await expect(page.getByRole("heading", { name: "Staff accounts and access" })).toHaveCount(0);
    } finally { await firstStep.close(); }
    expect((await apiPost(family.page, `/api/v1/clinics/${clinicId}/staff-accounts`, { fullName: "Denied staff", email: `denied-${randomUUID()}@e2e.test`, temporaryPassword: "Synthetic denied password", role: "bhw" })).status).toBe(403);
  } finally { await family.context.close(); await nurse.context.close(); await admin.context.close(); }
});
