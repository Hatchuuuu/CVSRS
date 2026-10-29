import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { account, apiGet, apiPost, clinicDate, familyDate, journeyTest as test, PASSWORD, readVisitState, signInFamily, signInStaff, signUpFamily } from "./support";

async function navigate(page: Page, name: string) {
  if (page.viewportSize()!.width < 1024) {
    await page.getByRole("button", { name: /^Menu/ }).click();
    await page.getByRole("navigation", { name: "Main navigation", exact: true }).getByRole("link", { name, exact: true }).click();
  } else await page.getByRole("complementary", { name: "Workspace sidebar" }).getByRole("link", { name, exact: true }).click();
}

test("family destinations navigate on phones and desktops, preserve verified records, and save account settings", async ({ browser }, info) => {
  test.setTimeout(240_000);
  const { childId } = readVisitState();
  const family = await signInFamily(browser);
  const errors: string[] = [];
  family.page.on("pageerror", error => errors.push(error.message));
  try {
    for (const width of [390, 768, 1440]) {
      await family.page.setViewportSize({ width, height: 1000 });
      for (const [name, path] of [["Vaccination records", "/vaccination-records"], ["Appointments", "/appointments"], ["Settings / Account", "/account"]]) {
        await navigate(family.page, name!);
        await expect(family.page).toHaveURL(new RegExp(`${path}(?:\\?.*)?$`));
        await expect(family.page.locator("main h1")).toBeVisible();
        if (path === "/account") {
          const save = family.page.getByRole("region", { name: "Your details", exact: true }).getByRole("button", { name: "Save", exact: true });
          await expect(save).toBeEnabled();
          await expect(save).toHaveCSS("opacity", "1");
        }
        expect(await family.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        if (width === 1440) await expect(family.page.getByRole("complementary", { name: "Workspace sidebar" }).getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
        await family.page.addScriptTag({ content: readFileSync(join(process.cwd(), "node_modules/axe-core/axe.min.js"), "utf8") });
        const violations = await family.page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (node: Document, options: object) => Promise<{ violations: { id: string }[] }> } }).axe;
          return (await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } })).violations.map(v => v.id);
        });
        expect(violations).toEqual([]);
        await family.page.screenshot({ path: info.outputPath(`${path!.slice(1)}-${width}.png`), fullPage: true, animations: "disabled" });
      }
    }
    await navigate(family.page, "Appointments");
    const childChoice = family.page.getByLabel("Child", { exact: true });
    const limitedId = await childChoice.locator("option").filter({ hasText: "Verification needed" }).first().getAttribute("value");
    expect(limitedId).toBeTruthy();
    await childChoice.selectOption(limitedId!);
    await family.page.getByRole("button", { name: "Show appointments", exact: true }).click();
    await expect(family.page.getByText("Clinic verification needed", { exact: true })).toBeVisible();
    await expect(family.page.getByRole("button", { name: "Book this time", exact: true })).toHaveCount(0);
    await childChoice.selectOption(childId!);
    await family.page.getByRole("button", { name: "Show appointments", exact: true }).click();
    await expect(family.page.getByRole("region", { name: "Current bookings", exact: true })).toBeVisible();
    await navigate(family.page, "Vaccination records");
    await family.page.locator(`a[href="/children/${childId}#his-h"]`).click();
    await expect(family.page.getByRole("region", { name: "Vaccination history", exact: true })).toBeInViewport();
    await expect(family.page.getByRole("region", { name: "Vaccination history", exact: true })).toContainText("Given at this clinic");
    await navigate(family.page, "Vaccination records");
    await family.page.locator(`a[href="/children/${childId}#sch-h"]`).click();
    await expect(family.page.getByRole("region", { name: "Next steps", exact: true })).toBeInViewport();
    await navigate(family.page, "Vaccination records");
    await family.page.locator(`a[href="/children/${childId}#cert-h"]`).click();
    await expect(family.page.getByRole("region", { name: "Certificates", exact: true })).toBeInViewport();
    await navigate(family.page, "Settings / Account");
    const language = family.page.getByRole("region", { name: "Your details", exact: true }).getByLabel("Language", { exact: true });
    const original = await language.inputValue();
    const next = original === "en" ? "fil" : "en";
    await language.selectOption(next);
    await family.page.getByRole("region", { name: "Your details", exact: true }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(family.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await family.page.reload();
    await expect(language).toHaveValue(next);
    await language.selectOption(original);
    await family.page.getByRole("region", { name: "Your details", exact: true }).getByRole("button", { name: "Save", exact: true }).click();
    await expect(family.page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await family.page.locator("#contact-h").scrollIntoViewIfNeeded();
    await expect(family.page.getByLabel("Mobile number", { exact: true })).toBeVisible();
    const contact = family.page.getByRole("region", { name: "Contact preferences", exact: true });
    await contact.getByLabel("Mobile number", { exact: true }).fill("0917 765 4321");
    await contact.getByRole("button", { name: "Save contact preferences", exact: true }).click();
    await expect(contact.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await family.page.reload();
    await expect(contact).toContainText("••••••••321");
    await contact.getByLabel("Mobile number", { exact: true }).fill("0917 123 4567");
    await contact.getByRole("button", { name: "Save contact preferences", exact: true }).click();
    await expect(contact.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await family.page.reload();
    await expect(contact).toContainText("••••••••567");
    expect(errors).toEqual([]);
  } finally { await family.context.close(); }
});

test("appointments book, refuse duplicate capacity, reschedule, retain a cancelled booking and enforce family access", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId, childId } = readVisitState();
  const staff = await signInStaff(browser, "nurse");
  const family = await signInFamily(browser);
  const other = await signInFamily(browser, "parent2", PASSWORD);
  try {
    const sessionIds: string[] = [];
    for (const offset of [24, 25]) {
      const result = await apiPost(staff.page, `/api/v1/clinics/${clinicId}/sessions`, { serviceDate: clinicDate(offset), startTime: "09:00", endTime: "10:00", totalCapacity: 4, onlineCapacity: 2, walkinCapacity: 2 });
      expect(result.status, result.text).toBe(200);
      sessionIds.push(String(result.body.data!.sessionId));
    }
    const p = family.page;
    await p.goto(`/appointments?child=${childId}`);
    await p.locator(`input[name="sessionId"][value="${sessionIds[0]}"]`).check();
    await p.getByRole("button", { name: "Book this time", exact: true }).click();
    await expect(p.getByRole("status").filter({ hasText: "Visit booked" })).toBeVisible();
    const current = p.getByRole("list", { name: "Current bookings", exact: true });
    await expect(current).toBeVisible();
    const read = async () => (await apiGet<{ appointmentId: string; sessionId: string; status: string }[]>(p, "/api/v1/appointments")).data!;
    const booked = (await read()).find(a => a.sessionId === sessionIds[0] && a.status === "confirmed")!;
    expect(booked).toBeTruthy();
    expect((await apiPost(p, "/api/v1/appointments", { childId, sessionId: sessionIds[0] })).status).toBe(409);
    expect([403, 404]).toContain((await apiPost(other.page, `/api/v1/appointments/${booked.appointmentId}/cancel`)).status);
    await other.page.goto(`/appointments?child=${childId}`);
    await expect(other.page.getByRole("heading", { name: "Page unavailable", exact: true })).toBeVisible();

    const row = current.getByRole("listitem").filter({ hasText: await familyDate(p, clinicDate(24)) });
    // The exact session is identified through its form's appointment ID after opening Change time.
    await row.getByRole("button", { name: "Change time", exact: true }).click();
    await p.locator(`#mv-${booked.appointmentId}`).selectOption(sessionIds[1]!);
    await row.getByRole("button", { name: "Move my visit", exact: true }).click();
    await expect(p.getByRole("status").filter({ hasText: "Visit moved" })).toBeVisible();
    await expect(p.locator(`#mv-${booked.appointmentId}`)).toHaveCount(0);
    const moved = (await read()).find(a => a.sessionId === sessionIds[1] && a.status === "confirmed")!;
    expect(moved).toBeTruthy();
    const movedRow = current.getByRole("listitem").filter({ hasText: await familyDate(p, clinicDate(25)) });
    await movedRow.getByRole("button", { name: "Cancel visit", exact: true }).click();
    await movedRow.getByRole("button", { name: "Keep visit", exact: true }).click();
    expect((await read()).find(a => a.appointmentId === moved.appointmentId)!.status).toBe("confirmed");
    await movedRow.getByRole("button", { name: "Cancel visit", exact: true }).click();
    await movedRow.getByRole("button", { name: "Yes, cancel visit", exact: true }).click();
    await expect(p.getByRole("status").filter({ hasText: "Visit cancelled" })).toBeVisible();
    await p.reload();
    await expect(p.getByRole("list", { name: "Recent visits", exact: true })).toContainText("Cancelled");
    expect((await read()).find(a => a.appointmentId === moved.appointmentId)!.status).toBe("cancelled");
  } finally { await family.context.close(); await other.context.close(); await staff.context.close(); }
});

test("new families have complete empty states, restricted children cannot book, and signed-out destinations require sign-in", async ({ page }, info) => {
  test.setTimeout(180_000);
  const { clinicId } = readVisitState();
  await signUpFamily(page, "Navigation Test Guardian", account(`navigation-${randomUUID()}`));
  await navigate(page, "Vaccination records");
  await expect(page.getByText("No children linked yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Register or link a child", exact: true })).toHaveAttribute("href", "/children#add-h");
  await navigate(page, "Appointments");
  await expect(page.getByText("No children linked yet", { exact: true })).toBeVisible();
  const privacy = await apiGet<{ configured: boolean; acknowledged: boolean; version: string; text: string }>(page, `/api/v1/clinics/${clinicId}/privacy-notice`);
  expect(privacy.status).toBe(200);
  if (privacy.data!.configured && !privacy.data!.acknowledged) {
    const accepted = await apiPost(page, `/api/v1/clinics/${clinicId}/privacy-notice/acknowledge`, { version: privacy.data!.version, text: privacy.data!.text });
    expect(accepted.status, accepted.text).toBe(200);
  }
  const created = await apiPost(page, "/api/v1/children", { clinicId, child: { displayName: `Navigation Child ${Date.now()}`, dobPrecision: "unknown" }, relationship: "mother" });
  expect(created.status, created.text).toBe(200);
  const childId = String(created.body.data!.childId);
  await page.goto("/vaccination-records");
  await expect(page.getByText("Clinic verification needed", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "View vaccination history", exact: true })).toHaveCount(0);
  await page.goto(`/appointments?child=${childId}`);
  await expect(page.getByText("Clinic verification needed", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Book this time", exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("restricted-appointments.png"), fullPage: true });
  await page.context().clearCookies();
  for (const path of ["/vaccination-records", "/appointments", "/account"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/sign-in(?:\?|$)/);
  }
});
