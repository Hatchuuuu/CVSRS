/**
 * Vaccine stock beyond the first receipt (W10), on the stock screens with real sign-in:
 * - a second usable location and a quarantine location; a delivery into the second location; wastage;
 * - a physical count is proposed by the inventory clerk, rejected by a different person (the clinical lead) with a reason, and a second
 *   count is approved and posted; balances are read back on the page and from GET /api/v1/clinics/:id/stock;
 * - cold-chain limits, a reading inside and one outside them, and the excursion review by a different person;
 * - lot disposition: quarantine by the clerk, release by the approver;
 * - a family and a clinical role without the stock clerk duty are refused stock writes.
 *
 * Stock transfers go to ANOTHER CLINIC of the organization; the e2e organization has one clinic and no documented way exists to add a
 * second (see the report), so only the empty state of the Transfers page is checked here.
 *
 * Builds on 04 (lot E2E-LOT-0001 in "E2E fridge"). Quantities are read before each step and compared as differences.
 */
import { expect, type Page } from "@playwright/test";
import { apiPost, journeyTest as test, readVisitState, signInFamily, signInStaff } from "./support";


const LOT = "E2E-LOT-0001";
const FRIDGE = "E2E fridge";
const BACKUP = "E2E backup fridge";
const QUARANTINE = "E2E quarantine box";

interface Stock {
  locations: { id: string; name: string; kind: string; status: string }[];
  lots: { lotId: string; lot: string; physicalOnHand: string; usable: string; disposition: string; locations: { locationId: string; onHand: string }[] }[];
}
async function stock(page: Page, clinicId: string): Promise<Stock> {
  const res = await page.request.get(`/api/v1/clinics/${clinicId}/stock`);
  expect(res.status()).toBe(200);
  return (await res.json()).data as Stock;
}
async function onHandAt(page: Page, clinicId: string, location: string): Promise<number> {
  const s = await stock(page, clinicId);
  const loc = s.locations.find((l) => l.name === location)!;
  const lot = s.lots.find((l) => l.lot === LOT)!;
  return Number(lot.locations.find((x) => x.locationId === loc.id)?.onHand ?? 0);
}
async function lotTotals(page: Page, clinicId: string) {
  const lot = (await stock(page, clinicId)).lots.find((l) => l.lot === LOT)!;
  return { onHand: Number(lot.physicalOnHand), usable: Number(lot.usable), disposition: lot.disposition };
}
const lotRow = (page: Page) => page.getByRole("region", { name: "Lots" }).getByRole("listitem").filter({ hasText: `lot ${LOT}` });
const fmt = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 4 });

async function pick(select: ReturnType<Page["getByLabel"]>, text: string) {
  const option = select.locator("option", { hasText: text });
  await expect(option).toHaveCount(1);
  await select.selectOption((await option.getAttribute("value"))!);
}

test("a second location, a delivery into it, and wastage; balances agree on the page and in the stock API", async ({ browser }) => {
  test.setTimeout(240_000);
  const { clinicId } = readVisitState();
  const { context, page } = await signInStaff(browser, "nurse");
  await page.goto(`/clinic/${clinicId}/inventory`);
  const locations = page.getByRole("region", { name: "Stock locations" });
  for (const [name, kind] of [[BACKUP, "usable"], [QUARANTINE, "quarantine"]] as const) {
    await locations.getByLabel("Location name").fill(name);
    await locations.getByLabel("Kind").selectOption(kind);
    await locations.getByRole("button", { name: "Add location" }).click();
    await expect(locations.getByText(`${name} · ${kind}`)).toBeVisible();
  }
  await page.reload();
  await expect(locations.getByText(`${BACKUP} · usable`)).toBeVisible();
  await expect(locations.getByText(`${QUARANTINE} · quarantine`)).toBeVisible();

  const before = await lotTotals(page, clinicId!);
  const receive = page.getByRole("region", { name: "Receive stock" });
  await pick(receive.getByLabel("Lot", { exact: true }), LOT);
  // Only usable locations take a normal delivery.
  await expect(receive.getByLabel("Put into").locator("option", { hasText: QUARANTINE })).toHaveCount(0);
  await receive.getByLabel("Put into").selectOption({ label: BACKUP });
  await receive.getByLabel("Quantity received").fill("5");
  await receive.getByLabel("Delivery reference").fill("E2E-DELIVERY-0002");
  await receive.getByRole("button", { name: "Receive stock" }).click();
  await expect(receive.getByRole("status")).toContainText("Stock received");
  await page.reload();
  expect(await onHandAt(page, clinicId!, BACKUP)).toBe(5);
  await expect(lotRow(page)).toContainText(`${BACKUP}: 5`);
  await expect(lotRow(page)).toContainText(new RegExp(`On hand:\\s*${fmt(before.onHand + 5)}\\s*vial`));

  // Wastage from the first fridge: one vial, permanently in the ledger.
  const fridgeBefore = await onHandAt(page, clinicId!, FRIDGE);
  const waste = page.getByRole("region", { name: "Record wastage" });
  await pick(waste.getByLabel("Lot", { exact: true }), LOT);
  await pick(waste.getByLabel("From"), FRIDGE);
  await waste.getByLabel("Quantity").fill("1");
  await waste.getByLabel("Reason").selectOption("breakage");
  await waste.getByLabel("Incident reference (optional)").fill("E2E-INCIDENT-0001");
  await waste.getByRole("button", { name: "Record wastage" }).click();
  await expect(waste.getByRole("status")).toContainText("Wastage recorded");
  await page.reload();
  expect(await onHandAt(page, clinicId!, FRIDGE)).toBe(fridgeBefore - 1);
  await expect(lotRow(page)).toContainText(`${FRIDGE}: ${fmt(fridgeBefore - 1)}`);

  // The ledger shows both movements with their references.
  await lotRow(page).getByRole("button", { name: "Show ledger" }).click();
  const ledger = lotRow(page).getByRole("region", { name: /Lot ledger/ });
  await expect(ledger).toContainText("E2E-DELIVERY-0002");
  await expect(ledger).toContainText("E2E-INCIDENT-0001");

  // Transfers go to another clinic of the organization; this organization has only one.
  await page.goto(`/clinic/${clinicId}/inventory/transfers`);
  await expect(page.getByRole("region", { name: "Send stock to another clinic" })).toContainText("There is no other active clinic in this organization.");
  await context.close();
});

test("a stock count: the clerk proposes, the clinical lead rejects one with a reason and approves another; books follow", async ({ browser }) => {
  test.setTimeout(300_000);
  const { clinicId } = readVisitState();
  const clerk = await signInStaff(browser, "nurse");
  const n = clerk.page;
  await n.goto(`/clinic/${clinicId}/inventory`);
  const book = await onHandAt(n, clinicId!, FRIDGE);
  const count = n.getByRole("region", { name: "Physical count" });
  const propose = async (observed: number, ref: string) => {
    await pick(count.getByLabel("Lot", { exact: true }), LOT);
    await pick(count.getByLabel("Location", { exact: true }), FRIDGE);
    await count.getByLabel("Quantity you counted").fill(String(observed));
    await count.getByLabel("Count sheet reference").fill(ref);
    await count.getByLabel("Why might it differ?").fill("E2E monthly count");
    await count.getByRole("button", { name: "Submit count" }).click();
    await expect(count.getByRole("status")).toContainText("The difference needs approval from a clinical lead before the books change.");
  };
  await propose(book - 2, "E2E-COUNT-0001");
  await n.reload();
  expect(await onHandAt(n, clinicId!, FRIDGE)).toBe(book);

  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/review`);
  const first = l.getByRole("region", { name: /^Stock count difference/ }).filter({ hasText: "E2E-COUNT-0001" });
  await expect(first).toContainText(`A physical count found ${fmt(book - 2)} where the books showed ${fmt(book)} (difference -2)`);
  await first.getByRole("button", { name: "Reject the count…" }).click();
  await first.getByLabel("Why the count is wrong (recorded in the audit trail)").fill("E2E: two vials were in the door rack");
  await first.getByRole("button", { name: "Reject the count" }).click();
  await expect(first).toHaveCount(0);
  await l.reload();
  await expect(l.getByRole("region", { name: /^Stock count difference/ }).filter({ hasText: "E2E-COUNT-0001" })).toHaveCount(0);
  expect(await onHandAt(l, clinicId!, FRIDGE)).toBe(book);

  // A second count (one more vial found) is approved and posted by the lead.
  await propose(book + 1, "E2E-COUNT-0002");
  await l.reload();
  const second = l.getByRole("region", { name: /^Stock count difference/ }).filter({ hasText: "E2E-COUNT-0002" });
  await second.getByRole("button", { name: "Approve and post the adjustment…" }).click();
  await second.getByRole("button", { name: "Yes, post the adjustment" }).click();
  await expect(second).toHaveCount(0);
  expect(await onHandAt(l, clinicId!, FRIDGE)).toBe(book + 1);
  await n.reload();
  await expect(lotRow(n)).toContainText(`${FRIDGE}: ${fmt(book + 1)}`);
  await lotRow(n).getByRole("button", { name: "Show ledger" }).click();
  await expect(lotRow(n).getByRole("region", { name: /Lot ledger/ })).toContainText("E2E-COUNT-0002");
  await expect(lotRow(n).getByRole("region", { name: /Lot ledger/ })).not.toContainText("E2E-COUNT-0001");

  // The books agree with the ledger (the approver's check).
  await l.goto(`/clinic/${clinicId}/inventory`);
  await l.getByRole("region", { name: "Check the books" }).getByRole("button", { name: "Check", exact: true }).click();
  await expect(l.getByRole("status").filter({ hasText: "Books agree with the ledger" })).toBeVisible();
  await clerk.context.close();
  await lead.context.close();
});

test("cold chain: limits, readings inside and outside them, and the excursion reviewed by a different person; lot quarantine and release", async ({ browser }) => {
  test.setTimeout(300_000);
  const { clinicId } = readVisitState();
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  await l.goto(`/clinic/${clinicId}/inventory/cold-chain`);
  const limits = l.getByRole("region", { name: "Approved limits" });
  // Synthetic test limits only, typed in as a cold-chain lead would from their own policy.
  await limits.getByLabel("Lowest allowed (°C)").fill("1");
  await limits.getByLabel("Highest allowed (°C)").fill("9");
  await limits.getByLabel("Policy these limits come from").fill("E2E synthetic limits (test only)");
  await limits.getByRole("button", { name: "Save limits" }).click();
  await expect(limits.getByRole("status")).toContainText("Limits saved");
  await l.reload();
  await expect(limits).toContainText(/1(\.0+)? to 9(\.0+)? °C/);
  await expect(limits).toContainText("E2E synthetic limits (test only)");

  const clerk = await signInStaff(browser, "nurse");
  const n = clerk.page;
  await n.goto(`/clinic/${clinicId}/inventory/cold-chain`);
  // The clerk cannot set limits.
  await expect(n.getByRole("region", { name: "Approved limits" })).toContainText("Only an inventory approver can change limits.");
  const reading = n.getByRole("region", { name: "Log a reading" });
  const log = async (min: string, max: string, note: string) => {
    await reading.getByLabel("Fridge or store").selectOption({ label: `${FRIDGE} (usable)` });
    await reading.getByLabel("Lowest (°C)").fill(min);
    await reading.getByLabel("Highest (°C)").fill(max);
    await reading.getByLabel("Note (optional)").fill(note);
    await reading.getByRole("button", { name: "Save reading" }).click();
  };
  await log("3", "5", "E2E morning reading");
  await expect(reading.getByRole("status").filter({ hasText: "Within the approved limits" })).toBeVisible();
  await log("4", "12", "E2E door left open");
  await expect(reading.getByRole("alert").filter({ hasText: "Outside the approved limits" })).toBeVisible();
  await n.reload();
  await expect(n.getByRole("alert").filter({ hasText: "1 reading outside the approved limits needs a decision" })).toBeVisible();
  const history = n.getByRole("region", { name: "Recent readings and unresolved excursions" });
  await expect(history.getByRole("listitem").filter({ hasText: "E2E morning reading" })).toContainText("Within limits");
  await expect(history.getByRole("listitem").filter({ hasText: "E2E door left open" })).toContainText("Outside limits · needs a decision");
  // The clerk who logged it is not the reviewer.
  await expect(history.getByRole("listitem").filter({ hasText: "E2E door left open" }).getByRole("button", { name: "Record what was done" })).toHaveCount(0);

  // Lot disposition: the clerk quarantines the lot; it is no longer usable.
  await n.goto(`/clinic/${clinicId}/inventory`);
  const usableBefore = (await lotTotals(n, clinicId!)).usable;
  expect(usableBefore).toBeGreaterThan(0);
  await lotRow(n).getByRole("button", { name: "Change lot status" }).click();
  await lotRow(n).getByLabel("New status").selectOption("quarantined");
  await lotRow(n).getByLabel("Reason (recorded in the audit trail)").fill("E2E: held after the fridge excursion");
  await lotRow(n).getByRole("button", { name: "Confirm" }).click();
  await expect(lotRow(n)).toContainText("Quarantined");
  await n.reload();
  await expect(lotRow(n)).toContainText("Quarantined");
  const held = await lotTotals(n, clinicId!);
  expect(held.disposition).toBe("quarantined");
  expect(held.usable).toBe(0);
  // The clerk cannot release it: no status change is offered, and the API refuses a release.
  await expect(lotRow(n).getByRole("button", { name: "Change lot status" })).toHaveCount(0);
  const { lotId } = readVisitState();
  expect((await apiPost(n, `/api/v1/clinics/${clinicId}/stock/lots/${lotId}/disposition`, { disposition: "usable", reason: "E2E clerk tries to release" })).status).toBe(403);
  await clerk.context.close();

  // The lead reviews the excursion and releases the lot.
  await l.goto(`/clinic/${clinicId}/inventory/cold-chain`);
  const excursion = l.getByRole("region", { name: "Recent readings and unresolved excursions" }).getByRole("listitem").filter({ hasText: "E2E door left open" });
  await excursion.getByRole("button", { name: "Record what was done" }).click();
  await excursion.getByLabel("Action taken").selectOption("lots_quarantined");
  await excursion.getByLabel("Details").fill("E2E: lot held, then checked and released");
  await excursion.getByRole("button", { name: "Save" }).click();
  await expect(excursion).toContainText("Outside limits · reviewed");
  await l.reload();
  await expect(excursion).toContainText("Lots quarantined: E2E: lot held, then checked and released");
  await expect(l.getByRole("alert").filter({ hasText: "outside the approved limits" })).toHaveCount(0);

  await l.goto(`/clinic/${clinicId}/inventory`);
  await lotRow(l).getByRole("button", { name: "Change lot status" }).click();
  await lotRow(l).getByLabel("New status").selectOption("usable");
  await lotRow(l).getByLabel("Reason (recorded in the audit trail)").fill("E2E: released after review");
  await lotRow(l).getByRole("button", { name: "Confirm" }).click();
  await expect(lotRow(l)).toContainText("In date");
  await l.reload();
  await expect(lotRow(l)).toContainText("In date");
  expect((await lotTotals(l, clinicId!)).usable).toBe(usableBefore);
  await lead.context.close();
});

test("a family and a clinical role without the stock clerk duty are refused stock writes", async ({ browser }) => {
  test.setTimeout(180_000);
  const { clinicId, lotId } = readVisitState();
  const lead = await signInStaff(browser, "lead");
  const l = lead.page;
  const fridge = (await stock(l, clinicId!)).locations.find((x) => x.name === FRIDGE)!;
  const writes: [string, unknown][] = [
    [`/api/v1/clinics/${clinicId}/stock/wastage`, { lotId, locationId: fridge.id, quantity: 1, reason: "damaged" }],
    [`/api/v1/clinics/${clinicId}/stock/receipts`, { lotId, locationId: fridge.id, quantity: 1, deliveryReference: "E2E-REFUSED", accepted: true }],
    [`/api/v1/clinics/${clinicId}/stock/adjustments`, { lotId, locationId: fridge.id, observed: 0, countReference: "E2E-REFUSED", reason: "E2E refused" }],
    [`/api/v1/clinics/${clinicId}/stock/locations`, { name: "E2E refused location", kind: "usable" }],
  ];
  const before = await onHandAt(l, clinicId!, FRIDGE);
  // The clinical lead approves stock but is not a stock clerk: the clerk's forms are not shown and the API refuses.
  await l.goto(`/clinic/${clinicId}/inventory`);
  await expect(l.getByRole("region", { name: "Record wastage" })).toHaveCount(0);
  for (const [path, body] of writes) expect((await apiPost(l, path, body)).status, path).toBe(403);

  const assistant = await signInStaff(browser, "assistant");
  await assistant.page.goto(`/clinic/${clinicId}/inventory`);
  await expect(assistant.page.getByText("This page is unavailable to your account")).toBeVisible();
  for (const [path, body] of writes.slice(0, 2)) expect((await apiPost(assistant.page, path, body)).status, path).toBe(403);
  await assistant.context.close();

  const family = await signInFamily(browser);
  for (const [path, body] of writes) expect([403, 404], path).toContain((await apiPost(family.page, path, body)).status);
  expect([403, 404]).toContain((await family.page.request.get(`/api/v1/clinics/${clinicId}/stock`)).status());
  await family.context.close();

  expect(await onHandAt(l, clinicId!, FRIDGE)).toBe(before);
  await lead.context.close();
});
