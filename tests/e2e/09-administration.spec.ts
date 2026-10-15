/**
 * Administration and reports (W12, W16, W17) on their own screens, plus access removal:
 * - Reports shows the day's activity; the CSV export downloads and its bytes hold the header and today's row; roles without reports are
 *   refused the export;
 * - Audit search finds actions done earlier in this run (certificate revoke, the export itself);
 * - clinic settings (contact, hours) persist and appear on the public start page;
 * - care information: draft → submit → a second person approves → the family reads it under Care information;
 * - follow-up: a child behind schedule is listed after a refresh, the barangay health worker logs a contact attempt;
 * - outage forms open and print;
 * - a staff member whose access is removed while still signed in is refused at the next page load and API call.
 *
 * Builds on 01–08. Synthetic people only.
 */
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { apiGet, apiPost, clinicDate, journeyTest as test, readVisitState, shownDate, signInFamily, signInStaff } from "./support";


const CONTACT = "E2E 0917 000 0001";
const HOURS = "E2E hours: Monday to Friday, 8:00 to 16:00";
const CARE_TITLE = "E2E after your visit";
const CARE_BODY = "E2E synthetic care information for automated browser tests. It is not real advice and nobody follows it.";
const FOLLOWUP_CHILD = "Rio E2E-Followup";
const DAILY_HEADER = "Date,Booked,Cancelled,No-show,Arrivals,Walk-ins,Completed,Deferred,Left,Vaccinations given,Certificates issued";

test("reports show today's activity; the CSV export holds the header and today's row; the audit search finds earlier actions", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId, certificateNo } = readVisitState();
  const today = clinicDate(0);
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/reports`);
  await expect(l.getByRole("navigation", { name: "Report type" }).getByRole("link", { name: "Daily activity" })).toHaveAttribute("aria-current", "page");
  const table = l.getByRole("region", { name: "Daily activity table" });
  await expect(table.getByRole("row").filter({ hasText: shownDate(today) })).toHaveCount(1);
  // Columns: Date, Booked, Cancelled, No-show, Arrivals, Walk-ins, Completed, Deferred, Left, Vaccinations given, Certificates issued.
  // Over the week: one vaccination (given today in 04, its time corrected to yesterday in 07) and one certificate.
  const totals = table.getByRole("row").filter({ hasText: "Total" }).getByRole("cell");
  await expect(totals.nth(9)).toHaveText("1");
  await expect(totals.nth(10)).toHaveText("1");
  // Arrivals today: the first visit (04).
  await expect(table.getByRole("row").filter({ hasText: shownDate(today) }).getByRole("cell").nth(4)).toHaveText("1");

  const [download] = await Promise.all([l.waitForEvent("download"), l.getByRole("button", { name: "Download CSV" }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^daily-activity_\\d{4}-\\d{2}-\\d{2}_${today}\\.csv$`));
  const csv = (await readFile((await download.path())!)).toString("utf8").replace(/^﻿/, "");
  const lines = csv.trim().split(/\r\n/);
  expect(lines[0]).toBe(DAILY_HEADER);
  const todayLine = lines.find((x) => x.startsWith(`${today},`));
  expect(todayLine, `a CSV row for ${today}`).toBeTruthy();
  expect(todayLine!.split(",")[4]).toBe("1");
  const body = lines.slice(1).map((x) => x.split(",").map(Number));
  expect(body.reduce((n, c) => n + c[9]!, 0)).toBe(1);
  expect(body.reduce((n, c) => n + c[10]!, 0)).toBe(1);
  expect(csv).not.toContain("Lia");

  // The audit trail: the certificate prepared in 04 and the export just made, searched with the page's own form.
  await l.goto(`/clinic/${clinicId}/audit`);
  await l.getByLabel("Action starts with").fill("certificate.");
  await l.getByRole("button", { name: "Search" }).click();
  await expect(l).toHaveURL(/action=certificate\./);
  const results = l.getByRole("region", { name: "Audit results" });
  await expect(results.getByRole("row").filter({ hasText: "certificate.prepared" }).first()).toContainText("Lito Lead");
  await expect(results.getByRole("row").filter({ hasText: "report.exported" })).toHaveCount(0);
  await l.getByLabel("Action starts with").fill("report.");
  await l.getByLabel("From", { exact: true }).fill(today);
  await l.getByLabel("To", { exact: true }).fill(today);
  await l.getByRole("button", { name: "Search" }).click();
  await expect(results.getByRole("row").filter({ hasText: "report.exported" }).first()).toContainText("Lito Lead");
  await l.getByLabel("Action starts with").fill("e2e.nothing.");
  await l.getByRole("button", { name: "Search" }).click();
  await expect(l.getByText("Nothing matches")).toBeVisible();
  expect(certificateNo).toBeTruthy();
  await lead.context.close();

  // The nurse records vaccinations but does not run reports: no export button, the export and the audit are refused.
  const nurse = await signInStaff(browser, "nurse");
  const n = nurse.page;
  await n.goto(`/clinic/${clinicId}/reports`);
  await expect(n.getByRole("button", { name: "Download CSV" })).toHaveCount(0);
  expect((await n.request.get(`/api/v1/clinics/${clinicId}/reports/daily-activity/export?from=${today}&to=${today}`)).status()).toBe(403);
  await n.goto(`/clinic/${clinicId}/audit`);
  await expect(n.getByText("This page is unavailable to your account")).toBeVisible();
  await nurse.context.close();
});

test("clinic settings: contact and hours persist and appear on the public start page; other roles are refused", async ({ browser }) => {
  test.setTimeout(180_000);
  const { clinicId } = readVisitState();
  const admin = await signInStaff(browser, "admin");
  const a = admin.page;
  await a.goto(`/clinic/${clinicId}/settings`);
  const details = a.getByRole("region", { name: "Clinic details" });
  await details.getByLabel("Phone or other contact").fill(CONTACT);
  await details.getByLabel("Opening hours").fill(HOURS);
  await details.getByRole("button", { name: "Save" }).click();
  await expect(details.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await a.reload();
  await expect(details.getByLabel("Phone or other contact")).toHaveValue(CONTACT);
  await expect(details.getByLabel("Opening hours")).toHaveValue(HOURS);
  await expect(details.getByLabel("Time zone")).toHaveValue("Asia/Manila");
  await admin.context.close();

  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto("/");
  const listed = p.getByRole("listitem").filter({ has: p.getByRole("heading", { name: "E2E Health Center" }) });
  await expect(listed).toContainText(HOURS);
  await expect(listed).toContainText(CONTACT);
  await anon.close();

  const nurse = await signInStaff(browser, "nurse");
  await nurse.page.goto(`/clinic/${clinicId}/settings`);
  await expect(nurse.page.getByText("This page is unavailable to your account")).toBeVisible();
  expect((await apiPost(nurse.page, `/api/v1/clinics/${clinicId}/profile`, { name: "E2E Health Center", contact: "E2E nurse edit", timezone: "Asia/Manila" })).status).toBe(403);
  await nurse.context.close();
});

test("care information: written and submitted by one person, approved by another, then shown to the family", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId } = readVisitState();
  const admin = await signInStaff(browser, "admin");
  const a = admin.page;
  await a.goto(`/clinic/${clinicId}/content`);
  await a.getByRole("button", { name: "Write new care information" }).click();
  await a.getByLabel("Short code").fill("e2e-after-visit");
  await a.getByLabel("Language").selectOption("en");
  await a.getByLabel("Title").fill(CARE_TITLE);
  await a.getByLabel("Text families will read").fill(CARE_BODY);
  await a.getByLabel("Where it comes from").fill("E2E synthetic source (test only)");
  await a.getByRole("button", { name: "Save draft" }).click();
  const item = a.getByRole("listitem").filter({ hasText: CARE_TITLE });
  await expect(item).toContainText("Draft");
  await a.reload();
  await expect(item).toContainText("Draft");
  await item.getByRole("button", { name: "Submit for review" }).click();
  await expect(item).toContainText("Waiting for review");
  await expect(item).toContainText("Someone else has to review this.");
  await expect(item.getByRole("button", { name: "Approve and publish" })).toHaveCount(0);
  await admin.context.close();

  // Not shown to families before approval.
  const family = await signInFamily(browser);
  const f = family.page;
  await f.goto("/help");
  await expect(f.getByRole("heading", { name: CARE_TITLE })).toHaveCount(0);

  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/content`);
  const review = l.getByRole("listitem").filter({ hasText: CARE_TITLE });
  await review.getByRole("button", { name: "Approve and publish" }).click();
  await review.getByLabel("Note (optional)").fill("E2E reviewed against the synthetic source");
  await review.getByRole("button", { name: "Confirm" }).click();
  await expect(review).toContainText("Shown to families");
  await l.reload();
  await expect(review).toContainText("Shown to families");
  await expect(review).toContainText("reviewed by Lito Lead");
  await lead.context.close();

  await f.reload();
  const article = f.getByRole("article").filter({ has: f.getByRole("heading", { name: CARE_TITLE }) });
  await expect(article).toContainText(CARE_BODY);
  await expect(article).toContainText("E2E Health Center");
  await expect(article).toContainText("Source: E2E synthetic source (test only)");
  // Families cannot write care information.
  expect([403, 404]).toContain((await apiPost(f, `/api/v1/clinics/${clinicId}/content`, { code: "e2e-family", language: "en", title: "E2E family text", body: CARE_BODY, source: "E2E" })).status);
  await family.context.close();
});

test("follow-up: a child behind schedule is listed after a refresh and the barangay health worker logs a contact attempt", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId } = readVisitState();
  // A walk-in registered by the nurse at the desk, 40 days old with no doses (behind on the fictional schedule).
  const nurse = await signInStaff(browser, "nurse");
  const n = nurse.page;
  await n.goto(`/clinic/${clinicId}`);
  await n.getByText("Open the registration form").click();
  await n.getByLabel("Given name(s)").fill("Rio");
  await n.getByLabel("Family name").fill("E2E-Followup");
  await n.getByLabel("Date of birth", { exact: true }).fill(clinicDate(-40));
  await n.getByLabel("Full name", { exact: true }).fill("Gina Guardian");
  await n.getByLabel("Relationship").selectOption("mother");
  await n.getByLabel("Phone (optional)").fill("0917 555 0100");
  await n.getByLabel(/I checked this adult/).check();
  await n.getByLabel(/I confirmed the child/).check();
  await n.getByRole("button", { name: "Check for existing records and register" }).click();
  await expect(n.getByRole("status").filter({ hasText: "Registered — record" })).toBeVisible();
  await nurse.context.close();

  const bhw = await signInStaff(browser, "bhw");
  const b = bhw.page;
  await b.goto(`/clinic/${clinicId}/followup?filter=all`);
  await b.getByRole("button", { name: /Update the list|Check again now/ }).click();
  await expect(b.getByRole("status").filter({ hasText: /Checked \d+ children/ })).toBeVisible();
  await b.reload();
  const entry = b.getByRole("listitem").filter({ hasText: FOLLOWUP_CHILD }).first();
  await expect(entry).toContainText(/\d+ behind/);
  await expect(entry).toContainText("Guardian: Gina Guardian");
  // BHWs can now open the intake record while vaccination history stays behind clinical permissions.
  await expect(entry.getByRole("link", { name: FOLLOWUP_CHILD })).toHaveCount(1);
  await b.goto(`/clinic/${clinicId}/followup?filter=behind`);
  const behind = b.getByRole("listitem").filter({ hasText: FOLLOWUP_CHILD }).first();
  await behind.getByRole("button", { name: "Record a contact attempt" }).click();
  const form = b.getByRole("form", { name: `Contact attempt for ${FOLLOWUP_CHILD}` });
  await form.getByLabel("What happened?").selectOption("no_answer");
  await form.getByLabel("Note (optional)").fill("E2E rang twice");
  await form.getByRole("button", { name: "Save attempt" }).click();
  await expect(behind).toContainText("Last contact: No answer");
  await b.reload();
  await expect(b.getByRole("listitem").filter({ hasText: FOLLOWUP_CHILD }).first()).toContainText(/Last contact: No answer, .* — E2E rang twice \(1 attempt\)/);
  // A date in the past for the next try is refused with the reason.
  await b.getByRole("listitem").filter({ hasText: FOLLOWUP_CHILD }).first().getByRole("button", { name: "Record a contact attempt" }).click();
  await form.getByLabel("What happened?").selectOption("no_answer");
  await form.getByLabel("Try again on (optional)").fill(clinicDate(-1));
  await form.getByRole("button", { name: "Save attempt" }).click();
  await expect(form.getByRole("alert")).toContainText(/within the next 6 months/);
  await bhw.context.close();
});

test("outage forms open for the nurse and print", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const { context, page } = await signInStaff(browser, "nurse");
  await page.goto(`/clinic/${clinicId}`);
  await page.getByRole("navigation", { name: "Clinic Navigation" }).getByRole("link", { name: "Outage forms" }).click();
  await expect(page).toHaveURL(new RegExp(`/clinic/${clinicId}/outage-forms$`));
  await expect(page.getByRole("heading", { name: "E2E Health Center — vaccination paper log" })).toBeVisible();
  await page.evaluate(() => {
    const w = window as unknown as { __printed: number; print: () => void };
    w.__printed = 0;
    w.print = () => { w.__printed += 1; };
  });
  await page.getByRole("button", { name: "Print forms" }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await context.close();
});

test("removing a staff member's access while they are signed in refuses their next page load and API call", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId } = readVisitState();
  const asst = await signInStaff(browser, "assistant");
  const s = asst.page;
  await s.goto(`/clinic/${clinicId}/today`);
  await expect(s.getByRole("heading", { name: "Clinic today" })).toBeVisible();
  expect((await apiGet(s, `/api/v1/clinics/${clinicId}/appointments`)).status).toBe(200);

  const admin = await signInStaff(browser, "admin");
  const a = admin.page;
  await a.goto(`/clinic/${clinicId}/access`);
  const row = a.getByRole("list", { name: "Staff access" }).getByRole("listitem").filter({ hasText: "Ari Assistant" });
  await row.getByRole("button", { name: "Remove access" }).click();
  await row.getByLabel("Reason (recorded in the audit trail)").fill("E2E: left the health center");
  await row.locator("form").getByRole("button", { name: "Remove access" }).click();
  // The row leaves the list on refresh; the confirmation stays at the top of the page.
  await expect(a.getByRole("status").filter({ hasText: "Access removed for Ari Assistant" })).toBeVisible();
  await a.reload();
  await expect(a.getByRole("list", { name: "Staff access" }).getByRole("listitem").filter({ hasText: "Ari Assistant" }).filter({ hasText: "Active" })).toHaveCount(0);
  await admin.context.close();

  // Same browser, same cookies, no sign-out: the clinic is closed to them now.
  await s.goto(`/clinic/${clinicId}/today`);
  await expect(s).not.toHaveURL(/\/today/);
  await expect(s.getByRole("heading", { name: "Clinic today" })).toHaveCount(0);
  expect((await apiGet(s, `/api/v1/clinics/${clinicId}/appointments`)).status).toBe(403);
  expect((await apiPost(s, `/api/v1/clinics/${clinicId}/sessions`, { serviceDate: clinicDate(6), startTime: "09:00", endTime: "10:00", totalCapacity: 2, onlineCapacity: 1, walkinCapacity: 1 })).status).toBe(403);
  await asst.context.close();
});
