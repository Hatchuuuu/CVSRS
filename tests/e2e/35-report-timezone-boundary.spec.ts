import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import { account, asDatabaseOwner, env, journeyTest as test, readVisitState, shownDate, signIn, verifyTotp } from "./support";

// Historical immutable facts are reporting fixtures, not a shortcut through administration/stock validation.
// A separate clinic keeps these facts out of all preceding journeys' reports. No clinical rules are changed.
test("clinic-local midnight bounds agree in daily report, downloaded CSV and paper reconciliation", async ({ browser }) => {
  test.setTimeout(240_000);
  expect(new URL(env.dbUrl).port).toBe("55322");
  expect(new URL(env.baseUrl).port).toBe("3100");
  const clinicId = randomUUID();
  const childId = randomUUID();
  const date = "2026-01-15";
  const timezone = "Asia/Manila"; // Fixed-offset clinic zone; no device-zone or DST assumptions.
  const instants = ["2026-01-14T15:59:59.999Z", "2026-01-14T16:00:00.000Z", "2026-01-14T16:00:00.001Z", "2026-01-15T15:59:59.999Z", "2026-01-15T16:00:00.000Z"];
  const localDate = (instant: string) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(instant));
    const part = (type: string) => parts.find(p => p.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };
  expect(instants.map(localDate)).toEqual(["2026-01-14", date, date, date, "2026-01-16"]);
  const expected = instants.filter(instant => localDate(instant) === date).length;
  expect(instants.filter(instant => instant.slice(0, 10) === date).length).not.toBe(expected);
  const fixture = await asDatabaseOwner(async db => {
    await db.query("begin");
    try {
      const source = (await db.query("select organization_id,timezone from public.clinics where id=$1", [readVisitState().clinicId])).rows[0] as { organization_id: string; timezone: string };
      expect(source.timezone).toBe(timezone);
      const lead = (await db.query("select id from public.profiles where id=(select id from auth.users where email=$1)", [account("lead")])).rows[0].id as string;
      const product = (await db.query("select id,code from public.vaccine_products where organization_id=$1 and status='active' order by code limit 1", [source.organization_id])).rows[0] as { id: string; code: string };
      const threshold = Number((await db.query("select value from private.settings where key='report_small_cell_threshold'")).rows[0]?.value ?? 0);
      expect(threshold, "exact CSV counts require the isolated suite's normal unsuppressed fixture setting").toBeLessThanOrEqual(expected);
      await db.query("insert into public.clinics(id,organization_id,name,timezone) values($1,$2,'E2E midnight reporting fixture',$3)", [clinicId, source.organization_id, timezone]);
      await db.query("insert into public.staff_memberships(organization_id,profile_id,clinic_id,role_code,capabilities,status,requested_by,approved_by) select organization_id,profile_id,$1,role_code,capabilities,status,requested_by,approved_by from public.staff_memberships where clinic_id=$2 and profile_id=$3 and role_code='clinical_lead' and status='active'", [clinicId, readVisitState().clinicId, lead]);
      await db.query("insert into public.children(id,organization_id,local_record_no,display_name,dob,birth_date_precision,record_status) values($1,$2,$3,'Synthetic midnight fixture','2025-01-01','exact','active')", [childId, source.organization_id, `MID-${childId}`]);
      for (const instant of instants) {
        const event = randomUUID();
        await db.query("insert into public.vaccination_events(id,organization_id,original_child_id,origin,created_by) values($1,$2,$3,'clinic_administered',$4)", [event, source.organization_id, childId, lead]);
        await db.query("insert into public.vaccination_revisions(organization_id,event_id,revision_no,child_id,product_id,administered_on,administered_at,administered_by,clinic_id,source,verification_status,signed_at,created_by) values($1,$2,1,$3,$4,$5,$6,$7,$8,'clinic_administered','verified',$6,$7)", [source.organization_id, event, childId, product.id, localDate(instant), instant, lead, clinicId]);
        const token = createHash("sha256").update(randomUUID()).digest("hex");
        const snapshot = JSON.stringify({ fixture: "synthetic report boundary only", childId });
        await db.query("insert into public.certificates(organization_id,clinic_id,child_id,certificate_no,snapshot,content_hash,verification_token_hash,status,issued_at,issuer_id) values($1,$2,$3,$4,$5,$6,$7,'issued',$8,$9)", [source.organization_id, clinicId, childId, `MID-${randomUUID()}`, snapshot, createHash("sha256").update(snapshot).digest("hex"), token, instant, lead]);
      }
      await db.query("commit");
      return product;
    } catch (error) { await db.query("rollback"); throw error; }
  });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await signIn(page, account("lead"), undefined, true);
    await expect(page).toHaveURL(/\/clinic$/);
    await page.goto(`/clinic/${clinicId}/reports?from=${date}&to=${date}`);
    await verifyTotp(page, readVisitState().totp!.lead!);
    await page.goto(`/clinic/${clinicId}/reports?from=${date}&to=${date}`);
    const table = page.getByRole("region", { name: "Daily activity table", exact: true });
    const cells = table.getByRole("row").filter({ hasText: shownDate(date) }).getByRole("cell");
    await expect(cells).toHaveCount(11);
    await expect(cells.nth(9)).toHaveText(String(expected));
    await expect(cells.nth(10)).toHaveText(String(expected));
    const totals = table.getByRole("row").filter({ hasText: "Total" }).getByRole("cell");
    await expect(totals.nth(9)).toHaveText(String(expected));
    await expect(totals.nth(10)).toHaveText(String(expected));
    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
    const csv = (await readFile((await download.path())!, "utf8")).replace(/^\uFEFF/, "");
    const lines = csv.trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Date,Booked,Cancelled,No-show,Arrivals,Walk-ins,Completed,Deferred,Left,Vaccinations given,Certificates issued");
    expect(lines[1]!.split(",")).toEqual([date, "0", "0", "0", "0", "0", "0", "0", "0", String(expected), String(expected)]);

    await page.goto(`/clinic/${clinicId}/reports?report=paper-reconciliation&from=${date}&to=${date}`);
    const paper = page.getByRole("region", { name: "Paper log check table", exact: true });
    const row = paper.getByRole("row").filter({ hasText: fixture.code });
    await expect(row.getByRole("cell").nth(4)).toHaveText(String(expected));
    await expect(row).toContainText("No paper entry yet");
    const tally = page.getByRole("region", { name: "Enter a paper log tally", exact: true });
    await tally.getByLabel("Vaccine", { exact: true }).selectOption(fixture.id);
    await tally.getByLabel("Doses on the paper log").fill(String(expected + 1));
    await tally.getByRole("button", { name: "Save tally", exact: true }).click();
    await expect(tally.getByRole("status").filter({ hasText: "Tally saved" })).toBeVisible();
    await expect(row.getByRole("cell").nth(5)).toHaveText("-1");
    await expect(row).toContainText("Paper is higher");
    await tally.getByLabel("Doses on the paper log").fill(String(expected));
    await tally.getByRole("button", { name: "Save tally", exact: true }).click();
    await expect(row.getByRole("cell").nth(3)).toHaveText(String(expected));
    await expect(row.getByRole("cell").nth(4)).toHaveText(String(expected));
    await expect(row.getByRole("cell").nth(5)).toHaveText("0");
    await expect(row).toContainText("Agrees");
    await page.reload();
    await expect(row).toContainText("Agrees");
  } finally { await context.close(); }
  // Keep append-only synthetic evidence in its private fixture clinic; deleting it would bypass audit/immutability guards.
});
