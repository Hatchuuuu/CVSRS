import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { asDatabaseOwner, enrolTotp, journeyTest as test, signIn, signUpFamily } from "./support";

test("one account keeps each clinic and portal through shared pages, reload and browser Back", async ({ browser }) => {
  test.setTimeout(300_000);
  const suffix = randomUUID();
  const email = `multi-portal-${suffix}@e2e.example.test`;
  const clinics = {
    mixed: { id: randomUUID(), name: `Mixed roles ${suffix}` },
    bhw: { id: randomUUID(), name: `BHW clinic ${suffix}` },
    technical: { id: randomUUID(), name: `Technical clinic ${suffix}` },
    foreign: { id: randomUUID(), name: `Unassigned clinic ${suffix}` },
  };
  const registration = await browser.newContext();
  try {
    await signUpFamily(await registration.newPage(), "Multi Portal Parent", email);
  } finally {
    await registration.close();
  }

  // Synthetic memberships are fixture setup only. All navigation and permission checks below use the real password/MFA session.
  await asDatabaseOwner(async db => {
    await db.query("begin");
    try {
      const user = (await db.query("select id from public.profiles where id=(select id from auth.users where email=$1)", [email])).rows[0];
      const approver = (await db.query("select profile_id, organization_id from public.staff_memberships where role_code='clinical_lead' and status='active' limit 1")).rows[0];
      const admin = (await db.query("select profile_id from public.staff_memberships where organization_id=$1 and role_code='tech_admin' and status='active' and profile_id<>$2 limit 1", [approver?.organization_id, approver?.profile_id])).rows[0];
      expect(user).toBeTruthy();
      expect(approver).toBeTruthy();
      expect(admin).toBeTruthy();
      for (const clinic of Object.values(clinics)) {
        await db.query("insert into public.clinics(id,organization_id,name) values($1,$2,$3)", [clinic.id, approver.organization_id, clinic.name]);
      }
      for (const [clinic, role] of [[clinics.mixed, "clinical_staff"], [clinics.mixed, "tech_admin"], [clinics.bhw, "bhw"], [clinics.technical, "tech_admin"]] as const) {
        const clinical = role === "clinical_staff";
        await db.query("insert into public.staff_memberships(organization_id,profile_id,clinic_id,role_code,status,requested_by,approved_by) values($1,$2,$3,$4,'active',$5,$6)", [approver.organization_id, user.id, clinic.id, role, clinical ? admin.profile_id : approver.profile_id, clinical ? approver.profile_id : admin.profile_id]);
      }
      await db.query("commit");
    } catch (error) {
      await db.query("rollback");
      throw error;
    }
  });

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const sidebar = page.getByRole("complementary", { name: "Workspace sidebar" });
  const main = page.getByRole("main");
  async function workspace(portal: string, clinic?: { name: string }) {
    await expect(sidebar.locator("p").filter({ hasText: new RegExp(`^${portal}$`) })).toBeVisible();
    if (clinic) await expect(sidebar.getByText(clinic.name, { exact: true })).toBeVisible();
  }
  async function sharedHistory(portal: "parents" | "clinic" | "developer", title: string, clinic?: { id: string; name: string }) {
    const origin = new URL(page.url()).pathname;
    const query = `portal=${portal}${clinic ? `&clinic=${clinic.id}` : ""}`;
    await sidebar.getByRole("link", { name: "Settings / Account", exact: true }).click();
    await expect(page).toHaveURL(`/account?${query}`);
    await page.reload();
    await workspace(title, clinic);
    await expect(sidebar.getByRole("link", { name: "Settings / Account", exact: true })).toHaveAttribute("aria-current", "page");
    await sidebar.getByRole("link", { name: /^Messages/ }).click();
    await expect(page).toHaveURL(`/messages?${query}`);
    await page.reload();
    await workspace(title, clinic);
    await page.goBack();
    await expect(page).toHaveURL(`/account?${query}`);
    await workspace(title, clinic);
    await page.goBack();
    await expect(page).toHaveURL(origin);
    await workspace(title, clinic);
  }

  try {
    await signIn(page, email, undefined, true);
    await expect(page).toHaveURL(/\/clinic$/);
    await main.locator(`a[href='/clinic/${clinics.mixed.id}/today']`).click();
    await expect(page).toHaveURL(/\/account\/security/);
    await enrolTotp(page);
    await expect(page).toHaveURL(`/clinic/${clinics.mixed.id}/today`);
    await sharedHistory("clinic", "Clinics Portal", clinics.mixed);

    await sidebar.getByRole("link", { name: "Parents Portal", exact: true }).click();
    await expect(page).toHaveURL("/children");
    await sharedHistory("parents", "Parents Portal");
    await sidebar.getByRole("link", { name: "Clinics Portal", exact: true }).click();
    await expect(page).toHaveURL("/clinic");
    await main.locator(`a[href='/clinic/${clinics.bhw.id}/followup']`).click();
    await expect(page).toHaveURL(`/clinic/${clinics.bhw.id}/followup`);
    await sharedHistory("clinic", "Clinics Portal", clinics.bhw);

    await sidebar.getByRole("link", { name: "Developer Console", exact: true }).click();
    await expect(page).toHaveURL("/developer");
    await expect(main.getByRole("link", { name: clinics.bhw.name, exact: true })).toHaveCount(0);
    await expect(main.getByRole("link", { name: clinics.foreign.name, exact: true })).toHaveCount(0);
    await main.getByRole("link", { name: clinics.technical.name, exact: true }).click();
    await expect(page).toHaveURL(`/developer/${clinics.technical.id}/staff`);
    await sharedHistory("developer", "Developer Console", clinics.technical);
    await sidebar.getByRole("link", { name: "Switch clinic", exact: true }).click();
    await main.getByRole("link", { name: clinics.mixed.name, exact: true }).click();
    await expect(page).toHaveURL(`/developer/${clinics.mixed.id}/staff`);
    await sharedHistory("developer", "Developer Console", clinics.mixed);
    await sidebar.getByRole("link", { name: /^Messages/ }).click();
    await expect(page).toHaveURL(`/messages?portal=developer&clinic=${clinics.mixed.id}`);
    await sidebar.getByRole("link", { name: "Parents Portal", exact: true }).click();
    await expect(page).toHaveURL("/children");
    await workspace("Parents Portal");
    await page.goBack();
    await expect(page).toHaveURL(`/messages?portal=developer&clinic=${clinics.mixed.id}`);
    await workspace("Developer Console", clinics.mixed);

    // The same membership union supports both workspaces; query context cannot upgrade a BHW-only clinic.
    await page.goto(`/developer/${clinics.bhw.id}/staff?portal=developer&clinic=${clinics.mixed.id}`);
    await expect(page.getByRole("heading", { name: "Page unavailable", exact: true })).toBeVisible();
    expect([403, 404]).toContain((await page.request.get(`/api/v1/clinics/${clinics.bhw.id}/staff?portal=developer&clinic=${clinics.mixed.id}`)).status());
    await page.goto(`/clinic/${clinics.foreign.id}/today?portal=clinic&clinic=${clinics.mixed.id}`);
    await expect(page).toHaveURL("/clinic");
    await page.goto(`/developer/${clinics.foreign.id}/staff?portal=developer&clinic=${clinics.mixed.id}`);
    await expect(page).toHaveURL("/clinic");
    expect([403, 404]).toContain((await page.request.get(`/api/v1/clinics/${clinics.foreign.id}/staff`)).status());

    // Invalid, foreign and duplicated contexts fall back to live membership data, never the requested technical clinic.
    for (const query of [`portal=developer&clinic=${clinics.bhw.id}`, `portal=developer&clinic=${clinics.foreign.id}`, "portal=unknown&clinic=invalid", `portal=developer&portal=clinic&clinic=${clinics.technical.id}`]) {
      await page.goto(`/account?${query}`);
      await workspace("Clinics Portal");
      await expect(sidebar.getByRole("link", { name: "Staff accounts", exact: true })).toHaveCount(0);
    }
    for (const path of ["/children", "/vaccination-records", "/appointments", "/help"]) {
      await page.goto(`${path}?portal=developer&clinic=${clinics.mixed.id}`);
      await workspace("Parents Portal");
      await expect(sidebar.getByRole("link", { name: "Settings / Account", exact: true })).toHaveAttribute("href", "/account?portal=parents");
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
