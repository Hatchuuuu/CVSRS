/**
 * The first completed visit, end to end, with real sign-in (TOTP for staff) and results read back after a reload or by another role:
 * the clinic prepares (privacy notice, vaccines, an approved schedule, stock, a session), a family registers a child, staff verify the
 * child and the guardian, the family books, the nurse checks the child in, records a dose from the received lot and finishes the visit,
 * the clinical lead issues a certificate that downloads as a PDF and passes the public check. Families stay out of the clinic and out of
 * each other's records.
 *
 * Clinical content is the FICTIONAL test fixture (tests/fixtures/synthetic-schedule.ts: DEMO-ALPHA etc.), never a real schedule. Every
 * person and child is synthetic and lives only in the isolated end-to-end database.
 */
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_ANTIGENS, DEMO_PRODUCTS, demoSchedule } from "../fixtures/synthetic-schedule";
import {
  NEW_PASSWORD, account, apiPost, asDatabaseOwner, clinicDate, pdfText, readVisitState, signIn, signInStaff,
  signUpFamily, writeVisitState,
} from "./support";

test.describe.configure({ mode: "serial" });

const NURSE = "Nora Nurse";
const PARENT = "Maria Santos";
const NOTICE_VERSION = "E2E-1";
const NOTICE = "E2E test privacy notice. Synthetic wording for automated browser tests only; it is not a real privacy notice and no real person reads it.";
const SCHEDULE_LABEL = "e2e-demo-1";
const LOT = "E2E-LOT-0001";
const PRODUCT_ALPHA = DEMO_PRODUCTS[0].name; // "Demo product alpha (fictional)"
const GIVEN = "Lia";
const FAMILY = "Synthetic";

/** The DOWNLOAD route answers JSON only on failure, so the body tells why if it is not a PDF. */
const short = (s: string) => s.slice(0, 300);

async function stock(page: Page, clinicId: string) {
  const res = await page.request.get(`/api/v1/clinics/${clinicId}/stock`);
  expect(res.status()).toBe(200);
  return (await res.json()).data as { lots: { lotId: string; lot: string; physicalOnHand: string; usable: string }[] };
}

test("the clinic prepares: privacy notice, vaccines, an approved schedule, and a second role for stock", async ({ browser }) => {
  test.setTimeout(360_000);
  const { clinicId } = readVisitState();
  expect(clinicId, "02-first-staff must run first").toBeTruthy();

  // TEST-FIXTURE DATABASE ONLY (the isolated end-to-end stack): the fictional demo schedule is accepted only while demo mode is on.
  // verify.sql requires demo mode off in every real deployment. This is the documented fixture switch, not an app-table write.
  await asDatabaseOwner((db) => db.query("update private.settings set value = 'true'::jsonb where key = 'demo_mode'"));

  // --- technical administrator: privacy notice and draft master data -------------------------------------------------------
  const admin = await signInStaff(browser, "admin");
  const a = admin.page;
  await a.goto(`/clinic/${clinicId}/clinical`);
  const notice = a.getByRole("region", { name: "Privacy notice for families" });
  await expect(notice.getByText("No privacy notice is set.")).toBeVisible();
  await notice.getByLabel("Version").fill(NOTICE_VERSION);
  await notice.getByLabel("Notice text").fill(NOTICE);
  await notice.getByRole("button", { name: "Publish notice" }).click();
  await expect(notice.getByText(`Version ${NOTICE_VERSION} is in force.`)).toBeVisible();

  // One antigen through the form, the rest of the fixture through the same API the forms use (bulk setup).
  const antigens = a.getByRole("region", { name: "Antigens" });
  const [first, ...rest] = DEMO_ANTIGENS;
  await antigens.getByLabel("Code", { exact: true }).fill(first[0]);
  await antigens.getByLabel("Name", { exact: true }).fill(first[1]);
  await antigens.getByRole("button", { name: "Add antigen" }).click();
  await expect(antigens.getByRole("status")).toContainText("Antigen added as a draft");
  for (const [code, name] of rest) {
    const r = await apiPost(a, `/api/v1/clinics/${clinicId}/clinical-master/antigens`, { code, name });
    expect(r.status, short(r.text)).toBe(200);
  }
  for (const p of DEMO_PRODUCTS) {
    const r = await apiPost(a, `/api/v1/clinics/${clinicId}/clinical-master/products`, { ...p, antigenCodes: [...p.antigenCodes] });
    expect(r.status, short(r.text)).toBe(200);
  }
  await a.reload();
  for (const [code] of DEMO_ANTIGENS) await expect(antigens.getByRole("listitem").filter({ hasText: code })).toContainText("draft");
  // The person who staged them is not offered activation (two-person rule).
  await expect(a.getByRole("button", { name: /^Activate / })).toHaveCount(0);

  // --- clinical lead: activates the master data; requests the inventory role for the nurse -----------------------------------
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/clinical`);
  for (const code of [...DEMO_ANTIGENS.map(([c]) => c), ...DEMO_PRODUCTS.map((p) => p.code)]) {
    const button = l.getByRole("button", { name: `Activate ${code}`, exact: true });
    await button.click();
    await expect(button).toHaveCount(0);
  }
  await l.reload();
  for (const [code] of DEMO_ANTIGENS) await expect(l.getByRole("region", { name: "Antigens" }).getByRole("listitem").filter({ hasText: code })).toContainText("active");
  for (const p of DEMO_PRODUCTS) await expect(l.getByRole("region", { name: "Vaccine products" }).getByRole("listitem").filter({ hasText: p.code })).toContainText("active");

  // Only the inventory role may receive stock; nobody has it yet. The lead requests it, the access administrator approves.
  await l.goto(`/clinic/${clinicId}/access`);
  const request = l.getByRole("region", { name: "Request access for a person" });
  await request.getByLabel("Their account email").fill(account("nurse"));
  await request.getByLabel("Role", { exact: true }).selectOption("inventory");
  await request.getByRole("button", { name: "Request access" }).click();
  await expect(request.getByRole("status")).toContainText("waiting for a second person to approve");

  await a.goto(`/clinic/${clinicId}/access`);
  await a.getByRole("button", { name: `Approve access for ${NURSE}` }).click();
  await expect(a.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
  await a.reload();
  await expect(a.getByRole("button", { name: `Approve access for ${NURSE}` })).toHaveCount(0);
  await admin.context.close();

  // --- nurse (rules.propose): imports the fictional schedule and submits it ---------------------------------------------------
  const nurse = await signInStaff(browser, "nurse");
  const n = nurse.page;
  await n.goto(`/clinic/${clinicId}/clinical`);
  await n.getByLabel("Schedule (JSON)").fill(JSON.stringify(demoSchedule(SCHEDULE_LABEL)));
  await n.getByRole("button", { name: "Import draft" }).click();
  await n.waitForURL(/\/clinical\/schedules\/[0-9a-f-]{36}$/);
  const scheduleUrl = new URL(n.url()).pathname;
  await expect(n.getByRole("heading", { level: 1 })).toContainText(SCHEDULE_LABEL);
  await expect(n.getByText("Test cases are not all passing")).toHaveCount(0);
  await n.getByRole("button", { name: "Submit for clinical review" }).click();
  await expect(n.getByRole("status").filter({ hasText: "Submitted for review" })).toBeVisible();
  await nurse.context.close();

  // --- clinical lead (a different person): approves and activates from today -------------------------------------------------
  await l.goto(scheduleUrl);
  await l.getByRole("button", { name: "Approve this schedule" }).click();
  await expect(l.getByRole("status").filter({ hasText: "Approved" })).toBeVisible();
  await l.getByLabel("Takes effect on (today or later)").fill(clinicDate(0));
  await l.getByRole("button", { name: "Activate schedule" }).click();
  await expect(l.getByRole("status").filter({ hasText: "Activated" })).toBeVisible();
  await l.goto(`/clinic/${clinicId}/clinical`);
  await expect(l.getByRole("region", { name: "Vaccination schedules" }).getByRole("listitem").filter({ hasText: SCHEDULE_LABEL })).toContainText("active");
  await lead.context.close();
});

test("the nurse, now also inventory clerk, receives a lot into a fridge and opens a session for today", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId } = readVisitState();
  const { context, page } = await signInStaff(browser, "nurse");
  await page.goto(`/clinic/${clinicId}/inventory`);

  const locations = page.getByRole("region", { name: "Stock locations" });
  await locations.getByLabel("Location name").fill("E2E fridge");
  await locations.getByLabel("Kind").selectOption("usable");
  await locations.getByRole("button", { name: "Add location" }).click();
  await expect(locations.getByText("E2E fridge · usable")).toBeVisible();

  const register = page.getByRole("region", { name: "Register a lot" });
  await register.getByLabel("Product").selectOption({ label: `${PRODUCT_ALPHA} (DEMO-P-ALPHA)` });
  await register.getByLabel("Lot number (as printed)").fill(LOT);
  await register.getByLabel("Expiry date (as printed)").fill(clinicDate(365));
  await register.getByRole("button", { name: "Register lot" }).click();
  await expect(register.getByRole("status")).toContainText("Lot registered");

  const receive = page.getByRole("region", { name: "Receive stock" });
  const lotSelect = receive.getByLabel("Lot", { exact: true });
  await expect(lotSelect.locator("option", { hasText: LOT })).toHaveCount(1);
  await lotSelect.selectOption((await lotSelect.locator("option", { hasText: LOT }).getAttribute("value"))!);
  await receive.getByLabel("Put into").selectOption({ label: "E2E fridge" });
  await receive.getByLabel("Quantity received").fill("10");
  await receive.getByLabel("Delivery reference").fill("E2E-DELIVERY-0001");
  await receive.getByRole("button", { name: "Receive stock" }).click();
  await expect(receive.getByRole("status")).toContainText("Stock received");

  // Persisted: after a reload the lot shows 10 on hand and 10 usable, and the stock API agrees.
  await page.reload();
  const lotRow = page.getByRole("region", { name: "Lots" }).getByRole("listitem").filter({ hasText: `lot ${LOT}` });
  await expect(lotRow).toContainText(/On hand:\s*10\s*vial/);
  await expect(lotRow).toContainText(/Usable:\s*10\s*vial/);
  const lot = (await stock(page, clinicId!)).lots.find((x) => x.lot === LOT);
  expect(Number(lot?.usable)).toBe(10);
  writeVisitState({ lotId: lot!.lotId });

  // A session for today (clinic time) that families can book.
  await page.goto(`/clinic/${clinicId}/today`);
  const sessions = page.getByRole("region", { name: "Sessions" });
  await sessions.getByText("Create a session", { exact: true }).click();
  await sessions.getByLabel("Date", { exact: true }).fill(clinicDate(0));
  await sessions.getByLabel("Starts").fill("00:01");
  await sessions.getByLabel("Ends").fill("23:59");
  await sessions.getByRole("button", { name: "Create session" }).click();
  await expect(sessions.getByRole("status")).toContainText("Session created");
  await page.reload();
  await expect(page.getByRole("region", { name: "Sessions" })).toContainText("0 of 12 bookable places taken");
  await context.close();
});

test("a family accepts the clinic's privacy notice, then registers a child; the clinic stays closed to them", async ({ page }) => {
  const { clinicId } = readVisitState();
  await signIn(page, account("parent"), NEW_PASSWORD);
  await expect(page).toHaveURL(/\/children/);

  const add = page.getByRole("region", { name: "Register a new child record" });
  const fill = async () => {
    await add.getByLabel("Clinic").selectOption({ label: "E2E Health Center" });
    await add.getByLabel("Child's given name(s)").fill(GIVEN);
    await add.getByLabel("Child's family name").fill(FAMILY);
    await add.getByLabel("How well do you know the birth date?").selectOption("exact");
    await add.getByLabel("Date of birth").fill(clinicDate(-15));
    await add.getByLabel("Your relationship to the child").selectOption("mother");
  };
  // The form blocks submission until the chosen clinic's notice is read; the database also enforces the gate.
  await fill();
  await expect(add.getByRole("button", { name: "Add child" })).toBeDisabled();
  const denied = await apiPost(page, "/api/v1/children", { clinicId, relationship: "mother", child: { givenNames: GIVEN, familyName: FAMILY, dobPrecision: "exact", dob: clinicDate(-15) } });
  expect(denied.status).toBe(409);

  const notice = add.getByRole("region", { name: "Privacy notice text from E2E Health Center" });
  await expect(notice).toContainText("E2E test privacy notice");
  await add.getByRole("button", { name: "I have read this and I accept" }).click();
  await expect(page.getByRole("heading", { name: "Privacy notice from E2E Health Center" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Privacy notice from E2E Health Center" })).toHaveCount(0);

  await fill();
  await add.getByRole("button", { name: "Add child" }).click();
  await expect(add.getByRole("status").filter({ hasText: "Saved — waiting for clinic verification" })).toBeVisible();

  // Persisted: after a reload the child is listed, waiting for the clinic.
  await page.reload();
  const card = page.locator('[aria-label="Children"]').locator("div.card-elevated").filter({ hasText: FAMILY });
  await expect(card).toHaveCount(1);
  const childName = (await card.getByRole("heading", { level: 2 }).textContent())!.trim();
  expect(childName).toContain(GIVEN);
  await expect(card).toContainText("Clinic verification needed to see vaccination history");
  const href = await card.getByRole("link", { name: /View details/ }).getAttribute("href");
  const childId = /\/children\/([0-9a-f-]{36})/.exec(href ?? "")?.[1];
  expect(childId).toBeTruthy();
  writeVisitState({ childId, childName });

  // Until staff verify the guardian, the history is not served.
  expect((await page.request.get(`/api/v1/children/${childId}/history`)).status()).toBe(404);

  // A family account is not staff: the clinic workspace and its API are closed.
  await page.goto(`/clinic/${clinicId}/today`);
  await expect(page).not.toHaveURL(/\/today/);
  await expect(page.getByRole("heading", { name: "Arrival queue" })).toHaveCount(0);
  expect([403, 404]).toContain((await page.request.get(`/api/v1/clinics/${clinicId}/queue`)).status());
  expect([403, 404]).toContain((await page.request.get(`/api/v1/clinics/${clinicId}/children?q=${FAMILY}`)).status());
});

test("the nurse finds the child, confirms identity and verifies the guardian; the family then sees the schedule and books", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const { clinicId, childId, childName } = readVisitState();
  const { context, page: n } = await signInStaff(browser, "nurse");
  await n.goto(`/clinic/${clinicId}`);
  await n.getByLabel("Name or record number").fill(FAMILY);
  await n.getByRole("search").getByRole("button", { name: "Search" }).click();
  const hit = n.getByRole("list", { name: "Matching children" }).getByRole("link").filter({ hasText: childName! });
  await expect(hit).toContainText("Awaiting verification");
  await hit.click();
  await expect(n).toHaveURL(new RegExp(`/children/${childId}`));

  // Both outcomes stay announced after the refresh that removes their buttons (the notices used to unmount with their forms).
  await n.getByRole("button", { name: "Confirm child identity" }).click();
  await expect(n.getByRole("status").filter({ hasText: "Identity confirmed" })).toBeVisible();
  await expect(n.getByRole("region", { name: "Child identity" })).toContainText("Verified Record");
  const guardians = n.getByRole("region", { name: "Guardians" });
  const guardian = guardians.getByRole("listitem").filter({ hasText: PARENT });
  await guardian.getByLabel("Verified by").selectOption("in_person_id");
  await guardian.getByRole("button", { name: "Verify this guardian" }).click();
  await expect(guardian.getByRole("status").filter({ hasText: "Guardian verified" })).toBeVisible();
  await expect(guardian).toContainText("Verified Guardian");

  // Persisted for staff: after a reload both checks are done.
  await n.reload();
  await expect(n.getByRole("button", { name: "Confirm child identity" })).toHaveCount(0);
  await expect(guardians.getByRole("listitem").filter({ hasText: PARENT })).toContainText("Verified Guardian");
  await expect(n.getByRole("region", { name: "Child identity" })).toContainText("Verified Record");
  await context.close();

  // The family now has full access: schedule (from the approved fictional version) and booking.
  await signIn(page, account("parent"), NEW_PASSWORD);
  await expect(page).toHaveURL(/\/children/);
  await page.getByRole("link", { name: /Vaccination schedule and history/ }).click();
  await expect(page).toHaveURL(new RegExp(`/children/${childId}$`));
  const steps = page.getByRole("region", { name: "Next steps" });
  await expect(steps).toContainText(`schedule version ${SCHEDULE_LABEL}`);
  await expect(steps.getByText("Due now").first()).toBeVisible();

  const visits = page.getByRole("region", { name: "Clinic visits" });
  await visits.getByRole("radio").first().check();
  await visits.getByRole("button", { name: "Book this time" }).click();
  await expect(visits.getByText(/Visit booked for/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Clinic visits" }).getByRole("listitem").filter({ hasText: "Booked" })).toHaveCount(1);
});

test("the nurse checks the child in, records the dose from the received lot and finishes the visit; stock and history follow", async ({ browser, page }) => {
  test.setTimeout(240_000);
  const { clinicId, childId, childName } = readVisitState();
  const { context, page: n } = await signInStaff(browser, "nurse");
  await n.goto(`/clinic/${clinicId}/today`);
  await n.getByRole("button", { name: `Check in ${childName}` }).click();
  await expect(n.getByRole("status").filter({ hasText: `issued for ${childName}` })).toBeVisible();

  const row = n.getByRole("list", { name: "Active queue" }).getByRole("listitem").filter({ hasText: childName! });
  await row.getByRole("button", { name: "Call", exact: true }).click();
  await row.getByRole("button", { name: "Start service" }).click();
  await expect(row).toContainText("In service");

  // The family sees the live status after a reload.
  await signIn(page, account("parent"), NEW_PASSWORD);
  await expect(page).toHaveURL(/\/children/);
  await page.goto(`/children/${childId}`);
  await expect(page.getByText("Your child is being seen.")).toBeVisible();

  await row.getByRole("link", { name: childName }).click();
  await expect(n).toHaveURL(new RegExp(`/children/${childId}$`));
  const give = n.getByRole("region", { name: "Give a vaccine" });
  await expect(give.getByLabel("Vaccine and lot").locator("option", { hasText: LOT })).toHaveCount(1);
  await give.getByLabel("Vaccine and lot").selectOption((await give.getByLabel("Vaccine and lot").locator("option", { hasText: LOT }).getAttribute("value"))!);
  await give.getByRole("button", { name: "Review before signing" }).click();
  await expect(give.getByText(`Check this is the right child: ${childName}`)).toBeVisible();
  await give.getByRole("button", { name: "Sign and record" }).click();
  const recorded = give.getByRole("status").filter({ hasText: "Vaccination recorded and signed" });
  await expect(recorded).toBeVisible();
  await expect(recorded).toContainText("Counted toward: A1");

  await n.goto(`/clinic/${clinicId}/today`);
  const inService = n.getByRole("list", { name: "Active queue" }).getByRole("listitem").filter({ hasText: childName! });
  await inService.getByLabel("Visit outcome").selectOption("vaccinated");
  await inService.getByRole("button", { name: "Finish visit" }).click();
  await expect(n.getByText("The queue is empty")).toBeVisible();
  await n.reload();
  await expect(n.getByText("The queue is empty")).toBeVisible();
  await expect(n.getByText("Finished or left today (1)")).toBeVisible();

  // Persisted for staff: the history lists the verified dose; the lot is down by exactly one.
  await n.goto(`/clinic/${clinicId}/children/${childId}`);
  await expect(n.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_ALPHA })).toContainText("Verified");
  await n.goto(`/clinic/${clinicId}/inventory`);
  const lotRow = n.getByRole("region", { name: "Lots" }).getByRole("listitem").filter({ hasText: `lot ${LOT}` });
  await expect(lotRow).toContainText(/On hand:\s*9\s*vial/);
  expect(Number((await stock(n, clinicId!)).lots.find((x) => x.lot === LOT)?.usable)).toBe(9);
  await context.close();

  // Persisted for the family: the dose is in the history, the visit is done, the first requirement is completed.
  await page.reload();
  const history = page.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_ALPHA });
  await expect(history).toContainText("Given at this clinic");
  await expect(history).toContainText("Checked by clinic");
  await expect(page.getByRole("region", { name: "Clinic visits" })).toContainText("Visit done");
  await expect(page.getByRole("region", { name: "Next steps" }).getByText("Completed").first()).toBeVisible();
});

test("the clinical lead issues a certificate; it downloads as a PDF and the public check confirms it without signing in", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const { clinicId, childId, childName } = readVisitState();
  const { context, page: l } = await signInStaff(browser, "lead");
  await l.goto(`/clinic/${clinicId}/children/${childId}`);
  const certs = l.getByRole("region", { name: "Certificates" });
  await certs.getByRole("button", { name: "Prepare certificate" }).click();
  const item = certs.getByRole("listitem").first();
  await expect(item).toContainText("Valid");
  await expect(item).toContainText("1 vaccination");
  const certificateNo = (await item.locator(".tnum").first().textContent())!.trim();

  const [response, download] = await Promise.all([
    l.waitForResponse((r) => /\/api\/v1\/certificates\/[0-9a-f-]{36}\/download/.test(r.url())),
    l.waitForEvent("download"),
    item.getByRole("button", { name: "Download PDF" }).click(),
  ]);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("application/pdf");
  expect(download.suggestedFilename()).toBe(`${certificateNo}.pdf`);
  // The bytes the person actually saved (the page fetches the file and saves it from a blob).
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  const certificateId = /certificates\/([0-9a-f-]{36})\/download/.exec(response.url())![1]!;

  // What is printed: the certificate number, the child, the dose, and the public check address (the QR code carries the same).
  const text = await pdfText(pdf);
  const lines = text.replaceAll("\n", " "); // wrapped lines are separate text runs
  expect(lines).toContain(certificateNo);
  expect(lines).toContain(childName!);
  expect(lines).toContain(PRODUCT_ALPHA);
  const token = /\/verify\/([0-9a-f]{64})/.exec(text.replaceAll("\n", ""))?.[1];
  expect(token, "verify address printed on the certificate").toBeTruthy();
  writeVisitState({ certificateId, certificateNo, verifyToken: token });
  await context.close();

  // Anyone, signed out: the check says valid and shows no child details; an unknown code is "not found".
  const anon = await browser.newContext();
  const v = await anon.newPage();
  await v.goto(`/verify/${token}`);
  const status = v.getByRole("status");
  await expect(status).toContainText("This certificate is valid");
  await expect(status).toContainText(certificateNo);
  await expect(status).toContainText("E2E Health Center");
  await expect(v.getByText(childName!)).toHaveCount(0);
  const api = await v.request.get(`/api/v1/verify/${token}`);
  expect(api.status()).toBe(200);
  expect((await api.json()).data.status).toBe("valid");

  const bogus = "0".repeat(64);
  await v.goto(`/verify/${bogus}`);
  await expect(v.getByRole("status")).toContainText("Certificate not found");
  expect((await v.request.get(`/api/v1/verify/${bogus}`)).status()).toBe(404);
  await v.goto("/verify/not-a-token");
  await expect(v.getByRole("status")).toContainText("Certificate not found");
  await anon.close();

  // The family sees the same certificate as valid and can download it.
  await signIn(page, account("parent"), NEW_PASSWORD);
  await expect(page).toHaveURL(/\/children/);
  await page.goto(`/children/${childId}`);
  const familyCert = page.getByRole("region", { name: "Certificates" }).getByRole("listitem").filter({ hasText: certificateNo });
  await expect(familyCert).toContainText("Valid");
  const familyPdf = await page.request.get(`/api/v1/certificates/${certificateId}/download`);
  expect(familyPdf.status()).toBe(200);
  expect(familyPdf.headers()["content-type"]).toBe("application/pdf");
});

test("a second family cannot see the first family's child, its history or its certificate", async ({ page }) => {
  const { childId, childName, certificateId } = readVisitState();
  const email = account("parent2");
  await signUpFamily(page, "Pia Second", email);
  await expect(page.getByText(childName!)).toHaveCount(0);

  const res = await page.goto(`/children/${childId}`);
  await expect(page.getByText("This page is unavailable to your account")).toBeVisible();
  expect((await res?.text()) ?? "").not.toContain(childName!);
  expect((await page.request.get(`/api/v1/children/${childId}/history`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/children/${childId}/schedule`)).status()).toBe(404);
  expect((await page.request.get(`/api/v1/certificates/${certificateId}/download`)).status()).toBe(404);
});
