import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN_URL, PORT, assertProjectCluster, disposableTestName } from "../../scripts/db";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

/**
 * Forward migrations 0000_extensions and 0034_integrity_performance: one block per audit finding
 * (SUP-01, DB-01, SEC-05, DB-02, FE-01, DB-03, DB-04, DB-05, DB-06, SUP-02). Real role switches throughout.
 */

let w: ClinicalWorld;
type R = { r: Record<string, unknown> };
type Rows<T> = { r: T };
const T = (n: number) => isoDaysFromToday(n);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);
let seq = 0;

async function staffChild(name: string, daysOld = 90, clinic = w.clinic, actor: Actor = w.assistant) {
  const [{ r }] = await as(actor, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), clinic, JSON.stringify({ displayName: `${name} ${++seq}`, dob: T(-daysOld) })]));
  return r.childId as string;
}
const merge = (survivor: string, duplicate: string) =>
  as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed same child by document')", [op(), w.clinic, survivor, duplicate]));
const outsideDose = (child: string, code: string, on: string) =>
  as(w.clinician, (q) => q<R>("select public.record_outside_dose_staff($1,$2,$3,$4,$5,true) as r", [op(), w.clinic, child, JSON.stringify({ productText: code, administeredOn: on, provider: "Other Clinic X" }), w.products[code]])).then((x) => x[0]!.r);

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "integrity-0034");
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("SUP-01: migrations create the extensions they call (0000_extensions)", () => {
  it("applies on a database whose bootstrap creates no extensions, and is a no-op where they already exist", async () => {
    const root = resolve(import.meta.dirname, "..", "..", "supabase");
    const name = `${disposableTestName(process.env.CVSRS_TEST_DB_NAME)}_noext`;
    const server = new pg.Client({ connectionString: ADMIN_URL });
    await server.connect();
    try {
      await assertProjectCluster(server);
      await server.query(`drop database if exists ${name} with (force)`);
      await server.query(`create database ${name}`);
      const c = new pg.Client({ connectionString: `postgresql://postgres@127.0.0.1:${PORT}/${name}` });
      await c.connect();
      try {
        const bootstrap = readFileSync(join(root, "bootstrap.sql"), "utf8").replace(/^create extension .*$/gim, "-- removed for this test");
        expect(bootstrap).not.toMatch(/create extension/i);
        await c.query(bootstrap);
        for (const f of readdirSync(join(root, "migrations")).filter((x) => x.endsWith(".sql")).sort()) {
          await c.query(readFileSync(join(root, "migrations", f), "utf8")).catch((e: Error) => { throw new Error(`${f}: ${e.message}`); });
        }
        const ext = await c.query("select e.extname, n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname in ('pgcrypto','pg_trgm','unaccent') order by 1");
        expect(ext.rows).toEqual([{ extname: "pg_trgm", nspname: "extensions" }, { extname: "pgcrypto", nspname: "extensions" }, { extname: "unaccent", nspname: "extensions" }]);
      } finally {
        await c.end();
      }
      await server.query(`drop database if exists ${name} with (force)`);
    } finally {
      await server.end();
    }
    // Re-running it where bootstrap already created the extensions changes nothing.
    await admin(readFileSync(join(root, "migrations", "0000_extensions.sql"), "utf8"));
  }, 120_000);
});

describe("DB-01: a clinical hold survives a duplicate merge", () => {
  it("after merging a held duplicate the survivor is blocked, lists the hold, can release it, and the move is audited", async () => {
    const dup = await staffChild("Hold Dup Kid");
    const survivor = await staffChild("Hold Survivor Kid");
    const [{ r: placed }] = await as(w.clinician, (q) => q<R>("select public.place_clinical_hold($1,$2,$3,'contraindication review',null,null,null) as r", [op(), w.clinic, dup]));
    expect((await admin<R>("select private.check_planned_dose($1,$2,$3) as r", [dup, w.products["DEMO-P-ALPHA"], T(0)]))[0]!.r).toMatchObject({ blocked: true });
    await merge(survivor, dup);
    expect(await admin("select child_id, status from public.clinical_holds where id = $1", [placed.holdId])).toEqual([{ child_id: survivor, status: "active" }]);
    const blocked = (await admin<R>("select private.check_planned_dose($1,$2,$3) as r", [survivor, w.products["DEMO-P-ALPHA"], T(0)]))[0]!.r as { blocked: boolean; reasons: string[] };
    expect(blocked.blocked).toBe(true);
    expect(blocked.reasons).toContain("clinical_hold");
    const listed = (await as(w.lead, (q) => q<Rows<{ id: string; status: string }[]>>("select public.list_clinical_holds($1,$2) as r", [w.clinic, survivor])))[0]!.r;
    expect(listed.map((h) => h.id)).toContain(placed.holdId);
    const ev = (await as(w.clinician, (q) => q<R>("select public.evaluate_child($1,$2,null) as r", [w.clinic, survivor])))[0]!.r as { requirements: { reasons: { code: string }[] }[] };
    expect(ev.requirements.some((x) => x.reasons.some((y) => y.code === "clinical_hold"))).toBe(true);
    expect(await count("select count(*) n from private.audit_logs where action = 'hold.merged' and entity_id = $1", [placed.holdId])).toBe(1);
    await as(w.lead, (q) => q("select public.release_clinical_hold($1,$2,$3,'reviewed after merge')", [op(), w.clinic, placed.holdId]));
    expect((await admin<R>("select private.check_planned_dose($1,$2,$3) as r", [survivor, w.products["DEMO-P-ALPHA"], T(0)]))[0]!.r).toMatchObject({ blocked: false });
  });

  it("holds left on an already-merged record (before this fix) are read through the alias set and re-pointed by the backfill", async () => {
    const dup = await staffChild("Legacy Hold Dup");
    const survivor = await staffChild("Legacy Hold Survivor");
    await merge(survivor, dup);
    // Recreate the pre-fix state: an active hold still keyed to the merged duplicate.
    const [h] = await admin<{ id: string }>(
      "insert into public.clinical_holds (organization_id, child_id, reason_code, placed_clinic_id, created_by, updated_by) values ($1,$2,'legacy hold',$3,$4,$4) returning id",
      [w.org, dup, w.clinic, w.clinician.id]);
    expect((await admin<R>("select private.check_planned_dose($1,$2,$3) as r", [survivor, w.products["DEMO-P-ALPHA"], T(0)]))[0]!.r).toMatchObject({ blocked: true });
    const listed = (await as(w.lead, (q) => q<Rows<{ id: string }[]>>("select public.list_clinical_holds($1,$2) as r", [w.clinic, survivor])))[0]!.r;
    expect(listed.map((x) => x.id)).toContain(h!.id);
    await expectCode(as(w.clinician, (q) => q("select public.place_clinical_hold($1,$2,$3,'legacy hold again',null,null,null)", [op(), w.clinic, survivor])), "CV409");
    const [{ n }] = await admin<{ n: number }>("select private.repoint_merged_holds() as n");
    expect(n).toBeGreaterThanOrEqual(1);
    expect(await admin("select child_id from public.clinical_holds where id = $1", [h!.id])).toEqual([{ child_id: survivor }]);
    expect(await count("select count(*) n from private.audit_logs where action = 'hold.merged' and entity_id = $1 and system_job_id = 'system'", [h!.id])).toBe(1);
  });
});

describe("SEC-05: merge_children checks ownership before locking or inspecting either record", () => {
  it("a foreign-organization child with an open visit is CV404, not a CV409 state oracle, and is never locked", async () => {
    const org2 = await makeOrg("SEC05 Org");
    const clinic2 = await makeClinic(org2, "SEC05 Clinic");
    const staff2 = await newUser("sec05-staff");
    await grant(org2, clinic2, staff2, "clinical_lead");
    const foreign = await staffChild("Foreign Open Visit", 90, clinic2, staff2);
    await admin("insert into public.encounters (organization_id, child_id, clinic_id, service_date) values ($1,$2,$3,current_date)", [org2, foreign, clinic2]);
    const mine = await staffChild("Own Child");
    const sameOrgOther = await staffChild("Other Clinic Open Visit", 90, w.otherClinic, w.otherClinicStaff);
    await admin("insert into public.encounters (organization_id, child_id, clinic_id, service_date) values ($1,$2,$3,current_date)", [w.org, sameOrgOther, w.otherClinic]);
    // Hold a row lock on the foreign child: a wrapper that still locked it first would time out instead of answering.
    const locker = await pool.connect();
    try {
      await locker.query("begin");
      await locker.query("select 1 from public.children where id = any($1) for update", [[foreign, sameOrgOther]]);
      for (const other of [foreign, sameOrgOther]) {
        await expectCode(as(w.lead, async (q) => {
          await q("set local lock_timeout = '2s'");
          return q("select public.merge_children($1,$2,$3,$4,'dup test')", [op(), w.clinic, mine, other]);
        }), "CV404");
      }
    } finally {
      await locker.query("rollback");
      locker.release();
    }
  });
});

describe("DB-02: child-scoped readers no longer scan every organization's revisions", () => {
  it("has the merged_into_id and lot indexes, and the child readers do not read the whole-table view", async () => {
    const idx = await admin<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'public' and tablename in ('children','vaccination_revisions')");
    expect(idx.some((i) => /ON public\.children USING btree \(merged_into_id\) WHERE \(merged_into_id IS NOT NULL\)/.test(i.indexdef))).toBe(true);
    expect(idx.some((i) => /ON public\.vaccination_revisions USING btree \(lot_id\)/.test(i.indexdef))).toBe(true);
    const defs = await admin<{ name: string; def: string }>(
      `select p.proname as name, pg_get_functiondef(p.oid) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where (n.nspname, p.proname) in (('private','child_eval_inputs'),('public','list_child_history'),('public','guardian_child_history'),('public','issue_certificate'),
                                         ('public','report_backlog'),('public','record_administration'),('public','trace_lot_use'))`);
    expect(defs.length).toBeGreaterThanOrEqual(7);
    for (const d of defs) expect(d.def, d.name).not.toMatch(/private\.current_revisions\b/);
  });

  it("returns exactly what the old whole-table view returned, including merged aliases and events moved between children", async () => {
    const a = await staffChild("Equiv Survivor", 400);
    const d = await staffChild("Equiv Duplicate", 400);
    const x = await staffChild("Equiv Other", 400);
    await outsideDose(a, "DEMO-P-ALPHA", T(-300));
    const amended = (await outsideDose(a, "DEMO-P-COMBO", T(-250))).eventId as string;
    await outsideDose(d, "DEMO-P-GAMMA", T(-200));
    const toA = (await outsideDose(x, "DEMO-P-ALPHA", T(-150))).eventId as string;
    const fromA = (await outsideDose(a, "DEMO-P-COMBO", T(-100))).eventId as string;
    const nextRevision = (event: string, child: string, on: string) => admin(
      `insert into public.vaccination_revisions (organization_id, event_id, revision_no, child_id, product_id, administered_on, date_precision, source, verification_status, approved_by, clinic_id)
       select organization_id, event_id, revision_no + 1, $2, product_id, $3, 'exact', source, verification_status, approved_by, clinic_id
         from public.vaccination_revisions where event_id = $1 order by revision_no desc limit 1`, [event, child, on]);
    await nextRevision(amended, a, T(-249));
    await nextRevision(toA, a, T(-150));
    await nextRevision(fromA, x, T(-100));
    await merge(a, d);
    const viaView = (await admin<{ ids: string[] }>("select array_agg(id order by id) ids from private.current_revisions where child_id in (select private.child_ids_with_aliases($1))", [a]))[0]!.ids;
    const viaHelper = (await admin<{ ids: string[] }>("select array_agg(id order by id) ids from private.child_current_revisions(array(select private.child_ids_with_aliases($1)))", [a]))[0]!.ids;
    expect(viaHelper).toEqual(viaView);
    expect(viaView).toHaveLength(4);
    const history = (await as(w.lead, (q) => q<Rows<{ eventId: string; revisionNo: number }[]>>("select public.list_child_history($1,$2) as r", [w.clinic, a])))[0]!.r;
    expect(history.map((h) => h.eventId)).not.toContain(fromA);
    expect(history.find((h) => h.eventId === amended)?.revisionNo).toBe(2);
    expect(history.find((h) => h.eventId === toA)?.revisionNo).toBe(2);
    // Every child in the database: the helper agrees with the view.
    expect(await count(`select count(*) n from public.children c
      where (select array_agg(id order by id) from private.current_revisions where child_id in (select private.child_ids_with_aliases(c.id)))
            is distinct from (select array_agg(id order by id) from private.child_current_revisions(array(select private.child_ids_with_aliases(c.id))))`)).toBe(0);
    // report_backlog's pendingOutsideDoses: same count as the old definition.
    const old = await count(`select count(*) n from private.current_revisions cr where cr.verification_status = 'pending_verification' and cr.event_status = 'active'
                              and private.child_in_clinic(private.canonical_child(cr.child_id), $1)`, [w.clinic]);
    const report = (await as(w.lead, (q) => q<R>("select public.report_backlog($1) as r", [w.clinic])))[0]!.r;
    expect(Number(report.pendingOutsideDoses)).toBe(old);
  });
});

describe("FE-01: approve_stock_adjustment only approves count proposals", () => {
  it("refuses a transfer-shortfall stock case and leaves it open", async () => {
    const inv2 = await newUser("inv2-fe01");
    await grant(w.org, w.otherClinic, inv2, "inventory");
    const loc = async (a: Actor, clinic: string, name: string, kind: string) => (await as(a, (q) => q<R>("select public.create_stock_location($1,$2,$3,$4) as r", [op(), clinic, name, kind])))[0]!.r.locationId as string;
    const fridgeA = await loc(w.inventory, w.clinic, "FE01 Fridge A", "usable");
    await loc(w.inventory, w.clinic, "FE01 Quarantine A", "quarantine");
    const fridgeB = await loc(inv2, w.otherClinic, "FE01 Fridge B", "usable");
    await loc(inv2, w.otherClinic, "FE01 Quarantine B", "quarantine");
    const lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], "FE01-LOT", "2099-12-31"])))[0]!.r.lotId as string;
    await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,$5,'DR-FE01')", [op(), w.clinic, fridgeA, lot, 10]));
    const t = (await as(w.inventory, (q) => q<R>("select public.send_stock_transfer($1,$2,$3,$4,$5,$6,'x') as r", [op(), w.clinic, w.otherClinic, fridgeA, lot, 5])))[0]!.r;
    await as(inv2, (q) => q("select public.receive_stock_transfer($1,$2,$3,$4,$5,$6,null)", [op(), w.otherClinic, t.transferId, fridgeB, 3, true]));
    const [k] = await admin<{ id: string }>("select id from public.record_review_cases where kind = 'stock' and evidence ->> 'transferId' = $1", [t.transferId]);
    const key = op();
    await expectCode(as(w.lead, (q) => q("select public.approve_stock_adjustment($1,$2,$3)", [key, w.clinic, k!.id])), "CV409");
    expect(await admin("select status from public.record_review_cases where id = $1", [k!.id])).toEqual([{ status: "open" }]);
    expect(await admin("select 1 from private.command_receipts where operation_key = $1", [key])).toHaveLength(0);
  });
});

describe("DB-03: privacy acknowledgements bind clinic, version and the exact notice text", () => {
  let org: string, clinicA: string, clinicB: string, tadmin: Actor, assistantB: Actor;
  const TEXT_A = "Clinic A notice: we share records with the provincial registry for follow-up and reminders. ";
  const TEXT_B = "Clinic B notice: different text; we also send reminders through a third-party SMS gateway. ";
  const notice = (a: Actor, clinic: string) => as(a, (q) => q<R>("select public.get_privacy_notice($1) as r", [clinic])).then((x) => x[0]!.r);
  const ack = (a: Actor, clinic: string) => as(a, (q) => q<R>("select public.acknowledge_clinic_privacy_notice($1,$2) as r", [op(), clinic])).then((x) => x[0]!.r);
  const addChild = (a: Actor, clinic: string) => as(a, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), clinic, JSON.stringify({ displayName: `Privacy Kid ${++seq}`, dob: T(-30) })]));
  const pending = (a: Actor) => as(a, (q) => q<Rows<{ clinicId: string; clinicName: string; version: string; text: string }[]>>("select public.get_pending_privacy_notices() as r")).then((x) => x[0]!.r);
  beforeAll(async () => {
    org = await makeOrg("Privacy Org");
    clinicA = await makeClinic(org, "Privacy Clinic A");
    clinicB = await makeClinic(org, "Privacy Clinic B");
    [tadmin, assistantB] = await Promise.all([newUser("privacy-tadmin"), newUser("privacy-asstB")]);
    await grant(org, clinicA, tadmin, "tech_admin");
    await grant(org, clinicB, tadmin, "tech_admin");
    await grant(org, clinicB, assistantB, "assistant");
    await as(tadmin, (q) => q("select public.set_privacy_notice($1,$2,'v1',$3)", [op(), clinicA, TEXT_A.repeat(2)]));
    await as(tadmin, (q) => q("select public.set_privacy_notice($1,$2,'v1',$3)", [op(), clinicB, TEXT_B.repeat(2)]));
  });

  it("accepting clinic A's v1 does not accept clinic B's different v1", async () => {
    const g = await newUser("privacy-g1");
    await ack(g, clinicA);
    expect(await notice(g, clinicA)).toMatchObject({ version: "v1", acknowledged: true });
    expect(await notice(g, clinicB)).toMatchObject({ version: "v1", acknowledged: false });
    await expectCode(addChild(g, clinicB), "CV409");
    await addChild(g, clinicA);
    const [rec] = await admin<{ clinic_id: string; profile_id: string; notice_sha256: string }>(
      "select clinic_id, profile_id, notice_sha256 from public.privacy_records where created_by = $1 and record_type = 'notice_acknowledgement'", [g.id]);
    expect(rec).toMatchObject({ clinic_id: clinicA, profile_id: g.id });
    expect(rec!.notice_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("a text changed under the same version label must be accepted again", async () => {
    const g = await newUser("privacy-g2");
    await ack(g, clinicB);
    expect(await notice(g, clinicB)).toMatchObject({ acknowledged: true });
    await admin("update public.clinics set operational_policy = jsonb_set(operational_policy, '{privacyNotice,text}', to_jsonb($2::text)) where id = $1", [clinicB, TEXT_B.repeat(3)]);
    expect(await notice(g, clinicB)).toMatchObject({ version: "v1", acknowledged: false });
    await expectCode(addChild(g, clinicB), "CV409");
    await ack(g, clinicB);
    await addChild(g, clinicB);
  });

  it("accepting a notice creates no guardian identity in that organization; the pending list is bounded and puts the family's clinics first", async () => {
    const loner = await newUser("privacy-loner");
    const before = await pending(loner);
    expect(before.length).toBeLessThanOrEqual(100);
    expect(before.some((n) => n.clinicId === clinicA)).toBe(true);
    await ack(loner, clinicA);
    expect(await count("select count(*) n from public.guardians where profile_id = $1", [loner.id])).toBe(0);
    expect((await pending(loner)).some((n) => n.clinicId === clinicA)).toBe(false);
    // A family with a child at clinic B sees clinic B's notice first.
    const fam = await newUser("privacy-family");
    await ack(fam, clinicB);
    await addChild(fam, clinicB);
    await admin("update public.clinics set operational_policy = jsonb_set(operational_policy, '{privacyNotice}', jsonb_build_object('version','v2','text',$2::text)) where id = $1", [clinicB, TEXT_B.repeat(4)]);
    const list = await pending(fam);
    expect(list[0]).toMatchObject({ clinicId: clinicB, version: "v2" });
    expect(Object.keys(list[0]!).sort()).toEqual(["clinicId", "clinicName", "text", "version"]);
  });

  it("an acknowledgement without a bound clinic (written before this fix and not attributable) never satisfies the gate", async () => {
    const g = await newUser("privacy-legacy");
    const [gu] = await admin<{ id: string }>("insert into public.guardians (organization_id, profile_id, full_name) values ($1,$2,'Legacy') returning id", [org, g.id]);
    await admin("insert into public.privacy_records (organization_id, guardian_id, purpose, record_type, notice_version, decision, created_by) values ($1,$2,'care_records','notice_acknowledgement','v1','acknowledged',$3)", [org, gu!.id, g.id]);
    expect(await notice(g, clinicA)).toMatchObject({ acknowledged: false });
  });

  it("the backfill binds a pre-fix acknowledgement to the clinic its command receipt proves, and only that clinic", async () => {
    const g = await newUser("privacy-backfill");
    const [gu] = await admin<{ id: string }>("insert into public.guardians (organization_id, profile_id, full_name) values ($1,$2,'Backfill') returning id", [org, g.id]);
    const key = op();
    // Exactly what 0022's acknowledge_clinic_privacy_notice wrote: a receipt and a record in one transaction (same now()).
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into private.command_receipts (organization_id, operation_key, actor_id, command_type, payload_hash, status, result, completed_at)
        values ($1,$2,$3,'privacy.acknowledge_clinic', encode(sha256(convert_to(jsonb_build_object('c', $4::uuid, 'v', 'v1')::text, 'UTF8')), 'hex'), 'completed', '{}'::jsonb, now())`, [org, key, g.id, clinicA]);
      await client.query("insert into public.privacy_records (organization_id, guardian_id, purpose, record_type, notice_version, decision, created_by) values ($1,$2,'care_records','notice_acknowledgement','v1','acknowledged',$3)", [org, gu!.id, g.id]);
      await client.query("commit");
    } finally {
      client.release();
    }
    expect(await notice(g, clinicA)).toMatchObject({ acknowledged: false });
    await admin("select private.backfill_privacy_acknowledgements()");
    expect(await notice(g, clinicA)).toMatchObject({ acknowledged: true });
    expect(await notice(g, clinicB)).toMatchObject({ acknowledged: false });
  });
});

describe("DB-04: clinic-scoped staff see only their clinic's children in lot traces and audit search (reversible default)", () => {
  let otherKid: string, ownKid: string, lot: string;
  beforeAll(async () => {
    otherKid = await staffChild("Other Clinic Kid", 120, w.otherClinic, w.otherClinicStaff);
    ownKid = await staffChild("Own Clinic Kid", 120);
    lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'DB04-LOT',$4) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], T(300)])))[0]!.r.lotId as string;
    for (const [kid, clinic, by] of [[otherKid, w.otherClinic, w.otherClinicStaff.id], [ownKid, w.clinic, w.clinician.id]] as const) {
      const [ev] = await admin<{ id: string }>("insert into public.vaccination_events (organization_id, original_child_id, origin) values ($1,$2,'clinic_administered') returning id", [w.org, kid]);
      await admin(`insert into public.vaccination_revisions (organization_id,event_id,revision_no,child_id,product_id,lot_id,administered_on,date_precision,source,verification_status,administered_by,clinic_id)
        values ($1,$2,1,$3,$4,$5,$6,'exact','clinic_administered','verified',$7,$8)`, [w.org, ev!.id, kid, w.products["DEMO-P-ALPHA"], lot, T(-1), by, clinic]);
    }
  });

  it("trace_lot_use names only this clinic's children and counts other clinics' uses", async () => {
    const trace = (await as(w.lead, (q) => q<Rows<Record<string, unknown>[]>>("select public.trace_lot_use($1,$2) as r", [w.clinic, lot])))[0]!.r;
    expect(trace.filter((t) => t.childId).map((t) => t.childId)).toEqual([ownKid]);
    expect(JSON.stringify(trace)).not.toContain("Other Clinic Kid");
    expect(trace.find((t) => t.scope === "other_clinic")).toMatchObject({ clinicId: w.otherClinic, records: 1 });
  });

  it("search_audit returns only rows tied to this clinic; new rows record their clinic", async () => {
    const search = (clinic: string, a: Actor) => as(a, (q) => q<Rows<{ rows: { entityId: string; action: string }[] }>>("select public.search_audit($1,null,null,null,null,null,100) as r", [clinic])).then((x) => x[0]!.r.rows);
    const rowsA = await search(w.clinic, w.lead);
    expect(rowsA.some((x) => x.entityId === otherKid)).toBe(false);
    expect(rowsA.some((x) => x.entityId === ownKid)).toBe(true);
    expect((await search(w.otherClinic, w.otherClinicStaff)).some((x) => x.entityId === otherKid)).toBe(true);
    expect(await admin("select clinic_id from private.audit_logs where action = 'child.registered' and entity_id = $1", [otherKid])).toEqual([{ clinic_id: w.otherClinic }]);
    // Rows written without a clinic (before this change, or by families): resolved through the entity, otherwise hidden.
    const legacy = async (type: string, id: string) => (await admin<{ id: string }>(
      "insert into private.audit_logs (organization_id, actor_id, action, entity_type, entity_id, request_id, outcome) values ($1,$2,'zz.legacy',$3,$4,gen_random_uuid(),'success') returning id", [w.org, w.lead.id, type, id]))[0]!.id;
    const own = await legacy("child", ownKid), other = await legacy("child", otherKid), orgWide = await legacy("guardian", ownKid), clinicRow = await legacy("clinic", w.clinic);
    const ids = (await as(w.lead, (q) => q<Rows<{ rows: { id: string }[] }>>("select public.search_audit($1,'zz.legacy',null,null,null,null,100) as r", [w.clinic])))[0]!.r.rows.map((x) => x.id);
    expect(ids.sort()).toEqual([own, clinicRow].sort());
    expect(ids).not.toContain(other);
    expect(ids).not.toContain(orgWide);
  });
});

describe("DB-05: commands never leave an in-progress receipt behind", () => {
  it("the five child commands raise CV404 for a child outside the clinic and keep no receipt", async () => {
    const stranger = await staffChild("Stranger Kid", 90, w.otherClinic, w.otherClinicStaff);
    const calls: [Actor, string, unknown[]][] = [
      [w.lead, "select public.issue_certificate($1,$2,$3,null)", [w.clinic, stranger]],
      [w.clinician, "select public.save_catchup_draft($1,$2,$3,null,'a long enough rationale','ref','[]'::jsonb)", [w.clinic, stranger]],
      [w.clinician, "select public.place_clinical_hold($1,$2,$3,'reason here',null,null,null)", [w.clinic, stranger]],
      [w.lead, "select public.log_followup_attempt($1,$2,$3,'reached')", [w.clinic, stranger]],
      [w.lead, "select public.initiate_record_transfer_out($1,$2,$3,$4)", [w.clinic, stranger, w.otherClinic]],
    ];
    for (const [actor, sql, args] of calls) {
      const key = op();
      for (let i = 0; i < 2; i++) await expectCode(as(actor, (q) => q(sql, [key, ...args])), "CV404");
      expect(await admin("select 1 from private.command_receipts where operation_key = $1", [key]), sql).toHaveLength(0);
    }
  });

  it("no receipt anywhere in the database is still in progress (covers every file that ran before this one)", async () => {
    expect(await admin("select command_type, count(*)::int n from private.command_receipts where status <> 'completed' group by 1")).toEqual([]);
  });
});

describe("DB-06: audit search has an index and a gap-free keyset", () => {
  it("indexes organization + time, and pages through identical timestamps without skipping rows", async () => {
    const idx = await admin<{ indexdef: string }>("select indexdef from pg_indexes where schemaname = 'private' and tablename = 'audit_logs'");
    expect(idx.some((i) => /\(organization_id, server_time DESC, id DESC\)/.test(i.indexdef))).toBe(true);
    const ids = (await admin<{ id: string }>(
      `insert into private.audit_logs (organization_id, clinic_id, actor_id, action, entity_type, entity_id, request_id, outcome, server_time)
       select $1, $2, $3, 'zz.keyset', 'clinic', $2, gen_random_uuid(), 'success', timestamptz '2026-01-01 00:00:00+00' from generate_series(1,3) returning id`, [w.org, w.clinic, w.lead.id])).map((x) => x.id);
    type Page = { rows: { id: string }[]; nextBefore: string | null; nextBeforeId: string | null };
    const page = (before: string | null, beforeId: string | null) =>
      as(w.lead, (q) => q<Rows<Page>>("select public.search_audit($1,'zz.keyset',null,null,null,$2,2,$3) as r", [w.clinic, before, beforeId])).then((x) => x[0]!.r);
    const p1 = await page(null, null);
    expect(p1.rows).toHaveLength(2);
    expect(p1.nextBefore && p1.nextBeforeId).toBeTruthy();
    const p2 = await page(p1.nextBefore, p1.nextBeforeId);
    expect([...p1.rows, ...p2.rows].map((x) => x.id).sort()).toEqual(ids.sort());
    // The original seven-argument call still works.
    const old = (await as(w.lead, (q) => q<Rows<Page>>("select public.search_audit($1,'zz.keyset',null,null,null,null,50) as r", [w.clinic])))[0]!.r;
    expect(old.rows).toHaveLength(3);
  });
});

describe("SUP-02: operator-only bootstrap of the first organization, clinic and two staff", () => {
  it("is executable by no API role", async () => {
    for (const role of ["anon", "authenticated", "service_role", "public"]) {
      const sql = role === "public"
        ? "select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'private.bootstrap_initial_staff(text,text,text,text,text)'::regprocedure and a.grantee = 0) as x"
        : `select has_function_privilege('${role}', 'private.bootstrap_initial_staff(text,text,text,text,text)', 'execute') as x`;
      expect((await admin<{ x: boolean }>(sql))[0]!.x, role).toBe(false);
    }
  });

  it("on a database with no live staff creates one org, one clinic and two mutually approved memberships, audited, exactly once", async () => {
    const client = await pool.connect();
    const q = async <T,>(sql: string, p: unknown[] = []) => (await client.query(sql, p)).rows as T[];
    try {
      await client.query("begin");
      await q("update public.staff_memberships set status = 'revoked' where status in ('active','pending_approval')");
      const users = ["boot-admin", "boot-lead"].map((l) => `${l}-${op().slice(0, 8)}@example.test`);
      for (const e of users) await q("insert into auth.users (id, email) values (gen_random_uuid(), $1)", [e]);
      await q("savepoint s");
      await expectCode(q("select private.bootstrap_initial_staff('Org','Clinic','Asia/Manila',$1,$1)", [users[0]]), "CV422");
      await q("rollback to savepoint s");
      const [{ r }] = await q<{ r: { organizationId: string; clinicId: string } }>("select private.bootstrap_initial_staff(' First Org ',' First Clinic ','Asia/Manila',$1,$2) as r", [users[0], users[1]!.toUpperCase()]);
      expect(await q("select name from public.organizations where id = $1", [r.organizationId])).toEqual([{ name: "First Org" }]);
      expect(await q("select name, timezone from public.clinics where id = $1", [r.clinicId])).toEqual([{ name: "First Clinic", timezone: "Asia/Manila" }]);
      const m = await q<{ role_code: string; email: string; approver: string; status: string }>(
        `select m.role_code, u.email, a.email approver, m.status from public.staff_memberships m join auth.users u on u.id = m.profile_id join auth.users a on a.id = m.approved_by
          where m.clinic_id = $1 order by m.role_code`, [r.clinicId]);
      expect(m).toEqual([
        { role_code: "clinical_lead", email: users[1], approver: users[0], status: "active" },
        { role_code: "tech_admin", email: users[0], approver: users[1], status: "active" },
      ]);
      expect(await q("select system_job_id from private.audit_logs where action = 'staff.bootstrap' and entity_id = $1", [r.clinicId])).toEqual([{ system_job_id: "system" }]);
      await expectCode(q("select private.bootstrap_initial_staff('Again','Again','Asia/Manila',$1,$2)", [users[0], users[1]]), "CV409");
    } finally {
      await client.query("rollback");
      client.release();
    }
  });
});
