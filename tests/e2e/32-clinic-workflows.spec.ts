import { expect } from "@playwright/test";
import { journeyTest as test, readVisitState, signInStaff } from "./support";

test("clinic task groups retain daily work and authorized record tools after reload", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const nurse = await signInStaff(browser, "nurse");
  const bhw = await signInStaff(browser, "bhw");
  try {
    await nurse.page.setViewportSize({ width: 1440, height: 1000 });
    await nurse.page.goto(`/clinic/${clinicId}/today`);
    const nav = nurse.page.getByRole("navigation", { name: "Clinic Navigation", exact: true });
    await expect(nav.getByRole("group", { name: "Clinic day", exact: true }).getByRole("link", { name: "Today", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("group", { name: "Records and review", exact: true })).toBeVisible();
    await expect(nav.getByRole("group", { name: "Management", exact: true }).getByRole("link", { name: "Vaccine stock", exact: true })).toBeVisible();
    await nav.getByRole("link", { name: "Find or register", exact: true }).click();
    await expect(nurse.page).toHaveURL(new RegExp(`/clinic/${clinicId}$`));
    await nurse.page.reload();
    await expect(nav.getByRole("link", { name: "Find or register", exact: true })).toHaveAttribute("aria-current", "page");
    await bhw.page.setViewportSize({ width: 1440, height: 1000 });
    await bhw.page.goto(`/clinic/${clinicId}/followup`);
    const bhwNav = bhw.page.getByRole("navigation", { name: "Clinic Navigation", exact: true });
    await expect(bhwNav.getByRole("link", { name: "Follow-up list", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(bhwNav.getByRole("link", { name: "Vaccine stock", exact: true })).toHaveCount(0);
    await expect(bhwNav.getByRole("link", { name: "Staff access", exact: true })).toHaveCount(0);
  } finally {
    await nurse.context.close();
    await bhw.context.close();
  }
});
