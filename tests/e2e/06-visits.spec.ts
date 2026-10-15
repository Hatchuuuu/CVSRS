/**
 * Visits and sessions from the staff side (W7/W8), with real sign-in (TOTP for staff):
 * - two more staff roles join through the real staff application flow (registration assistant, barangay health worker): the clinical
 *   lead accepts, the access administrator (a second person) approves, each enrols two-step sign-in;
 * - the assistant books a visit for the family's child from the clinic child page (a double click books once), moves it, cancels it;
 *   the family sees each change after a reload and is told in Messages once the outbox worker has run;
 * - session tools on Today: who is booked, change places (an impossible split and a cut below the bookings are refused), cancel a
 *   session; the family is told and the booking shows cancelled;
 * - roles without appointment duties, and families, are refused.
 *
 * Builds on 01–04 (clinic, accounts, the verified child). Every person is synthetic.
 */
import { expect, type Page } from "@playwright/test";
import {
  account, apiGet, apiPost, applyAsStaff, clinicDate, enrolTotp, escapeRe, familyDate, formAlert, messageDate, readVisitState, shownDate,
  signIn, signInFamily, signInStaff, waitForMessage, writeState,
  journeyTest as test,
} from "./support";


const ASSISTANT = "Ari Assistant";
const BHW = "Bea Health Worker";
const STAFF: [who: string, name: string, role: string][] = [["assistant", ASSISTANT, "assistant"], ["bhw", BHW, "bhw"]];

interface SessionRow { sessionId: string; serviceDate: string; status: string; version: number; booked: number; onlineCapacity: number; walkinCapacity: number; totalCapacity: number }
interface ChildAppt { appointmentId: string; status: string; sessionId: string; serviceDate: string; channel: string; reason: string | null }

async function sessionsOf(page: Page, clinicId: string): Promise<SessionRow[]> {
  const r = await apiGet<SessionRow[]>(page, `/api/v1/clinics/${clinicId}/sessions?from=${clinicDate(0)}&to=${clinicDate(14)}`);
  expect(r.status, r.text.slice(0, 300)).toBe(200);
  return r.data!;
}

/** Creates a session on Today with the page's own form and checks it is listed after the refresh. */
async function createSession(page: Page, date: string, start: string, end: string, places?: { total: number; online: number; walkin: number }) {
  const sessions = page.getByRole("region", { name: "Sessions" });
  const create = sessions.locator("details").filter({ has: page.locator("summary", { hasText: /^Create a session$/ }) });
  if (!(await create.evaluate((d) => (d as HTMLDetailsElement).open))) await create.locator("summary").click();
  await create.getByLabel("Date", { exact: true }).fill(date);
  await create.getByLabel("Starts").fill(start);
  await create.getByLabel("Ends").fill(end);
  if (places) {
    await create.getByLabel("Total places").fill(String(places.total));
    await create.getByLabel("Places families can book").fill(String(places.online));
    await create.getByLabel("Places kept for walk-ins").fill(String(places.walkin));
  }
  await create.getByRole("button", { name: "Create session" }).click();
  await expect(sessionRow(page, date)).toHaveCount(1);
}

/** A booking row in the upcoming list of the staff Visits section (earlier and cancelled ones sit in a details list below). */
const upcoming = (visits: ReturnType<Page["getByRole"]>, date: string) =>
  visits.locator("div.space-y-5 > ul > li").filter({ has: visits.page().locator("span.tnum.block", { hasText: shownDate(date) }) });

/** The Today row of the (single) open session on `date`. */
const sessionRow = (page: Page, date: string) =>
  page.getByRole("region", { name: "Sessions" }).locator("ul > li").filter({ hasText: "bookable places taken" }).filter({ hasText: shownDate(date) });

async function optionValue(select: ReturnType<Page["getByLabel"]>, text: string) {
  const option = select.locator("option", { hasText: text });
  await expect(option).toHaveCount(1);
  return (await option.getAttribute("value"))!;
}

test("an assistant and a barangay health worker apply; the clinical lead accepts, the administrator approves, each enrols two-step sign-in", async ({ browser }) => {
  test.setTimeout(420_000);
  const { clinicId } = readVisitState();
  expect(clinicId, "01–05 must run first").toBeTruthy();

  for (const [who, name, role] of STAFF) {
    const ctx = await browser.newContext();
    await applyAsStaff(await ctx.newPage(), name, who, role);
    await ctx.close();
  }

  // The clinical lead reviews applications too; accepting files the access request in the lead's name.
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/admin`);
  for (const [, name, role] of STAFF) {
    await l.getByRole("button", { name: `Accept application from ${name}` }).click();
    const form = l.getByRole("form", { name: `Accept application from ${name}` });
    await expect(form.getByLabel("Role to request")).toHaveValue(role);
    await expect(form).toContainText("Another access administrator approves it.");
    await form.getByRole("button", { name: "Accept and send for approval" }).click();
    await expect(l.getByRole("button", { name: `Accept application from ${name}` })).toHaveCount(0);
    const waiting = l.getByRole("list", { name: "Access waiting for approval" }).getByRole("listitem").filter({ hasText: name });
    await expect(waiting).toContainText("You requested this, so someone else must approve it.");
    await expect(waiting.getByRole("button", { name: `Approve access for ${name}` })).toHaveCount(0);
  }
  // The person who requested cannot approve through the API either (and a non-clinical role needs an access administrator).
  const rows = (await apiGet<{ membershipId: string; displayName: string; status: string; version: number }[]>(l, `/api/v1/clinics/${clinicId}/staff`)).data!;
  const asstRow = rows.find((r) => r.displayName === ASSISTANT && r.status === "pending_approval");
  expect(asstRow, "assistant membership is pending").toBeTruthy();
  const forced = await apiPost(l, `/api/v1/clinics/${clinicId}/staff/${asstRow!.membershipId}/approve`, { expectedVersion: asstRow!.version });
  expect([403, 409]).toContain(forced.status);
  await lead.context.close();

  const admin = await signInStaff(browser, "admin");
  const a = admin.page;
  await a.goto(`/clinic/${clinicId}/access`);
  for (const [, name] of STAFF) {
    await a.getByRole("button", { name: `Approve access for ${name}` }).click();
    // A previous approval's persistent notice is not evidence that this request finished before the next navigation.
    const approved = a.getByRole("list", { name: "Staff access" }).getByRole("listitem").filter({ hasText: name });
    await expect(approved).toContainText(/Active/i);
    await expect(approved.getByRole("button", { name: `Approve access for ${name}` })).toHaveCount(0);
  }
  await a.reload();
  for (const [, name] of STAFF) {
    await expect(a.getByRole("button", { name: `Approve access for ${name}` })).toHaveCount(0);
    await expect(a.getByRole("list", { name: "Staff access" }).getByRole("listitem").filter({ hasText: name })).toContainText(/Active/i);
  }
  await admin.context.close();

  for (const [who] of STAFF) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signIn(page, account(who), undefined, true);
    await expect(page).toHaveURL(/\/account\/security/);
    const secret = await enrolTotp(page);
    writeState({ totp: { [who]: secret } });
    await expect(page).toHaveURL(new RegExp(`/clinic/${clinicId}`));
    const nav = page.getByRole("navigation", { name: "Clinic Navigation" });
    if (who === "assistant") {
      await expect(nav.getByRole("link", { name: "Today" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Vaccine stock" })).toHaveCount(0);
    } else {
      await expect(nav.getByRole("link", { name: "Follow-up list" })).toBeVisible();
      await expect(nav.getByRole("link", { name: "Today" })).toHaveCount(0);
    }
    await ctx.close();
  }
});

test("the assistant books (a double click books once), moves and cancels a visit; the family sees each change and is told in Messages", async ({ browser }) => {
  test.setTimeout(420_000);
  const { clinicId, childId, childName } = readVisitState();
  const d2 = clinicDate(2);
  const d3 = clinicDate(3);
  const asst = await signInStaff(browser, "assistant");
  const a = asst.page;
  await a.goto(`/clinic/${clinicId}/today`);
  await createSession(a, d2, "09:00", "11:00", { total: 10, online: 6, walkin: 4 });
  await createSession(a, d3, "13:00", "15:00", { total: 20, online: 12, walkin: 8 });
  await a.reload();
  await expect(sessionRow(a, d2)).toContainText("0 of 6 bookable places taken · 4 held for walk-ins · 10 in all");
  const all = await sessionsOf(a, clinicId!);
  const s2 = all.find((s) => s.serviceDate === d2 && s.status === "open")!;
  const s3 = all.find((s) => s.serviceDate === d3 && s.status === "open")!;
  expect(s2 && s3, "both sessions listed by the API").toBeTruthy();

  const family = await signInFamily(browser);
  const f = family.page;
  const fd2 = await familyDate(f, d2);
  const fd3 = await familyDate(f, d3);

  // --- book (double click) -------------------------------------------------------------------------------------------------------
  await a.goto(`/clinic/${clinicId}/children/${childId}`);
  const visits = a.getByRole("region", { name: "Visits" });
  const sessionSelect = visits.getByLabel("Session", { exact: true });
  await sessionSelect.selectOption(await optionValue(sessionSelect, shownDate(d2)));
  await visits.getByLabel(/^Note \(optional\)/).fill("E2E booked by phone");
  await visits.getByRole("button", { name: "Book this visit" }).dblclick();
  await expect(visits.getByRole("status").filter({ hasText: "Visit booked. The family has been told." })).toBeVisible();
  const booked = visits.getByRole("listitem").filter({ hasText: shownDate(d2) });
  // The mutation confirmation precedes the separate server refresh; wait for that read to settle on a cold dev server.
  await expect(booked).toContainText("Booked", { timeout: 60_000 });
  await expect(visits.getByRole("button", { name: "Book this visit" })).toBeEnabled({ timeout: 60_000 });
  await expect(booked).toContainText("Booked by staff · E2E booked by phone");
  const appts = async () => (await apiGet<ChildAppt[]>(a, `/api/v1/clinics/${clinicId}/children/${childId}/appointments`)).data!;
  expect((await appts()).filter((x) => x.sessionId === s2.sessionId && x.status === "confirmed")).toHaveLength(1);

  await f.goto(`/children/${childId}`);
  const familyVisits = f.getByRole("region", { name: "Clinic visits" });
  await expect(familyVisits.getByRole("listitem").filter({ hasText: fd2 })).toContainText("Booked");
  await waitForMessage(f, (m) => m.title === "Visit booked" && m.body.includes(messageDate(d2)) && m.body.includes(childName!), "Visit booked (staff booking)");

  // --- move -------------------------------------------------------------------------------------------------------------------------
  await a.reload();
  const row2 = upcoming(visits, d2);
  await row2.getByRole("button", { name: "Change time" }).click();
  const newTime = row2.getByLabel("New time");
  await newTime.selectOption(await optionValue(newTime, shownDate(d3)));
  await row2.getByRole("button", { name: "Move the visit" }).click();
  await expect(upcoming(visits, d3)).toContainText("Booked");
  await expect(upcoming(visits, d2)).toHaveCount(0);
  await a.reload();
  await expect(upcoming(visits, d3)).toContainText("Booked");
  await expect(upcoming(visits, d2)).toHaveCount(0);
  expect((await appts()).filter((x) => x.status === "confirmed").map((x) => x.sessionId)).toEqual([s3.sessionId]);
  const earlier = visits.locator("details").filter({ hasText: "Earlier and cancelled visits" });
  await earlier.locator("summary").click();
  await expect(earlier.getByRole("listitem").filter({ hasText: shownDate(d2) })).toContainText("Moved to another time");

  await f.reload();
  await expect(familyVisits.getByRole("listitem").filter({ hasText: fd3 })).toContainText("Booked");
  await expect(familyVisits.getByRole("listitem").filter({ hasText: fd2 })).toHaveCount(0);
  await waitForMessage(f, (m) => m.title === "Visit rescheduled" && m.body.includes(messageDate(d3)), "Visit rescheduled");

  // --- cancel -----------------------------------------------------------------------------------------------------------------------
  const row3 = upcoming(visits, d3);
  await row3.getByRole("button", { name: "Cancel visit" }).click();
  await row3.getByLabel("Reason (optional, kept with the booking)").fill("E2E family asked by phone");
  await expect(row3).toContainText(`The family is told the visit on ${shownDate(d3)} is cancelled.`);
  await row3.getByRole("button", { name: "Yes, cancel the visit" }).click();
  await expect(visits.getByText("No upcoming visit is booked.")).toBeVisible();
  await a.reload();
  await expect(visits.getByText("No upcoming visit is booked.")).toBeVisible();
  await earlier.locator("summary").click();
  await expect(earlier.getByRole("listitem").filter({ hasText: shownDate(d3) })).toContainText("Cancelled");
  expect((await appts()).filter((x) => x.status === "confirmed")).toHaveLength(0);

  await f.reload();
  await expect(familyVisits.getByRole("listitem").filter({ hasText: fd3 })).toHaveCount(0);
  await waitForMessage(f, (m) => m.title === "Visit cancelled" && m.body.includes(messageDate(d3)) && m.body.includes(childName!), "Visit cancelled");

  // The family reads all three in Messages.
  await f.goto("/messages");
  const inbox = f.getByRole("list", { name: "Messages" });
  await expect(inbox.getByRole("listitem").filter({ has: f.getByRole("heading", { name: "Visit rescheduled" }) }).filter({ hasText: messageDate(d3) })).toHaveCount(1);
  await expect(inbox.getByRole("listitem").filter({ has: f.getByRole("heading", { name: "Visit cancelled" }) }).filter({ hasText: messageDate(d3) })).toHaveCount(1);
  await expect(inbox.getByRole("listitem").filter({ has: f.getByRole("heading", { name: "Visit booked" }) }).filter({ hasText: messageDate(d2) })).toHaveCount(1);
  await family.context.close();
  await asst.context.close();
});

test("session tools on Today: roster, places (refusals and a change), cancelling a session tells the family; others are refused", async ({ browser }) => {
  test.setTimeout(420_000);
  const { clinicId, childId, childName } = readVisitState();
  const d4 = clinicDate(4);
  const asst = await signInStaff(browser, "assistant");
  const a = asst.page;
  await a.goto(`/clinic/${clinicId}/today`);
  await createSession(a, d4, "10:00", "12:00", { total: 5, online: 3, walkin: 2 });
  const s4 = (await sessionsOf(a, clinicId!)).find((s) => s.serviceDate === d4 && s.status === "open")!;

  // The family books it themselves; a double click on "Book this time" creates one appointment.
  const family = await signInFamily(browser);
  const f = family.page;
  await f.goto(`/children/${childId}`);
  const fd4 = await familyDate(f, d4);
  const familyVisits = f.getByRole("region", { name: "Clinic visits" });
  await familyVisits.getByRole("radio", { name: new RegExp(escapeRe(fd4)) }).check();
  await familyVisits.getByRole("button", { name: "Book this time" }).dblclick();
  await expect(familyVisits.getByRole("status").filter({ hasText: `Visit booked for ${fd4}` })).toBeVisible();
  const mine = (await apiGet<{ childId: string; sessionId: string; status: string }[]>(f, "/api/v1/appointments")).data!;
  expect(mine.filter((x) => x.childId === childId && x.sessionId === s4.sessionId && x.status === "confirmed")).toHaveLength(1);
  await f.reload();
  await expect(familyVisits.getByRole("listitem").filter({ hasText: fd4 })).toContainText("Booked");

  // Who is booked.
  await a.reload();
  const row = sessionRow(a, d4);
  await expect(row).toContainText("1 of 3 bookable places taken · 2 held for walk-ins · 5 in all");
  await row.locator("summary", { hasText: "Who is booked" }).click();
  const booked = row.getByRole("listitem").filter({ hasText: childName! });
  await expect(booked).toContainText("booked online");
  await expect(booked).toContainText("Booked");

  // Change places: an impossible split is refused with the reason; a cut below the families already booked cannot be sent.
  await row.locator("summary", { hasText: "Change places" }).click();
  const total = row.getByLabel("Total places");
  const online = row.getByLabel("Places families can book");
  const walkin = row.getByLabel("Places kept for walk-ins");
  await total.fill("4");
  await online.fill("3");
  await walkin.fill("2");
  await row.getByRole("button", { name: "Save places" }).click();
  await expect(formAlert(a).filter({ hasText: /more than the total|cannot exceed total/i })).toBeVisible();
  await expect(row.getByText("At least 1: families already booked.")).toBeVisible();
  await total.fill("5");
  await online.fill("0");
  await row.getByRole("button", { name: "Save places" }).click();
  expect(await online.evaluate((el) => (el as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
  // The database refuses the same cut if it is sent anyway (for example from a page loaded before the booking).
  const cut = await apiPost(a, `/api/v1/clinics/${clinicId}/sessions/${s4.sessionId}/capacity`, { expectedVersion: (await sessionsOf(a, clinicId!)).find((s) => s.sessionId === s4.sessionId)!.version, totalCapacity: 5, onlineCapacity: 0, walkinCapacity: 2 });
  expect(cut.status).toBe(409);
  expect(cut.body.error?.message).toMatch(/already booked/);
  expect.soft(cut.body.error?.message, "plain wording for one booking (QA polish)").not.toMatch(/\b1 families are\b/);
  await a.reload();
  await expect(sessionRow(a, d4)).toContainText("1 of 3 bookable places taken · 2 held for walk-ins · 5 in all");

  await sessionRow(a, d4).locator("summary", { hasText: "Change places" }).click();
  await sessionRow(a, d4).getByLabel("Total places").fill("8");
  await sessionRow(a, d4).getByLabel("Places families can book").fill("5");
  await sessionRow(a, d4).getByLabel("Places kept for walk-ins").fill("3");
  await sessionRow(a, d4).getByRole("button", { name: "Save places" }).click();
  await expect(a.getByRole("status").filter({ hasText: "Places updated." })).toBeVisible();
  await a.reload();
  await expect(sessionRow(a, d4)).toContainText("1 of 5 bookable places taken · 3 held for walk-ins · 8 in all");

  // Cancel the session: a reason, then a confirmation that says who is affected.
  const cancelRow = sessionRow(a, d4);
  await cancelRow.locator("summary", { hasText: "Cancel session" }).click();
  await cancelRow.getByLabel("Reason (families and the audit trail see it)").fill("E2E staff training day");
  await cancelRow.getByRole("button", { name: "Cancel session…" }).click();
  const confirm = cancelRow.getByRole("group", { name: "Confirm cancelling the session" });
  await expect(confirm).toContainText(`1 family booked for ${shownDate(d4)} will be told the visit will not take place`);
  await confirm.getByRole("button", { name: "Yes, cancel the session" }).click();
  await expect(sessionRow(a, d4)).toHaveCount(0);
  await a.reload();
  await expect(sessionRow(a, d4)).toHaveCount(0);
  expect((await sessionsOf(a, clinicId!)).find((s) => s.sessionId === s4.sessionId)?.status).toBe("cancelled");

  // The booking shows cancelled for staff, with the reason; a follow-up case asks staff to rebook.
  await a.goto(`/clinic/${clinicId}/children/${childId}`);
  const earlier = a.getByRole("region", { name: "Visits" }).locator("details").filter({ hasText: "Earlier and cancelled visits" });
  await earlier.locator("summary").click();
  const gone = earlier.getByRole("listitem").filter({ hasText: shownDate(d4) });
  await expect(gone).toContainText("Cancelled");
  await expect(gone).toContainText("Session cancelled: E2E staff training day");
  await a.goto(`/clinic/${clinicId}/review`);
  await expect(a.getByRole("region", { name: new RegExp(`^Booking affected by a closed session, ${escapeRe(childName!)}`) })).toContainText(shownDate(d4));

  // The family: the booking is gone from their list, the time can no longer be chosen, and they are told why.
  await f.reload();
  await expect(familyVisits.getByRole("listitem").filter({ hasText: fd4 })).toHaveCount(0);
  await expect(familyVisits.getByRole("radio", { name: new RegExp(escapeRe(fd4)) })).toHaveCount(0);
  await waitForMessage(f, (m) => m.title === "Clinic session cancelled" && m.body.includes(childName!) && m.body.includes(messageDate(d4)), "Clinic session cancelled");
  await f.goto("/messages");
  await expect(f.getByRole("list", { name: "Messages" }).getByRole("listitem").filter({ has: f.getByRole("heading", { name: "Clinic session cancelled" }) })).toContainText("Please book another time.");

  // Families cannot manage sessions.
  expect([403, 404]).toContain((await apiPost(f, `/api/v1/clinics/${clinicId}/sessions`, { serviceDate: clinicDate(5), startTime: "09:00", endTime: "10:00", totalCapacity: 2, onlineCapacity: 1, walkinCapacity: 1 })).status);
  expect([403, 404]).toContain((await apiPost(f, `/api/v1/clinics/${clinicId}/sessions/${s3Id(await sessionsOf(a, clinicId!))}/cancel`, { reason: "E2E family tries" })).status);
  await family.context.close();
  await asst.context.close();

  // A barangay health worker has no appointment duties: Today is not offered, its page and the session API refuse.
  const bhw = await signInStaff(browser, "bhw");
  const b = bhw.page;
  await b.goto(`/clinic/${clinicId}/today`);
  await expect(b.getByText("This page is unavailable to your account")).toBeVisible();
  await expect(b.getByRole("heading", { name: "Arrival queue" })).toHaveCount(0);
  expect((await apiPost(b, `/api/v1/clinics/${clinicId}/sessions`, { serviceDate: clinicDate(5), startTime: "09:00", endTime: "10:00", totalCapacity: 2, onlineCapacity: 1, walkinCapacity: 1 })).status).toBe(403);
  expect((await b.request.get(`/api/v1/clinics/${clinicId}/sessions/${s4.sessionId}/roster`)).status()).toBe(403);
  await bhw.context.close();
});

/** Any still-open future session (the one from the move step), for refusal checks. */
function s3Id(rows: SessionRow[]) {
  return rows.find((s) => s.serviceDate === clinicDate(3) && s.status === "open")!.sessionId;
}
