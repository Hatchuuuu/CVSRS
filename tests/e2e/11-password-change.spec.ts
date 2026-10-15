import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { PASSWORD, account, asDatabaseOwner, assertAutoConfirmed, env, formAlert, journeyTest as test, linkFromInbox, readState, signIn, signInStaff, signOut, signUpFamily, verifyTotp } from "./support";

const NEW = "A changed account password 2026";
const NEXT = "Another changed account password 2026";
async function fill(page: Page, password: string, confirm = password) {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Type the new password again").fill(confirm);
}
const success = (page: Page) => expect(page.getByRole("status").filter({ hasText: "Your password has been changed." })).toBeVisible();

test("Account password change validates inputs, handles uncertain responses, and changes the actual login without confirmation mail", async ({ page }) => {
  test.setTimeout(180_000);
  const email = account(`password-${randomUUID()}`);
  const since = new Date();
  await signUpFamily(page, "Password Test Guardian", email);
  await page.goto("/account");
  const button = page.getByRole("button", { name: "Change password", exact: true });
  let writes = 0;
  page.on("request", (request) => { if (request.url().endsWith("/auth/v1/user") && request.method() === "PUT") writes++; });
  await fill(page, "short");
  await button.click();
  expect(await page.getByLabel("New password", { exact: true }).evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
  await fill(page, NEW, NEXT);
  await button.click();
  await expect(formAlert(page)).toContainText("do not match");
  expect(writes).toBe(0);
  await fill(page, PASSWORD);
  await button.click();
  await expect(formAlert(page)).toContainText("already your current password");

  await fill(page, NEW);
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await hold; await route.continue();
  });
  const before = writes;
  await button.locator("..").evaluate((fieldset) => {
    const form = fieldset.closest("form")!;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(button).toBeDisabled();
  await expect(page.getByLabel("New password", { exact: true })).toBeDisabled();
  release();
  await success(page);
  expect(writes - before).toBe(1);
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  await page.unroute("**/auth/v1/user");

  await fill(page, NEXT);
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Service unavailable" }) });
  });
  await button.click();
  await expect(formAlert(page)).toContainText("could not confirm");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue(NEXT);
  await page.unroute("**/auth/v1/user");

  // Lose the response after Auth really saves: recovery must work with the new password.
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const saved = await route.fetch();
    expect(saved.ok()).toBe(true);
    await route.abort("failed");
  });
  await button.click();
  await expect(formAlert(page)).toContainText("could not confirm");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue(NEXT);
  await page.unroute("**/auth/v1/user");
  await signOut(page);
  await signIn(page, email, NEW);
  await expect(formAlert(page)).toContainText("Invalid credentials");
  await signIn(page, email, NEXT);
  await expect(page).toHaveURL(/\/children$/);
  await page.reload();
  await expect(page).toHaveURL(/\/children$/);
  await assertAutoConfirmed(email, since);
});

test("an old or missing session has a working sign-in recovery path without a verification email", async ({ page }) => {
  const email = account(`password-old-${randomUUID()}`);
  const since = new Date();
  await signUpFamily(page, "Password Session Test", email);
  await asDatabaseOwner(async (db) => {
    expect(new URL(env.dbUrl).port).toBe("55322");
    const result = await db.query("update auth.sessions set created_at = now() - interval '25 hours' where user_id = (select id from auth.users where lower(email) = $1)", [email]);
    expect(result.rowCount).toBeGreaterThan(0);
  });
  await page.goto("/account");
  await fill(page, NEW);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(formAlert(page)).toContainText("sign out and sign in again");
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue(NEW);
  await assertAutoConfirmed(email, since);
  await signOut(page);
  await signIn(page, email, PASSWORD);
  await expect(page).toHaveURL(/\/children$/);
  await page.goto("/account");
  await fill(page, NEW);
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await success(page);
  await fill(page, NEXT);
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Change password", exact: true }).click();
  await expect(formAlert(page)).toContainText("sign out and sign in again");
  await signIn(page, email, NEW);
  await expect(page).toHaveURL(/\/children$/);
});

test("a staff password change preserves aal2 access and the next sign-in still requires MFA", async ({ browser }) => {
  test.setTimeout(180_000);
  const { clinicId, totp } = readState();
  const staff = await signInStaff(browser, "lead");
  let changed = false;
  try {
    await staff.page.goto("/account");
    await fill(staff.page, NEW);
    await staff.page.getByRole("button", { name: "Change password", exact: true }).click();
    await success(staff.page);
    changed = true;
    expect((await staff.page.request.get(`/api/v1/clinics/${clinicId}/sessions`)).status()).toBe(200);
    await signOut(staff.page);
    await signIn(staff.page, account("lead"), PASSWORD, true);
    await expect(formAlert(staff.page)).toContainText("Invalid credentials");
    await signIn(staff.page, account("lead"), NEW, true);
    await expect(staff.page).toHaveURL(/\/account\/security/);
    expect((await staff.page.request.get(`/api/v1/clinics/${clinicId}/sessions`)).status()).toBe(403);
    await verifyTotp(staff.page, totp!.lead!);
    expect((await staff.page.request.get(`/api/v1/clinics/${clinicId}/sessions`)).status()).toBe(200);
  } finally {
    if (changed) {
      await staff.page.goto("/account");
      await fill(staff.page, PASSWORD);
      await staff.page.getByRole("button", { name: "Change password", exact: true }).click();
      await success(staff.page);
    }
    await staff.context.close();
  }
  expect(env.dbUrl).toContain(":55322/");
});

test("password recovery still saves, clears sensitive fields and allows only the new password", async ({ page }) => {
  const email = account(`password-reset-${randomUUID()}`);
  await signUpFamily(page, "Password Recovery Test", email);
  await signOut(page);
  const since = new Date();
  await page.goto("/account/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that address has an account");
  await page.goto(await linkFromInbox(email, /reset/i, since));
  await expect(page).toHaveURL(/\/account\/reset-password/);
  await page.getByLabel("New password", { exact: true }).fill(NEW);
  await page.getByLabel("Confirm new password").fill(NEW);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your password has been updated." })).toBeVisible();
  await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Confirm new password")).toHaveValue("");
  await expect(page.getByRole("link", { name: "Continue to your account" })).toBeVisible();
  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await expect(formAlert(page)).toContainText("Invalid credentials");
  await signIn(page, email, NEW);
  await expect(page).toHaveURL(/\/children$/);
});
