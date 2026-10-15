/**
 * Connected workflow regression on the isolated E2E stack: one browser context per role, with results read back after reload
 * or from another role. Earlier journeys supply the clinic, approved rules and accounts. This adds a fresh child, booking,
 * signed dose, certificate and contact attempt; it never runs against the normal local account database.
 */
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { DEMO_PRODUCTS } from "../fixtures/synthetic-schedule";
import { account, apiGet, apiPost, clinicDate, env, journeyTest as test, pdfText, readVisitState, shownDate, signInFamily, signInStaff, waitForMessage } from "./support";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  expect(new URL(env.dbUrl).port).toBe("55322");
  expect(new URL(env.baseUrl).port).toBe("3100");
  const { clinicId, childId } = readVisitState();
  expect(clinicId && childId, "run the preceding isolated browser journeys first").toBeTruthy();
  // Earlier revocation tests intentionally invalidate the old certificate. Issue a new document through the real command;
  // do not overwrite or reactivate the revoked evidence merely to prepare this workflow.
  const lead = await signInStaff(browser, "lead");
  try {
    // The access-removal journey revoked the assistant. Re-grant through two different authenticated people;
    // keep the original revoked membership and its denial/audit evidence intact.
    const staff = await apiGet<{ role: string; displayName: string; status: string }[]>(lead.page, `/api/v1/clinics/${clinicId}/staff`);
    expect(staff.status).toBe(200);
    if (!staff.data?.some((row) => row.role === "assistant" && row.displayName === "Ari Assistant" && row.status === "active")) {
      const requested = await apiPost(lead.page, `/api/v1/clinics/${clinicId}/staff`, { email: account("assistant"), role: "assistant", capabilities: [] });
      expect(requested.status, requested.text).toBe(200);
      const administrator = await signInStaff(browser, "admin");
      try {
        const pending = await apiGet<{ membershipId: string; version: number }[]>(administrator.page, `/api/v1/clinics/${clinicId}/staff`);
        const membership = pending.data?.find((row) => row.membershipId === requested.body.data?.membershipId);
        expect(membership).toBeTruthy();
        const approved = await apiPost(administrator.page, `/api/v1/clinics/${clinicId}/staff/${membership!.membershipId}/approve`, { expectedVersion: membership!.version });
        expect(approved.status, approved.text).toBe(200);
      } finally { await administrator.context.close(); }
    }
    const issued = await apiPost(lead.page, `/api/v1/clinics/${clinicId}/children/${childId}/certificates`);
    expect(issued.status, issued.text).toBe(200);
    expect(issued.body.data?.status, issued.text).toBe("issued");
  } finally { await lead.context.close(); }
});

const CLINIC = "E2E Health Center";
const PARENT = "Maria Santos";
const LOT = "E2E-LOT-0001";
const PRODUCT_ALPHA = DEMO_PRODUCTS[0].name;
const FOLLOWUP_CHILD = "Rio E2E-Followup";
// A new family name each run, so repeated rehearsals never match an earlier child.
const FAMILY = `Rehearsal-${new Date().toISOString().replace(/\D/g, "").slice(8, 14)}`;
const GIVEN = "Mika";
let childId = "";
let childName = "";
let ticket = "";

test("1. the public page lists the health center; the family sees the prepared child's dose and certificate", async ({ browser }) => {
  const { clinicId, childId: preparedChild } = readVisitState();
  expect(clinicId && preparedChild, "run the preceding isolated browser journeys first").toBeTruthy();
  const anon = await browser.newContext();
  const p = await anon.newPage();
  await p.goto("/");
  await expect(p.getByRole("listitem").filter({ has: p.getByRole("heading", { name: CLINIC }) })).toBeVisible();
  await anon.close();

  const { context, page } = await signInFamily(browser);
  await page.goto(`/children/${preparedChild}`);
  await expect(page.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_ALPHA })).toContainText("Checked by clinic");
  await expect(page.getByRole("region", { name: "Certificates" }).getByRole("listitem").first()).toContainText("Valid");
  await context.close();
});

test("2. the family registers a fresh child; it waits for clinic verification", async ({ browser }) => {
  const { context, page } = await signInFamily(browser);
  const add = page.getByRole("region", { name: "Register a new child record" });
  await add.getByLabel("Clinic").selectOption({ label: CLINIC });
  const accept = add.getByRole("button", { name: "I have read this and I accept" });
  await expect(add.getByText("Checking the clinic's privacy notice")).toHaveCount(0);
  if (await accept.isVisible()) await accept.click();
  await add.getByLabel("Child's given name(s)").fill(GIVEN);
  await add.getByLabel("Child's family name").fill(FAMILY);
  await add.getByLabel("How well do you know the birth date?").selectOption("exact");
  await add.getByLabel("Date of birth").fill(clinicDate(-15));
  await add.getByLabel("Your relationship to the child").selectOption("mother");
  await add.getByRole("button", { name: "Add child" }).click();
  await expect(add.getByRole("status").filter({ hasText: "Saved — waiting for clinic verification" })).toBeVisible();

  await page.reload();
  const card = page.locator('[aria-label="Children"]').locator("div.card-elevated").filter({ hasText: FAMILY });
  await expect(card).toContainText("Clinic verification needed to see vaccination history");
  childName = (await card.getByRole("heading", { level: 2 }).textContent())!.trim();
  childId = /\/children\/([0-9a-f-]{36})/.exec((await card.getByRole("link", { name: /View details/ }).getAttribute("href")) ?? "")?.[1] ?? "";
  expect(childId).toBeTruthy();
  await context.close();
});

test("3. the assistant confirms identity and verifies the guardian; today's session is open", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const { context, page } = await signInStaff(browser, "assistant");
  await page.goto(`/clinic/${clinicId}`);
  await page.getByLabel("Name or record number").fill(FAMILY);
  await page.getByRole("search").getByRole("button", { name: "Search" }).click();
  const hit = page.getByRole("list", { name: "Matching children" }).getByRole("link").filter({ hasText: childName });
  await expect(hit).toContainText("Awaiting verification");
  await hit.click();
  await page.getByRole("button", { name: "Confirm child identity" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Identity confirmed" })).toBeVisible();
  const guardian = page.getByRole("region", { name: "Guardians" }).getByRole("listitem").filter({ hasText: PARENT });
  await guardian.getByLabel("Verified by").selectOption("in_person_id");
  await guardian.getByRole("button", { name: "Verify this guardian" }).click();
  await expect(guardian).toContainText("Verified Guardian");

  await page.goto(`/clinic/${clinicId}/today`);
  await expect(page.getByRole("region", { name: "Sessions" }), "the earlier isolated setup created today's session").toContainText(shownDate(clinicDate(0)));
  await context.close();
});

test("4. the family books today; the assistant checks in, calls and starts service; the display and the family follow", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const family = await signInFamily(browser);
  const f = family.page;
  await f.goto(`/children/${childId}`);
  await expect(f.getByRole("region", { name: "Next steps" }).getByText("Due now").first()).toBeVisible();
  const visits = f.getByRole("region", { name: "Clinic visits" });
  await visits.getByRole("radio").first().check();
  await visits.getByRole("button", { name: "Book this time" }).click();
  await expect(visits.getByText(/Visit booked for/)).toBeVisible();

  const { context, page } = await signInStaff(browser, "assistant");
  await page.goto(`/clinic/${clinicId}/today`);
  await page.getByRole("button", { name: `Check in ${childName}` }).click();
  const issued = page.getByRole("status").filter({ hasText: `issued for ${childName}` });
  await expect(issued).toBeVisible();
  ticket = /Ticket (\S+) issued/.exec((await issued.textContent()) ?? "")?.[1] ?? "";
  expect(ticket).toBeTruthy();
  const row = page.getByRole("list", { name: "Active queue" }).getByRole("listitem").filter({ hasText: childName });
  await row.getByRole("button", { name: "Call", exact: true }).click();
  await row.getByRole("button", { name: "Start service" }).click();
  await expect(row).toContainText("In service");
  await context.close();

  const anon = await browser.newContext();
  const display = await anon.newPage();
  await display.goto(`/display/${clinicId}`);
  await expect(display.getByRole("heading", { name: "Now calling" })).toBeVisible();
  await expect(display.getByText(ticket, { exact: true })).toBeVisible();
  await expect(display.getByText(childName)).toHaveCount(0);
  await anon.close();

  await f.reload();
  await expect(f.getByText("Your child is being seen.")).toBeVisible();
  await family.context.close();
});

test("5. the nurse records the dose from the alpha lot and finishes the visit; stock drops by exactly one", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const { context, page } = await signInStaff(browser, "nurse");
  const usable = async () => Number(((await apiGet<{ lots: { lot: string; usable: string }[] }>(page, `/api/v1/clinics/${clinicId}/stock`)).data?.lots ?? []).find((x) => x.lot === LOT)?.usable);
  await page.goto(`/clinic/${clinicId}/inventory`);
  const before = await usable();
  expect(before, "the earlier isolated stock journeys leave usable stock for this workflow").toBeGreaterThan(0);

  await page.goto(`/clinic/${clinicId}/today`);
  await page.getByRole("list", { name: "Active queue" }).getByRole("listitem").filter({ hasText: childName }).getByRole("link", { name: childName }).click();
  const give = page.getByRole("region", { name: "Give a vaccine" });
  const option = give.getByLabel("Vaccine and lot").locator("option", { hasText: LOT });
  await give.getByLabel("Vaccine and lot").selectOption((await option.getAttribute("value"))!);
  await give.getByRole("button", { name: "Review before signing" }).click();
  await expect(give.getByText(`Check this is the right child: ${childName}`)).toBeVisible();
  await give.getByRole("button", { name: "Sign and record" }).click();
  await expect(give.getByRole("status").filter({ hasText: "Vaccination recorded and signed" })).toBeVisible();

  await page.goto(`/clinic/${clinicId}/today`);
  const inService = page.getByRole("list", { name: "Active queue" }).getByRole("listitem").filter({ hasText: childName });
  await inService.getByLabel("Visit outcome").selectOption("vaccinated");
  await inService.getByRole("button", { name: "Finish visit" }).click();
  await expect(page.getByRole("list", { name: "Active queue" }).getByRole("listitem").filter({ hasText: childName })).toHaveCount(0);

  await page.goto(`/clinic/${clinicId}/children/${childId}`);
  await expect(page.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_ALPHA })).toContainText("Verified");
  await page.goto(`/clinic/${clinicId}/inventory`);
  expect(await usable()).toBe(before - 1);
  await context.close();
});

test("6. the clinical lead prepares a certificate; the PDF downloads, the public check says valid, the family is told", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const { context, page } = await signInStaff(browser, "lead");
  await page.goto(`/clinic/${clinicId}/children/${childId}`);
  const certs = page.getByRole("region", { name: "Certificates" });
  await certs.getByRole("button", { name: "Prepare certificate" }).click();
  const item = certs.getByRole("listitem").first();
  await expect(item).toContainText("Valid");
  const [response, download] = await Promise.all([
    page.waitForResponse((r) => /\/api\/v1\/certificates\/[0-9a-f-]{36}\/download/.test(r.url())),
    page.waitForEvent("download"),
    item.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const certificateNo = (await item.locator(".tnum").first().textContent())!.trim();
  await context.close();

  // Signed out, the address printed on the certificate says valid and shows no child details.
  const token = /\/verify\/([0-9a-f]{64})/.exec((await pdfText(pdf)).replaceAll("\n", ""))?.[1];
  expect(token, "verify address printed on the certificate").toBeTruthy();
  const anon = await browser.newContext();
  const v = await anon.newPage();
  await v.goto(`/verify/${token}`);
  await expect(v.getByRole("status")).toContainText("This certificate is valid");
  await expect(v.getByText(childName)).toHaveCount(0);
  await anon.close();

  const family = await signInFamily(browser);
  await waitForMessage(family.page, (m) => m.title === "Vaccination recorded" && m.childId === childId, "Vaccination recorded");
  await waitForMessage(family.page, (m) => m.title === "Certificate ready" && m.body.includes(certificateNo), "Certificate ready");
  await family.page.goto("/messages");
  await expect(family.page.getByRole("list", { name: "Messages" }).getByRole("heading", { name: "Certificate ready" }).first()).toBeVisible();
  await family.page.goto(`/children/${childId}`);
  await expect(family.page.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_ALPHA })).toContainText("Given at this clinic");
  await expect(family.page.getByRole("region", { name: "Certificates" }).getByRole("listitem").filter({ hasText: certificateNo })).toContainText("Valid");
  await family.context.close();
});

test("7. the lead's reports and audit trail; the administrator's screens, without clinical records", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/reports`);
  const [csv] = await Promise.all([l.waitForEvent("download"), l.getByRole("button", { name: "Download CSV" }).click()]);
  expect((await readFile((await csv.path())!)).toString("utf8")).toContain("Vaccinations given");
  await l.goto(`/clinic/${clinicId}/audit`);
  await l.getByLabel("Action starts with").fill("certificate.");
  await l.getByRole("button", { name: "Search" }).click();
  await expect(l.getByRole("main")).toContainText("certificate.");
  await lead.context.close();

  const admin = await signInStaff(browser, "admin");
  const a = admin.page;
  for (const [path, heading] of [["settings", "Clinic settings and operations"], ["access", "Staff access"], ["clinical", "Clinical setup"], ["content", "Care information"], ["admin", "Admin console"]] as const) {
    await a.goto(`/clinic/${clinicId}/${path}`);
    await expect(a.getByRole("heading", { level: 1 })).toContainText(heading);
  }
  await expect(a.getByRole("navigation", { name: "Clinic Navigation" }).getByRole("link", { name: "Today" })).toHaveCount(0);
  expect([403, 404]).toContain((await apiGet(a, `/api/v1/children/${childId}/history`)).status);
  await admin.context.close();
});

test("8. the health worker logs a follow-up contact attempt; the nurse opens the outage forms", async ({ browser }) => {
  const { clinicId } = readVisitState();
  const bhw = await signInStaff(browser, "bhw");
  const b = bhw.page;
  await b.goto(`/clinic/${clinicId}/followup?filter=all`);
  await b.getByRole("button", { name: /Update the list|Check again now/ }).click();
  await expect(b.getByRole("status").filter({ hasText: /Checked \d+ child/ })).toBeVisible();
  await b.goto(`/clinic/${clinicId}/followup?filter=behind`);
  const entry = b.getByRole("listitem").filter({ hasText: FOLLOWUP_CHILD }).first();
  await entry.getByRole("button", { name: "Record a contact attempt" }).click();
  const form = b.getByRole("form", { name: `Contact attempt for ${FOLLOWUP_CHILD}` });
  await form.getByLabel("What happened?").selectOption("no_answer");
  await form.getByLabel("Note (optional)").fill("Rehearsal call");
  await form.getByRole("button", { name: "Save attempt" }).click();
  await expect(b.getByRole("status").filter({ hasText: `Contact attempt recorded for ${FOLLOWUP_CHILD}` })).toBeVisible();
  await b.reload();
  await expect(b.getByRole("listitem").filter({ hasText: FOLLOWUP_CHILD }).first()).toContainText("Rehearsal call");
  await bhw.context.close();

  const nurse = await signInStaff(browser, "nurse");
  await nurse.page.goto(`/clinic/${clinicId}/outage-forms`);
  await expect(nurse.page.getByRole("heading", { name: `${CLINIC} — vaccination paper log` })).toBeVisible();
  await nurse.context.close();
});
