/**
 * Records and review cases (W9 corrections, family requests, guardian links, certificate revoke), each driven from its own screen and
 * read back after a reload and by the other affected role:
 * - the nurse asks to correct the recorded dose; the nurse cannot approve it; the clinical lead approves; the history shows the amended
 *   entry, the certificate goes under review, the public check says so and the family is told;
 * - the family asks for a name correction and reports a dose given elsewhere; staff apply and close the first and verify the second
 *   from Review and the child page; the family sees the outcome and is told;
 * - a second family asks to be linked to the first family's child; staff decline it with a reason; that family is told and still sees
 *   nothing;
 * - the clinical lead revokes the certificate; the public check says it is no longer valid; the family sees and is told.
 *
 * Builds on 01–06. Synthetic people only; the vaccines are the fictional fixture products.
 */
import { expect } from "@playwright/test";
import { DEMO_PRODUCTS } from "../fixtures/synthetic-schedule";
import { PASSWORD, apiGet, apiPost, clinicDate, escapeRe, journeyTest as test, readVisitState, signInFamily, signInStaff, waitForMessage, writeVisitState } from "./support";


const PRODUCT_ALPHA = DEMO_PRODUCTS[0].name;
const PRODUCT_GAMMA = DEMO_PRODUCTS[2].name;
const SITE = "E2E-SITE-CORRECTED";
const OUTSIDE = "E2E outside product (fictional)";

interface Case { caseId: string; kind: string; childId: string | null; evidence: Record<string, unknown>; status: string }

test("a dose correction: the nurse requests, cannot approve, the clinical lead approves; history, certificate and family follow", async ({ browser }) => {
  test.setTimeout(360_000);
  const { clinicId, childId, childName, verifyToken, certificateNo } = readVisitState();
  expect(verifyToken, "04 must have issued a certificate").toBeTruthy();

  const nurse = await signInStaff(browser, "nurse");
  const n = nurse.page;
  await n.goto(`/clinic/${clinicId}/children/${childId}`);
  const history = n.getByRole("region", { name: "Vaccination history" });
  const dose = history.getByRole("listitem").filter({ hasText: PRODUCT_ALPHA });
  await expect(dose).toContainText("Verified");
  await dose.getByRole("button", { name: "Request a correction" }).click();
  await expect(dose.getByLabel("What needs correcting?")).toHaveValue("correct_details");
  // The time is part of what the certificate shows (a site-only change would not need a certificate review).
  await dose.getByLabel("Correct time given").fill(`${clinicDate(-1)}T10:00`);
  await dose.getByLabel("Site", { exact: true }).fill(SITE);
  await dose.getByLabel("Reason (kept in the audit trail)").fill("E2E: time and site were recorded on the wrong line");
  await dose.getByRole("button", { name: "Send for approval" }).click();
  await expect(dose.getByRole("button", { name: "Send for approval" })).toHaveCount(0);
  // The person who asked should be told the request was sent (the form closes on success and takes its outcome with it).
  await expect.soft(n.getByRole("status").filter({ hasText: /approval|sent|requested/i }), "confirmation after 'Send for approval'").toBeVisible({ timeout: 5000 });

  const cases = (await apiGet<Case[]>(n, `/api/v1/clinics/${clinicId}/review-cases`)).data!;
  const correction = cases.find((c) => c.kind === "correction" && c.childId === childId && c.status === "open");
  expect(correction, "an open correction case for the child").toBeTruthy();
  // The nurse (no correction authority, and the requester) is refused by the API and not offered approval on Review.
  const self = await apiPost(n, `/api/v1/clinics/${clinicId}/corrections/${correction!.caseId}/approve`, {});
  expect(self.status).toBe(403);
  await n.goto(`/clinic/${clinicId}/review`);
  const nurseCard = n.getByRole("region", { name: new RegExp(`^Correction to a vaccination record, ${escapeRe(childName!)}`) });
  await expect(nurseCard).toContainText(`site: ${SITE}`);
  await expect(nurseCard.getByRole("button", { name: "Approve correction" })).toHaveCount(0);
  await expect(nurseCard).toContainText("A clinical lead with correction authority must decide this.");
  await nurse.context.close();

  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/review`);
  const card = l.getByRole("region", { name: new RegExp(`^Correction to a vaccination record, ${escapeRe(childName!)}`) });
  await expect(card).toContainText("E2E: time and site were recorded on the wrong line");
  await card.getByRole("button", { name: "Approve correction" }).click();
  await expect(card).toHaveCount(0);
  await l.reload();
  await expect(l.getByRole("region", { name: new RegExp(`^Correction to a vaccination record, ${escapeRe(childName!)}`) })).toHaveCount(0);

  // History keeps one entry, now marked amended; the certificate showing it goes under review.
  await l.goto(`/clinic/${clinicId}/children/${childId}`);
  const amended = l.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_ALPHA });
  await expect(amended).toHaveCount(1);
  await expect(amended).toContainText("amended");
  await expect(amended).toContainText("Verified");
  const cert = l.getByRole("region", { name: "Certificates" }).getByRole("listitem").filter({ hasText: certificateNo! });
  await expect(cert).toContainText("Under review");
  await expect(cert).toContainText("A record shown on this certificate was corrected");
  await lead.context.close();

  const anon = await browser.newContext();
  const v = await anon.newPage();
  await v.goto(`/verify/${verifyToken}`);
  await expect(v.getByRole("status")).toContainText("This certificate is being reviewed");
  expect((await (await v.request.get(`/api/v1/verify/${verifyToken}`)).json()).data.status).toBe("under_review");
  await anon.close();

  const family = await signInFamily(browser);
  const f = family.page;
  await f.goto(`/children/${childId}`);
  await expect(f.getByRole("region", { name: "Certificates" }).getByRole("listitem").filter({ hasText: certificateNo! })).toContainText("Being reviewed by the clinic");
  await waitForMessage(f, (m) => m.title === "Certificate under review" && m.body.includes(certificateNo!), "Certificate under review");
  await family.context.close();
});

test("the family asks for a name correction and reports an outside dose; staff resolve both; the family sees the outcome", async ({ browser }) => {
  test.setTimeout(360_000);
  const { clinicId, childId, childName } = readVisitState();
  const newName = `${childName!.split(" ")[0]} Maria ${childName!.split(" ").slice(1).join(" ")}`;

  const family = await signInFamily(browser);
  const f = family.page;
  await f.goto(`/children/${childId}`);
  const fix = f.getByRole("region", { name: "Something wrong on the record?" });
  await fix.getByRole("button", { name: "Ask the clinic to correct a detail" }).click();
  await fix.getByLabel("Correct full name").fill(newName);
  await fix.getByLabel("What is wrong, and how do you know?").fill("E2E: the middle name is on the birth certificate");
  await fix.getByRole("button", { name: "Send to the clinic" }).click();
  await expect(fix.getByRole("status").filter({ hasText: "Sent to the clinic" })).toBeVisible();

  const report = f.getByRole("region", { name: "Tell the clinic about a vaccination given elsewhere" });
  await report.getByLabel("Which vaccine?").fill(OUTSIDE);
  await report.getByLabel("Where was it given? (optional)").fill("E2E Outside Clinic");
  await report.getByLabel("Date (or a date in that month or year)").fill(clinicDate(-3));
  await report.getByRole("button", { name: "Send to the clinic" }).click();
  await expect(report.getByRole("status").filter({ hasText: "Sent to the clinic" })).toBeVisible();
  await f.reload();
  const pending = f.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: "Waiting for clinic check" });
  await expect(pending).toHaveCount(1);
  await expect(pending).toContainText("Recorded from another provider");
  // A family should recognise what they reported (the reported vaccine name is not shown back to them).
  await expect.soft(pending, "family sees the vaccine they reported").toContainText(OUTSIDE);

  const nurse = await signInStaff(browser, "nurse");
  const n = nurse.page;
  await n.goto(`/clinic/${clinicId}/review`);
  const edit = n.getByRole("region", { name: new RegExp(`^Guardian edit request, ${escapeRe(childName!)}`) });
  await expect(edit).toContainText(`displayName: ${newName}`);
  await expect(n.getByRole("region", { name: new RegExp(`^Vaccination record to review, ${escapeRe(childName!)}`) })).toContainText(OUTSIDE);

  // Apply the checked change on the record, then close the request.
  await n.goto(`/clinic/${clinicId}/children/${childId}`);
  const identity = n.getByRole("region", { name: "Correct identity details" });
  await identity.getByLabel("Full name").fill(newName);
  await identity.getByLabel("Reason for the change").fill("E2E: guardian request checked against the birth certificate");
  await identity.getByRole("button", { name: "Save corrections" }).click();
  await expect(identity.getByRole("status").filter({ hasText: "Details updated" })).toBeVisible();
  await n.reload();
  await expect(n.getByRole("heading", { level: 1 })).toHaveText(newName);

  // Verify the reported dose from the child page: map it to an approved product and confirm the date.
  const reported = n.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: OUTSIDE });
  await expect(reported).toContainText("Pending verification");
  const map = reported.getByLabel("Map to approved product");
  await map.selectOption((await map.locator("option", { hasText: PRODUCT_GAMMA }).getAttribute("value"))!);
  await expect(reported.getByLabel("Confirmed exact date")).toHaveValue(clinicDate(-3));
  await reported.getByRole("button", { name: "Confirm dose" }).click();
  await expect(n.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_GAMMA })).toContainText("Verified");
  await n.reload();
  await expect(n.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_GAMMA })).toContainText("Verified");

  await n.goto(`/clinic/${clinicId}/review`);
  const editCase = n.getByRole("region", { name: new RegExp(`^Guardian edit request, ${escapeRe(newName)}`) });
  await editCase.getByLabel("Outcome").selectOption("no_action");
  await editCase.getByLabel("Reason / note").fill("E2E: name corrected on the record");
  await editCase.getByRole("button", { name: "Close request" }).click();
  await expect(editCase).toHaveCount(0);
  await n.reload();
  await expect(n.getByRole("region", { name: /^Guardian edit request/ })).toHaveCount(0);
  await expect(n.getByRole("region", { name: /^Vaccination record to review/ })).toHaveCount(0);
  await nurse.context.close();
  writeVisitState({ childName: newName });

  // The family sees the corrected name and the checked dose, and is told about both decisions.
  await f.goto("/children");
  await expect(f.locator('[aria-label="Children"]').getByRole("heading", { level: 2, name: newName })).toBeVisible();
  await f.goto(`/children/${childId}`);
  const checked = f.getByRole("region", { name: "Vaccination history" }).getByRole("listitem").filter({ hasText: PRODUCT_GAMMA });
  await expect(checked).toContainText("Checked by clinic");
  await expect(checked).toContainText("Recorded from another provider");
  await waitForMessage(f, (m) => m.title === "Change request reviewed" && m.childId === childId, "Change request reviewed");
  await waitForMessage(f, (m) => m.title === "Reported vaccine verified" && m.childId === childId, "Reported vaccine verified");
  await f.goto("/messages");
  await expect(f.getByRole("list", { name: "Messages" }).getByRole("heading", { name: "Reported vaccine verified" })).toBeVisible();
  await family.context.close();
});

test("a second family asks to be linked to the first family's child; staff decline with a reason; that family is told and sees nothing", async ({ browser }) => {
  test.setTimeout(300_000);
  const { clinicId, childId, childName } = readVisitState();
  const p2 = await signInFamily(browser, "parent2", PASSWORD);
  const p = p2.page;
  // This family has not accepted the clinic's privacy notice yet (05 left it pending).
  const notice = p.getByRole("button", { name: "I have read this and I accept" });
  if (await notice.count()) {
    await notice.click();
    await expect(notice).toHaveCount(0);
  }
  const link = p.getByRole("region", { name: "Link an existing clinic record" });
  await link.getByLabel("Clinic", { exact: true }).selectOption({ label: "E2E Health Center" });
  await link.getByLabel("Child's name as the clinic knows it").fill(childName!);
  await link.getByLabel("Child's date of birth (if known)").fill(clinicDate(-15));
  await link.getByLabel("Your relationship to the child").selectOption("father");
  await link.getByLabel("Anything that helps staff find the record (optional)").fill("E2E link request");
  await link.getByRole("button", { name: "Send request" }).click();
  await expect(link.getByRole("status").filter({ hasText: "Request sent to the clinic" })).toBeVisible();

  const nurse = await signInStaff(browser, "nurse");
  const n = nurse.page;
  await n.goto(`/clinic/${clinicId}/review`);
  const card = n.getByRole("region", { name: /^Guardian link request/ }).filter({ hasText: "E2E link request" });
  await expect(card).toContainText("Pia Second");
  await expect(card).toContainText(childName!);
  await expect(card).toContainText("father");
  await card.getByLabel("Reason (recorded in the audit trail)").fill("E2E: could not verify this adult in person");
  await card.getByRole("button", { name: "Reject request" }).click();
  await expect(card).toHaveCount(0);
  await n.reload();
  await expect(n.getByRole("region", { name: /^Guardian link request/ }).filter({ hasText: "E2E link request" })).toHaveCount(0);
  // The child's guardians are unchanged.
  await n.goto(`/clinic/${clinicId}/children/${childId}`);
  await expect(n.getByRole("region", { name: "Guardians" })).not.toContainText("Pia Second");
  await nurse.context.close();

  await waitForMessage(p, (m) => m.title === "Link request not approved", "Link request not approved");
  await p.goto("/messages");
  await expect(p.getByRole("list", { name: "Messages" }).getByRole("listitem").filter({ has: p.getByRole("heading", { name: "Link request not approved" }) })).toContainText("Bring the child's Immunization Card");
  await p.goto("/children");
  await expect(p.getByText(childName!)).toHaveCount(0);
  expect((await p.request.get(`/api/v1/children/${childId}/history`)).status()).toBe(404);
  await p2.context.close();
});

test("the clinical lead revokes the certificate; the public check says it is no longer valid; the family sees it and is told", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId, childId, verifyToken, certificateNo, certificateId } = readVisitState();
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/children/${childId}`);
  const cert = l.getByRole("region", { name: "Certificates" }).getByRole("listitem").filter({ hasText: certificateNo! });
  await cert.getByRole("button", { name: "Revoke", exact: true }).click();
  await cert.getByLabel("Reason for revoking").fill("E2E: corrected record, replacement to follow");
  await cert.getByRole("button", { name: "Revoke certificate" }).click();
  await expect(cert).toContainText("Revoked");
  await l.reload();
  await expect(cert).toContainText("Revoked");
  await expect(cert).toContainText("Reason: E2E: corrected record, replacement to follow");
  await lead.context.close();

  const anon = await browser.newContext();
  const v = await anon.newPage();
  await v.goto(`/verify/${verifyToken}`);
  await expect(v.getByRole("status")).toContainText("This certificate is no longer valid");
  await expect(v.getByRole("status")).toContainText(certificateNo!);
  expect((await (await v.request.get(`/api/v1/verify/${verifyToken}`)).json()).data.status).toBe("revoked");
  await anon.close();

  const family = await signInFamily(browser);
  const f = family.page;
  await f.goto(`/children/${childId}`);
  const familyCert = f.getByRole("region", { name: "Certificates" }).getByRole("listitem").filter({ hasText: certificateNo! });
  await expect(familyCert).toContainText("No longer valid");
  await expect(familyCert.getByRole("button", { name: "Download PDF" })).toHaveCount(0);
  await waitForMessage(f, (m) => m.title === "Certificate no longer valid" && m.body.includes(certificateNo!), "Certificate no longer valid");
  // A revoked certificate is not downloadable by the family either (the file would look valid on paper).
  expect.soft((await f.request.get(`/api/v1/certificates/${certificateId}/download`)).status(), "revoked certificate download").not.toBe(200);
  await family.context.close();
});
