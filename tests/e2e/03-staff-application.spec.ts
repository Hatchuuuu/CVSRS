/**
 * Staff onboarding: a nurse creates a staff account and applies; the access administrator accepts; a clinical lead (a second
 * person) approves; only then, and only after the nurse's own two-step setup, does the clinic workspace open.
 */
import { expect, test } from "@playwright/test";
import { PASSWORD, account, asDatabaseOwner, assertAutoConfirmed, enrolTotp, readState, signIn, verifyTotp, writeState } from "./support";

const NURSE = "Nora Nurse";

test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const probes: { path: string; status: number | null; elapsedMs: number }[] = [];
  for (const path of ["/api/v1/health/ready", "/clinic"]) {
    const began = Date.now();
    let status: number | null = null;
    try { status = (await page.request.get(path, { maxRedirects: 0, timeout: 5000 })).status(); } catch { /* Preserve only timing/status, never credentials or response bodies. */ }
    probes.push({ path, status, elapsedMs: Date.now() - began });
  }
  await info.attach("navigation-server-probe", { body: JSON.stringify(probes), contentType: "application/json" });
});

test("a nurse applies to the health center while creating a staff account", async ({ page }) => {
  const since = new Date();
  await page.goto("/evactrackstafflogin/create-account");
  await page.getByLabel("Full name (as your clinic knows you)").fill(NURSE);
  await page.getByLabel("Work email address (used to sign in)").fill(account("nurse"));
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByLabel("Type the password again").fill(PASSWORD);
  await page.getByLabel("Health center", { exact: true }).selectOption({ label: "E2E Health Center" });
  await page.getByLabel("Role you are applying for").selectOption("clinical_staff");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Create staff account and apply/ }).click();
  await expect(page).toHaveURL(/\/clinic$/);
  await assertAutoConfirmed(account("nurse"), since);
  await page.reload();
  await expect(page).toHaveURL(/\/clinic$/);
  // No access yet: the workspace shows where the application stands.
  await expect(page.getByText(/Waiting for an administrator/i)).toBeVisible();
});

test("the administrator accepts; they cannot also approve; the clinical lead approves", async ({ browser }) => {
  const { clinicId, totp } = readState();

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  await signIn(admin, account("admin"), undefined, true);
  await verifyTotp(admin, totp!.admin!);
  await admin.goto(`/developer/${clinicId}/staff`);
  await expect(admin.getByRole("button", { name: /^Account menu for/ })).toBeEnabled();
  await admin.getByRole("button", { name: `Accept application from ${NURSE}` }).click();
  await admin.getByRole("button", { name: "Accept and send for approval" }).click();
  // The outcome persists on the page: the application leaves the queue and waits for someone else to approve it.
  await expect(admin.getByText("No applications waiting")).toBeVisible();
  await expect(admin.getByText("You requested this, so someone else must approve it.")).toBeVisible();

  // The person who accepted is not offered approval, and the database refuses it if they try anyway.
  await admin.goto(`/clinic/${clinicId}/access`);
  await expect(admin.getByText(NURSE).first()).toBeVisible();
  await expect(admin.getByRole("button", { name: `Approve access for ${NURSE}` })).toHaveCount(0);
  const membership = await asDatabaseOwner(async (db) =>
    (await db.query("select m.id, m.version from public.staff_memberships m join auth.users u on u.id = m.profile_id where lower(u.email) = $1", [account("nurse")])).rows[0] as { id: string; version: number });
  const forced = await admin.request.post(`/api/v1/clinics/${clinicId}/staff/${membership.id}/approve`, {
    headers: { "idempotency-key": crypto.randomUUID(), origin: new URL(admin.url()).origin, "content-type": "application/json" },
    data: { expectedVersion: membership.version },
  });
  expect([403, 409]).toContain(forced.status());
  await adminCtx.close();

  const leadCtx = await browser.newContext();
  const lead = await leadCtx.newPage();
  await signIn(lead, account("lead"), undefined, true);
  await verifyTotp(lead, totp!.lead!);
  await lead.goto(`/clinic/${clinicId}/access`);
  await lead.getByRole("button", { name: `Approve access for ${NURSE}` }).click();
  await expect(lead.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
  await leadCtx.close();
});

test("the approved nurse sets up two-step sign-in and gets the clinical workspace, but not administration", async ({ page }) => {
  const { clinicId } = readState();
  await signIn(page, account("nurse"), undefined, true);
  await expect(page).toHaveURL(/\/account\/security/);
  const secret = await enrolTotp(page);
  writeState({ totp: { nurse: secret } });
  await expect(page).toHaveURL(new RegExp(`/clinic/${clinicId}`));
  await expect(page.getByRole("link", { name: "Today" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Staff access" })).toHaveCount(0);
  // Hidden menus are not the protection: the pages and the API refuse too.
  // The clinic segment streams its loading shell first, so Next answers 200 and renders the not-found view in place (with noindex);
  // what matters is that no staff-access content is sent. Recorded as an accepted trade-off for audit finding F10.
  const access = await page.goto(`/clinic/${clinicId}/access`);
  const html = (await access?.text()) ?? "";
  await expect(page.getByText("This page is unavailable to your account")).toBeVisible();
  expect(html).not.toContain("Ana Admin");
  expect(html).not.toContain("Staff access records");
  expect((await page.request.get(`/api/v1/clinics/${clinicId}/audit`)).status()).toBe(403);
});
