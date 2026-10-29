/** Runtime proof for Account form readiness. Creates only its own synthetic family; no shared fixture changes. */
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { account, assertAutoConfirmed, formAlert, journeyTest as test, PASSWORD, signIn, signUpFamily } from "./support";

test("Account profile and password saves use hydrated handlers and preserve real sign-in behavior", async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const email = account(`account-ready-${randomUUID()}`);
  const changedPassword = `Ready-${randomUUID()}-Strong!`;
  const updatedName = "Account Readiness Guardian";
  const since = new Date();
  let leakedFormQuery = false;
  // Record only a boolean, never URLs or password values in custom assertions or diagnostic output.
  context.on("request", request => {
    const url = new URL(request.url());
    if (url.pathname === "/account" && ["displayName", "locale", "next", "confirm", "phone", "language"].some(key => url.searchParams.has(key))) leakedFormQuery = true;
  });
  try {
    await signUpFamily(page, "Account Ready Parent", email);
    await page.goto("/account?portal=parents");
    const profile = page.getByRole("region", { name: "Your details", exact: true });
    const save = profile.getByRole("button", { name: "Save", exact: true });
    await expect(profile.locator("form")).toHaveAttribute("method", "post");
    await expect(save).toBeEnabled();
    await profile.getByLabel("Full name", { exact: true }).fill(updatedName);
    await profile.getByLabel("Language", { exact: true }).selectOption("fil");
    const profileWrite = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/me/profile" && response.request().method() === "POST");
    await save.click();
    expect((await profileWrite).status()).toBe(200);
    await expect(profile.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.reload();
    await expect(profile.getByLabel("Full name", { exact: true })).toHaveValue(updatedName);
    await expect(profile.getByLabel("Language", { exact: true })).toHaveValue("fil");
    expect(new URL(page.url()).searchParams.get("portal")).toBe("parents");

    const security = page.getByRole("region", { name: "Signing in", exact: true });
    const change = security.getByRole("button", { name: "Change password", exact: true });
    await expect(security.locator("form")).toHaveAttribute("method", "post");
    await expect(change).toBeEnabled();
    await security.getByLabel("New password", { exact: true }).fill(changedPassword);
    await security.getByLabel("Type the new password again", { exact: true }).fill(changedPassword);
    const passwordWrite = page.waitForResponse(response => new URL(response.url()).pathname === "/auth/v1/user" && response.request().method() === "PUT");
    await change.click();
    expect((await passwordWrite).status()).toBe(200);
    await expect(security.getByRole("status").filter({ hasText: "Your password has been changed." })).toBeVisible();
    await expect(security.getByLabel("New password", { exact: true })).toHaveValue("");
    await expect(security.getByLabel("Type the new password again", { exact: true })).toHaveValue("");
    expect(leakedFormQuery, "Account form values must never become page query parameters").toBe(false);
    await assertAutoConfirmed(email, since);

    const fresh = await browser.newContext();
    try {
      const signedIn = await fresh.newPage();
      await signIn(signedIn, email, changedPassword);
      await expect(signedIn).toHaveURL(/\/children$/);
      await expect(signedIn.getByRole("heading", { name: "My Children", exact: true })).toBeVisible();
      await signedIn.goto("/account?portal=parents");
      const saved = signedIn.getByRole("region", { name: "Your details", exact: true });
      await expect(saved.getByLabel("Full name", { exact: true })).toHaveValue(updatedName);
      await expect(saved.getByLabel("Language", { exact: true })).toHaveValue("fil");
    } finally { await fresh.close(); }
    const old = await browser.newContext();
    try {
      const refused = await old.newPage();
      await signIn(refused, email, PASSWORD);
      await expect(formAlert(refused)).toContainText("Invalid credentials");
      await expect(refused).toHaveURL(/\/sign-in/);
    } finally { await old.close(); }
  } finally { await context.close(); }
});

