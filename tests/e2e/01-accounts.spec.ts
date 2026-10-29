/**
 * Accounts on real Supabase Auth: immediate family sign-up, sign-in, wrong password, password reset, and the
 * password rule enforced by Auth itself (not only by this app's form).
 */
import { expect, test } from "@playwright/test";
import { LEGAL_VERSION } from "../../src/lib/legal";
import { NEW_PASSWORD, PASSWORD, account, assertAutoConfirmed, env, formAlert, linkFromInbox, resetState, signIn, signOut, signUpFamily } from "./support";

test.beforeAll(() => resetState());

test("a family signs up and immediately lands in the signed-in family portal without a confirmation email", async ({ page }) => {
  const email = account("parent");
  await signUpFamily(page, "Maria Santos", email);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Workspace sidebar" }).getByRole("link", { name: "Settings / Account", exact: true })).toBeVisible();

  // Retrying signup must not create another account, send confirmation mail, or destroy the active session.
  const retryAt = new Date();
  const duplicate = await page.request.post("/auth/sign-up", {
    headers: { origin: new URL(page.url()).origin, "content-type": "application/json" },
    data: { email, password: PASSWORD, fullName: "Maria Santos", phone: "0917 123 4567", termsVersion: LEGAL_VERSION },
  });
  expect(duplicate.status()).toBeGreaterThanOrEqual(400);
  expect(duplicate.status()).toBeLessThan(500);
  await assertAutoConfirmed(email, retryAt);
  await page.reload();
  await expect(page).toHaveURL(/\/children$/);
});

test("sign out, a wrong password is refused, the right one signs in", async ({ page }) => {
  const email = account("parent");
  await signIn(page, email);
  await expect(page).toHaveURL(/\/children/);
  await signOut(page);
  // Signed out means signed out: the portal sends you back to sign in.
  await page.goto("/children");
  await expect(page).toHaveURL(/\/sign-in/);

  await signIn(page, email, "Not the password 2026");
  await expect(formAlert(page)).toContainText("Invalid credentials");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a forgotten password is reset from the emailed link, and only the new password works afterwards", async ({ page }) => {
  const email = account("parent");
  const since = new Date();
  await page.goto("/account/forgot-password");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that address has an account");

  await page.goto(await linkFromInbox(email, /reset/i, since));
  await expect(page).toHaveURL(/\/account\/reset-password/);
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your password has been updated." })).toBeVisible();

  await page.context().clearCookies();
  await signIn(page, email, PASSWORD);
  await expect(formAlert(page)).toContainText("Invalid credentials");
  await signIn(page, email, NEW_PASSWORD);
  await expect(page).toHaveURL(/\/children/);
});

test("Supabase Auth itself refuses a short password sent straight to it with the public key (release gate F49)", async ({ request }) => {
  const res = await request.post(`${env.apiUrl}/auth/v1/signup`, {
    headers: { apikey: env.publishableKey, "content-type": "application/json" },
    data: { email: account("bypass"), password: "short-pass1" },
  });
  expect(res.status()).toBe(422);
  expect((await res.json()).error_code).toBe("weak_password");
});

test("an unknown address gets the same reset answer as a real one (no account discovery)", async ({ page }) => {
  await page.goto("/account/forgot-password");
  await page.getByLabel("Email address").fill(account("nobody"));
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If that address has an account");
});
