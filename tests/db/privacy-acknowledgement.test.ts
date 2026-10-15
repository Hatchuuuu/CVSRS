import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

const TEXT = "This clinic keeps vaccination records to provide care, and shares them only with authorized staff and the child's guardians.";
let clinic: string, guardian: Actor, manager: Actor;
const ack = (version: string, text: string, key = op()) => as(guardian, (q) => q("select public.acknowledge_clinic_privacy_notice($1,$2,$3,$4) as r", [key, clinic, version, text]));
const set = (version: string, text = TEXT) => as(manager, (q) => q("select public.set_privacy_notice($1,$2,$3,$4)", [op(), clinic, version, text]));
const records = () => admin("select notice_version, notice_sha256 from public.privacy_records where profile_id = $1 and clinic_id = $2", [guardian.id, clinic]);

beforeEach(async () => {
  const org = await makeOrg("Viewed Privacy");
  clinic = await makeClinic(org, "Viewed Privacy Clinic");
  guardian = await newUser("viewed-guardian");
  manager = await newUser("viewed-manager");
  await grant(org, clinic, manager, "tech_admin");
  await set("v1");
});
afterAll(async () => { await pool.end(); });

describe("acknowledge the notice actually viewed", () => {
  it("rejects an earlier displayed version without recording acceptance of the new version", async () => {
    await set("v2", TEXT + " The clinic has updated its retention policy.");
    await expectCode(ack("v1", TEXT), "CV409");
    expect(await records()).toEqual([]);
  });

  it("rejects different text even when the version label matches", async () => {
    await expectCode(ack("v1", TEXT + " Unseen wording."), "CV409");
    expect(await records()).toEqual([]);
  });

  it("records the matching notice once and replays the same operation", async () => {
    const key = op();
    const first = await ack("v1", TEXT, key);
    expect(first).toEqual([{ r: { version: "v1", acknowledged: true } }]);
    expect(await ack("v1", TEXT, key)).toEqual(first);
    expect(await records()).toHaveLength(1);
    await set("v2");
    await expectCode(ack("v2", TEXT, key), "CV409");
  });

  it("replays a saved acknowledgement after publication without acknowledging the new notice", async () => {
    const key = op();
    const saved = await ack("v1", TEXT, key);
    await set("v2", TEXT + " Updated retention policy.");
    expect(await ack("v1", TEXT, key)).toEqual(saved);
    const accepted = await records();
    expect(accepted).toHaveLength(1);
    expect(accepted[0]!.notice_version).toBe("v1");
    expect((await as(guardian, (q) => q<{ r: { acknowledged: boolean } }>(
      "select public.get_privacy_notice($1) r", [clinic],
    )))[0]!.r.acknowledged).toBe(false);
  });

  it("keeps the existing two-argument database command available", async () => {
    expect(await as(guardian, (q) => q("select public.acknowledge_clinic_privacy_notice($1,$2) as r", [op(), clinic])))
      .toEqual([{ r: { version: "v1", acknowledged: true } }]);
  });

  it("reads the committed policy after a concurrent publisher releases the clinic lock", async () => {
    const publisher = await pool.connect();
    try {
      await publisher.query("begin");
      await publisher.query("update public.clinics set operational_policy = jsonb_set(operational_policy, '{privacyNotice,version}', '\"v2\"') where id = $1", [clinic]);
      let settled = false;
      const pending = ack("v1", TEXT).then(() => "accepted", (error: { code: string }) => error.code)
        .then((result) => { settled = true; return result; });
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] = await admin<{ blocked: boolean }>("select exists (select 1 from pg_stat_activity where datname = current_database() and query like '%select public.acknowledge_clinic_privacy_notice%' and wait_event_type = 'Lock') as blocked");
        if (row.blocked) { blocked = true; break; }
        if (settled) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(settled).toBe(false);
      expect(blocked).toBe(true);
      await publisher.query("commit");
      expect(await pending).toBe("CV409");
      expect(await records()).toEqual([]);
    } finally {
      await publisher.query("rollback");
      publisher.release();
    }
  });
});
