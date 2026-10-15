/**
 * First use on an empty system: two people create accounts, the operator runs the one-time bootstrap
 * (npm run setup:first-staff, database owner only), and each of them must set up two-step sign-in (TOTP) before
 * any clinic record opens.
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { account, asDatabaseOwner, enrolTotp, env, readState, signIn, signUpFamily, writeState } from "./support";

function setupFirstStaff() {
  const r = spawnSync(process.execPath, [join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"), "scripts/setup-first-staff.ts",
    "--hosted", "--org", "E2E Municipal Health Office", "--clinic", "E2E Health Center", "--timezone", "Asia/Manila",
    "--admin", account("admin"), "--lead", account("lead")], { encoding: "utf8", env: { ...process.env, CVSRS_OWNER_DB_URL: env.dbUrl } });
  return { ok: r.status === 0, out: `${r.stdout}${r.stderr}` };
}

async function staffFirstSignIn(page: Page, who: string, clinicId: string) {
  await signIn(page, account(who), undefined, true);
  // Clinic records stay closed until the second step is set up.
  await expect(page).toHaveURL(/\/account\/security/);
  const secret = await enrolTotp(page);
  await expect(page).toHaveURL(new RegExp(`/clinic/${clinicId}`));
  writeState({ totp: { [who]: secret } });
}

test("immediately confirmed accounts bootstrap the first clinic and two mutually approved staff", async ({ page, browser }) => {
  await signUpFamily(page, "Ana Admin", account("admin"));

  const leadContext = await browser.newContext();
  const leadPage = await leadContext.newPage();
  await signUpFamily(leadPage, "Lito Lead", account("lead"));
  expect(await asDatabaseOwner(async (db) => Number((await db.query("select count(*) from public.clinics")).rows[0].count))).toBe(0);
  await leadContext.close();

  const done = setupFirstStaff();
  expect(done.out).toContain("technical administrator");
  expect(done.ok).toBe(true);
  const clinicId = await asDatabaseOwner(async (db) => (await db.query("select id from public.clinics")).rows[0].id as string);
  writeState({ clinicId });

  const again = setupFirstStaff();
  expect(again.ok).toBe(false);
  expect(again.out).toMatch(/Refused: staff access already exists/);
});

test("each first staff member must enrol two-step sign-in before the clinic workspace opens", async ({ browser }) => {
  const { clinicId } = readState();
  for (const who of ["admin", "lead"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await staffFirstSignIn(page, who, clinicId!);
    await expect(page.getByText("E2E Health Center").first()).toBeVisible();
    await context.close();
  }
});

test("a session without the second step cannot read clinic data through the API either", async ({ page }) => {
  const { clinicId } = readState();
  // Password only (aal1): the page redirects to the second step, and the API refuses the same data.
  await signIn(page, account("lead"), undefined, true);
  await expect(page).toHaveURL(/\/account\/security/);
  const res = await page.request.get(`/api/v1/clinics/${clinicId}/children?q=a`);
  expect([401, 403]).toContain(res.status());
});
