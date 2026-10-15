import { expect, test } from "@playwright/test";

test("reduced motion keeps public CTA arrows still on hover and link presses still", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const cta = page.getByRole("link", { name: "Create a family account", exact: true }).first();
  await cta.hover();
  expect(await cta.locator("svg").evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  const box = await cta.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  try {
    expect(await cta.evaluate((el) => getComputedStyle(el).transform)).toBe("none");
  } finally {
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
});

test("keyboard service and FAQ text is immediately readable", async ({ page }) => {
  await page.goto("/");
  const tabs = page.getByRole("tab");
  await tabs.first().focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
  const text = page.locator('.lp-panel:not([hidden]) .lp-panel-body');
  expect(await text.evaluate((el) => ({ animation: getComputedStyle(el).animationName, opacity: getComputedStyle(el).opacity }))).toEqual({ animation: "none", opacity: "1" });
  await page.locator("summary").filter({ hasText: "Where do the due dates come from?" }).focus();
  await page.keyboard.press("Enter");
  const answer = page.locator("details[open] .lp-faq-answer p");
  await expect(answer).toBeVisible();
  expect(await answer.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
