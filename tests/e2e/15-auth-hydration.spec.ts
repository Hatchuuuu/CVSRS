import { expect, test } from "@playwright/test";

test("authentication cannot accidentally submit a native GET while JavaScript is unavailable", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    for (const path of ["/sign-in", "/sign-up", "/evactrackstafflogin", "/evactrackstafflogin/create-account"]) {
      await page.goto(path);
      await expect(page.locator('button[type="submit"]')).toBeDisabled();
      await expect(page.locator('input[type="email"]')).toBeDisabled();
    }
  } finally { await context.close(); }
});
