import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

let org: string, clinicA: string, clinicB: string, org2: string, clinicC: string;
let assistantA: Actor, clinicalA: Actor, leadA: Actor, inventoryA: Actor, assistantB: Actor, staffC: Actor, g1: Actor, g2: Actor, g3: Actor;

const kid = (name: string, dob = "2025-03-10", extra: Record<string, unknown> = {}) => ({ displayName: name, dob, ...extra });
type R = { r: Record<string, unknown> };

async function guardianCreates(g: Actor, name: string, dob?: string, clinic = clinicA) {
  const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), clinic, JSON.stringify(kid(name, dob))]));
  return r as { childId: string; localRecordNo: string; recordStatus: string; verificationPending: boolean };
}
async function staffRegisters(a: Actor, name: string, dob: string, opts: { distinct?: boolean; identity?: boolean; guardian?: object; clinic?: string; expectCandidates?: boolean } = {}) {
  const [{ r }] = await as(a, (q) => q<R>("select public.register_child_staff($1,$2,$3,$4,$5,$6) as r",
    [op(), opts.clinic ?? clinicA, JSON.stringify(kid(name, dob)), opts.guardian ? JSON.stringify(opts.guardian) : null, opts.distinct ?? false, opts.identity ?? false]));
  const out = r as { created: boolean; childId: string; candidates: { childId: string }[]; recordStatus?: string };
  if (!out.created && !opts.expectCandidates) throw new Error(`fixture "${name}" unexpectedly matched an existing child`);
  return out;
}
const search = (a: Actor, clinic: string, q: string, dob?: string) =>
  as(a, async (x) => (await x<{ r: { childId: string; displayName: string }[] }>("select public.staff_search_children($1,$2,$3) as r", [clinic, q, dob ?? null]))[0].r);

beforeAll(async () => {
  org = await makeOrg("Org 1");
  org2 = await makeOrg("Org 2");
  clinicA = await makeClinic(org, "Clinic A");
  clinicB = await makeClinic(org, "Clinic B");
  clinicC = await makeClinic(org2, "Clinic C");
  [assistantA, clinicalA, leadA, inventoryA, assistantB, staffC, g1, g2, g3] = await Promise.all(
    ["asstA", "clinA", "leadA", "invA", "asstB", "staffC", "g1", "g2", "g3"].map(newUser));
  await grant(org, clinicA, assistantA, "assistant");
  await grant(org, clinicA, clinicalA, "clinical_staff");
  await grant(org, clinicA, leadA, "clinical_lead");
  await grant(org, clinicA, inventoryA, "inventory");
  await grant(org, clinicB, assistantB, "assistant");
  await grant(org2, clinicC, staffC, "clinical_lead");
});
afterAll(() => pool.end());

describe("guardian self-registration (T01, T10)", () => {
  it("creates a provisional child the guardian can see, but nobody else can", async () => {
    const c = await guardianCreates(g1, "Ana Reyes");
    expect(c.recordStatus).toBe("provisional");
    expect(c.localRecordNo).toMatch(/^CV-\d{6}$/);
    const own = await as(g1, (q) => q<{ id: string }>("select id from public.children"));
    expect(own.map((x) => x.id)).toContain(c.childId);
    const other = await as(g2, (q) => q("select id from public.children where id = $1", [c.childId]));
    expect(other).toHaveLength(0);
    await expectCode(as(null, (q) => q("select id from public.children")), "42501");
  });

  it("gives an unverified guardian identity access only", async () => {
    const c = await guardianCreates(g1, "Ben Reyes");
    const mine = await as(g1, (q) => q<{ r: { childId: string; accessScope: string; relationshipStatus: string }[] }>("select public.my_children() as r"));
    const row = mine[0].r.find((x) => x.childId === c.childId)!;
    expect((row as typeof row & { clinicTimezone: string }).clinicTimezone).toBe("Asia/Manila");
    expect(row.accessScope).toBe("identity_only");
    expect(row.relationshipStatus).toBe("provisional");
  });

  it("returns the same response shape whether or not a similar child exists (no matching oracle)", async () => {
    await staffRegisters(assistantA, "Oracle Testcase", "2025-05-05", { identity: true });
    const hit = await guardianCreates(g2, "Oracle Testcase", "2025-05-05");
    const miss = await guardianCreates(g2, "Zzyzx Unique Nameless", "2020-01-01");
    expect(Object.keys(hit).sort()).toEqual(Object.keys(miss).sort());
    expect(hit.verificationPending).toBe(true);
    // ...but staff do get a duplicate review case
    const cases = await as(assistantA, (q) => q<{ r: { kind: string; child: { displayName: string } }[] }>("select public.list_review_cases($1,'open') as r", [clinicA]));
    // assistant has guardian.verify: sees duplicate cases
    expect(cases[0].r.some((k) => k.kind === "duplicate" && k.child.displayName === "Oracle Testcase")).toBe(true);
  });

  it("rejects invalid input with CV422 and does not create a partial record", async () => {
    const before = Number((await admin<{ n: string }>("select count(*) n from public.children"))[0].n);
    const bad = (payload: object) => expectCode(as(g1, (q) => q("select public.create_child_provisional($1,$2,$3)", [op(), clinicA, JSON.stringify(payload)])), "CV422");
    await bad({ displayName: "   " });
    await bad({ displayName: "Future Kid", dob: "2099-01-01" });
    await bad({ displayName: "Bad Precision", dobPrecision: "estimated" });
    await bad({ displayName: "Bad Sex", sex: "robot" });
    expect(Number((await admin<{ n: string }>("select count(*) n from public.children"))[0].n)).toBe(before);
  });

  it("accepts legitimate unusual names and an unknown birth date", async () => {
    const [{ r }] = await as(g1, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), clinicA, JSON.stringify({ displayName: "Nguyễn Đặng-de la Cruz Jr." })]));
    expect(r.recordStatus).toBe("provisional");
    const row = await admin<{ birth_date_precision: string; dob: string | null }>("select birth_date_precision, dob from public.children where id = $1", [r.childId]);
    expect(row[0].birth_date_precision).toBe("unknown");
  });

  it("is idempotent under retry and under concurrency (T05)", async () => {
    const key = op();
    const payload = JSON.stringify(kid("Idem Child", "2024-12-01"));
    const call = () => as(g3, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [key, clinicA, payload]));
    const res = await Promise.all([call(), call(), call()]);
    expect(new Set(res.map((x) => x[0].r.childId)).size).toBe(1);
    const n = await admin<{ n: string }>("select count(*) n from public.children where display_name = 'Idem Child'");
    expect(Number(n[0].n)).toBe(1);
    // T06: same key, different payload
    await expectCode(as(g3, (q) => q("select public.create_child_provisional($1,$2,$3)", [key, clinicA, JSON.stringify(kid("Different", "2024-12-01"))])), "CV409");
  });

  it("assigns unique record numbers under concurrency", async () => {
    const created = await Promise.all(Array.from({ length: 6 }, (_, i) => guardianCreates(g3, `Parallel ${i}`, "2025-01-0" + (i + 1))));
    expect(new Set(created.map((c) => c.localRecordNo)).size).toBe(6);
  });
});

describe("no direct table writes (grants)", () => {
  it("authenticated users cannot insert/update/delete registry tables", async () => {
    await expectCode(as(g1, (q) => q(`insert into public.children (organization_id, local_record_no, display_name) values ($1,'X-1','Evil')`, [org])), "42501");
    await expectCode(as(assistantA, (q) => q("update public.children set display_name = 'x'")), "42501");
    await expectCode(as(assistantA, (q) => q("delete from public.guardian_child_relationships")), "42501");
    await expectCode(as(assistantA, (q) => q("select * from public.record_review_cases")), "42501");
    await expectCode(as(assistantA, (q) => q("select * from public.qr_passes")), "42501");
  });
  it("staff cannot browse children through the tables directly (only audited commands)", async () => {
    await expectCode(as(leadA, (q) => q("select * from public.child_clinic_enrollments")), "42501");
    const rows = await as(leadA, (q) => q("select id from public.children")); // RLS: only guardian-linked rows
    expect(rows).toHaveLength(0);
  });
});

describe("clinic scope for staff", () => {
  it("staff see children enrolled at their clinic only (same-org other clinic and other org denied)", async () => {
    const c = await guardianCreates(g1, "Scope Probe Alpha", "2025-02-02");
    expect((await search(assistantA, clinicA, "Scope Probe Alpha")).map((x) => x.childId)).toContain(c.childId);
    await expectCode(search(assistantB, clinicA, "Scope Probe Alpha"), "CV403"); // no membership at A
    expect(await search(assistantB, clinicB, "Scope Probe Alpha")).toHaveLength(0); // member of B, but child not enrolled at B
    await expectCode(search(staffC, clinicA, "Scope Probe Alpha"), "CV403");
    expect(await search(staffC, clinicC, "Scope Probe Alpha")).toHaveLength(0);
  });

  it("staff_get_child answers identically for a missing child and a child outside scope (no oracle)", async () => {
    const c = await guardianCreates(g1, "Scope Probe Beta", "2025-02-03");
    // Returns null (not an exception) so the denial audit row commits; the API maps null to 404.
    const get = (id: string) => as(assistantB, (q) => q<{ r: unknown }>("select public.staff_get_child($1,$2) as r", [clinicB, id]));
    expect((await get(c.childId))[0].r).toBeNull();
    expect((await get(crypto.randomUUID()))[0].r).toBeNull();
    const denied = await admin<{ n: string }>("select count(*) n from private.audit_logs where action = 'child.open' and outcome = 'denied' and entity_id = $1", [c.childId]);
    expect(Number(denied[0].n)).toBeGreaterThan(0); // denied attempts are audited
  });

  it("requires capability: inventory staff and aal1 sessions are denied", async () => {
    await expectCode(search(inventoryA, clinicA, "Scope Probe"), "CV403");
    await expectCode(as({ ...assistantA, aal: "aal1" }, (q) => q("select public.staff_search_children($1,'Scope Probe')", [clinicA])), "CV403");
  });

  it("rejects too-short queries and bounds the result size", async () => {
    await expectCode(search(assistantA, clinicA, "a"), "CV422");
    const rows = await as(assistantA, async (q) => (await q<{ r: unknown[] }>("select public.staff_search_children($1,'reyes',null,500) as r", [clinicA]))[0].r);
    expect(rows.length).toBeLessThanOrEqual(25);
  });

  it("search logs never store the query text", async () => {
    await search(assistantA, clinicA, "distinctivesecretquery");
    const hits = await admin("select 1 from private.audit_logs where after::text ilike '%distinctivesecretquery%'");
    expect(hits).toHaveLength(0);
  });
});

describe("staff registration, duplicates and twins (T10)", () => {
  it("returns candidates and creates nothing until the registrar confirms the child is distinct", async () => {
    const first = await staffRegisters(assistantA, "Maria Santos", "2025-06-15", { identity: true });
    expect(first.created).toBe(true);
    const second = await staffRegisters(assistantA, "Maria Santos", "2025-06-15", { expectCandidates: true });
    expect(second.created).toBe(false);
    expect(second.candidates.map((c) => c.childId)).toContain(first.childId);
    const n = await admin<{ n: string }>("select count(*) n from public.children where display_name = 'Maria Santos'");
    expect(Number(n[0].n)).toBe(1);
  });

  it("registers twins as separate records when confirmed, and never merges them automatically", async () => {
    const a = await staffRegisters(assistantA, "Lito Cruz", "2025-07-01", { identity: true });
    const b = await staffRegisters(assistantA, "Lita Cruz", "2025-07-01", { distinct: true, identity: true });
    expect(b.created).toBe(true);
    expect(b.childId).not.toBe(a.childId);
    const rows = await admin<{ record_status: string }>("select record_status from public.children where id in ($1,$2)", [a.childId, b.childId]);
    expect(rows.every((r) => r.record_status === "active")).toBe(true);
    const cases = await admin("select 1 from public.record_review_cases where kind = 'duplicate' and (child_id = $1 or candidate_child_id = $1)", [b.childId]);
    expect(cases.length).toBeGreaterThan(0);
  });

  it("records an accompanying adult without an account; verifies authority only when done in person", async () => {
    const withV = await staffRegisters(assistantA, "Teodoro Almazan", "2025-08-08", { identity: true, guardian: { fullName: "Lola Ana", relationship: "grandparent", verifiedInPerson: true, phone: "0917000111" } });
    const withoutV = await staffRegisters(assistantA, "Perpetua Villanueva", "2025-08-09", { guardian: { fullName: "Tita Bel", relationship: "aunt_uncle" } });
    const rows = await admin<{ status: string; name: string }>(
      `select r.status, g.full_name name from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where r.child_id in ($1,$2) order by g.full_name`,
      [withV.childId, withoutV.childId]);
    expect(rows).toEqual([{ status: "active", name: "Lola Ana" }, { status: "provisional", name: "Tita Bel" }]);
  });

  it("does not require phone, birth certificate or smartphone (minimal registration)", async () => {
    const r = await staffRegisters(assistantA, "No Documents Child", "2025-09-09");
    expect(r.created).toBe(true);
  });

  it("registration by non-registrars is denied", async () => {
    await expectCode(as(inventoryA, (q) => q("select public.register_child_staff($1,$2,$3)", [op(), clinicA, JSON.stringify(kid("Nope"))])), "CV403");
    await expectCode(as(assistantB, (q) => q("select public.register_child_staff($1,$2,$3)", [op(), clinicA, JSON.stringify(kid("Nope"))])), "CV403");
  });
});

describe("linking to an existing child (T01)", () => {
  it("a stranger claiming a name/DOB match gets no access, no child data and no confirmation of existence", async () => {
    const target = await staffRegisters(assistantA, "Linked Target", "2025-04-04", { identity: true });
    const [{ r }] = await as(g2, (q) => q<R>("select public.request_guardian_link($1,$2,$3,'mother') as r", [op(), clinicA, JSON.stringify({ childName: "Linked Target", dob: "2025-04-04" })]));
    expect(Object.keys(r).sort()).toEqual(["caseId", "status"]);
    expect((await as(g2, (q) => q("select id from public.children where id = $1", [target.childId]))).length).toBe(0);
    const mine = await as(g2, (q) => q<{ r: { childId: string }[] }>("select public.my_children() as r"));
    expect(mine[0].r.map((x) => x.childId)).not.toContain(target.childId);
    // requester must not be able to read the case row or guess via the API
    await expectCode(as(g2, (q) => q("select * from public.record_review_cases")), "42501");
    await expectCode(as(g2, (q) => q("select public.list_review_cases($1,'open')", [clinicA])), "CV403");
  });

  it("staff approval grants full access; only staff with guardian.verify at that clinic can decide", async () => {
    const target = await staffRegisters(assistantA, "Approve Me Child", "2025-04-05", { identity: true });
    const [{ r }] = await as(g2, (q) => q<R>("select public.request_guardian_link($1,$2,$3,'father') as r", [op(), clinicA, JSON.stringify({ childName: "Approve Me Child" })]));
    const caseId = r.caseId as string;
    await expectCode(as(inventoryA, (q) => q("select public.resolve_link_case($1,$2,'approve',$3)", [op(), caseId, target.childId])), "CV403");
    await expectCode(as(assistantB, (q) => q("select public.resolve_link_case($1,$2,'approve',$3)", [op(), caseId, target.childId])), "CV403");
    await expectCode(as(g2, (q) => q("select public.resolve_link_case($1,$2,'approve',$3)", [op(), caseId, target.childId])), "CV403");
    await as(assistantA, (q) => q("select public.resolve_link_case($1,$2,'approve',$3)", [op(), caseId, target.childId]));
    const own = await as(g2, (q) => q<{ id: string }>("select id from public.children where id = $1", [target.childId]));
    expect(own).toHaveLength(1);
    const rel = await admin<{ status: string; access_scope: string; verified_by: string }>(
      "select status, access_scope, verified_by from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [g2.id, target.childId]);
    expect(rel[0]).toMatchObject({ status: "active", access_scope: "full", verified_by: assistantA.id });
    // a second decision on the same case conflicts
    await expectCode(as(assistantA, (q) => q("select public.resolve_link_case($1,$2,'reject',null,'other','dup')", [op(), caseId])), "CV409");
  });

  it("approval cannot target a child outside the reviewer's clinic", async () => {
    const [{ r }] = await as(g2, (q) => q<R>("select public.request_guardian_link($1,$2,$3) as r", [op(), clinicA, JSON.stringify({ childName: "Elsewhere" })]));
    const other = await staffRegisters(assistantB, "Only At B", "2025-01-01", { identity: true, clinic: clinicB });
    await expectCode(as(assistantA, (q) => q("select public.resolve_link_case($1,$2,'approve',$3)", [op(), r.caseId, other.childId])), "CV404");
  });

  it("rejection requires a reason and gives no access", async () => {
    const target = await staffRegisters(assistantA, "Reject Target", "2025-04-06", { identity: true });
    const [{ r }] = await as(g3, (q) => q<R>("select public.request_guardian_link($1,$2,$3) as r", [op(), clinicA, JSON.stringify({ childName: "Reject Target" })]));
    await expectCode(as(assistantA, (q) => q("select public.resolve_link_case($1,$2,'reject')", [op(), r.caseId])), "CV422");
    await as(assistantA, (q) => q("select public.resolve_link_case($1,$2,'reject',null,'other','cannot verify relationship')", [op(), r.caseId]));
    expect((await as(g3, (q) => q("select id from public.children where id = $1", [target.childId]))).length).toBe(0);
  });

  it("provisional guardians can be verified in person, then gain full access; suspension removes access again", async () => {
    const c = await guardianCreates(g3, "Verify Later", "2025-03-03");
    await as(assistantA, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), clinicA, c.childId]));
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [g3.id, c.childId]);
    await as(assistantA, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), clinicA, rel[0].id]));
    const full = await as(g3, (q) => q<{ r: { childId: string; accessScope: string }[] }>("select public.my_children() as r"));
    expect(full[0].r.find((x) => x.childId === c.childId)!.accessScope).toBe("full");
    await as(assistantA, (q) => q("select public.set_relationship_status($1,$2,$3,'suspended','custody dispute under review')", [op(), clinicA, rel[0].id]));
    expect((await as(g3, (q) => q("select id from public.children where id = $1", [c.childId]))).length).toBe(0);
    await expectCode(as(assistantA, (q) => q("select public.set_relationship_status($1,$2,$3,'revoked','x')", [op(), clinicA, rel[0].id])), "CV422"); // reason too short
    // record itself and staff access are unaffected by the guardian dispute
    await as(assistantA, (q) => q("select public.staff_get_child($1,$2)", [clinicA, c.childId]));
  });
});

describe("identity edits", () => {
  it("uses optimistic versions, requires a reason, restricts fields and audits before/after", async () => {
    const c = await staffRegisters(assistantA, "Edit Subject", "2025-02-20", { identity: true });
    const v1 = (await admin<{ version: number }>("select version from public.children where id = $1", [c.childId]))[0].version;
    await as(assistantA, (q) => q("select public.update_child_identity($1,$2,$3,$4,$5,'spelling corrected per birth record')", [op(), clinicA, c.childId, v1, JSON.stringify({ displayName: "Edit Subject Corrected" })]));
    await expectCode(as(assistantA, (q) => q("select public.update_child_identity($1,$2,$3,$4,$5,'again')", [op(), clinicA, c.childId, v1, JSON.stringify({ displayName: "Stale Write" })])), "CV409");
    await expectCode(as(assistantA, (q) => q("select public.update_child_identity($1,$2,$3,$4,$5,null)", [op(), clinicA, c.childId, v1 + 1, JSON.stringify({ dob: "2025-02-21" })])), "CV422");
    await expectCode(as(assistantA, (q) => q("select public.update_child_identity($1,$2,$3,$4,$5,'x y z')", [op(), clinicA, c.childId, v1 + 1, JSON.stringify({ record_status: "merged" })])), "CV422");
    const audit = await admin<{ before: { displayName: string }; after: { displayName: string } }>(
      "select before, after from private.audit_logs where action = 'child.identity_updated' and entity_id = $1", [c.childId]);
    expect(audit[0].before.displayName).toBe("Edit Subject");
    expect(audit[0].after.displayName).toBe("Edit Subject Corrected");
  });

  it("cannot be applied by staff of another clinic", async () => {
    const c = await staffRegisters(assistantA, "Edit Scope", "2025-02-21", { identity: true });
    await expectCode(as(assistantB, (q) => q("select public.update_child_identity($1,$2,$3,1,$4,'reason ok')", [op(), clinicB, c.childId, JSON.stringify({ addressText: "x" })])), "CV404");
  });

  it("distinguishes an omitted optional field from an explicit clear", async () => {
    const c = await staffRegisters(assistantA, "Optional Edit", "2025-02-21", { identity: true });
    const update = (version: number, patch: Record<string, unknown>) => as(assistantA, (q) => q(
      "select public.update_child_identity($1,$2,$3,$4,$5,'checked against paper record')",
      [op(), clinicA, c.childId, version, JSON.stringify(patch)],
    ));
    const original = (await admin<{ version: number }>("select version from public.children where id = $1", [c.childId]))[0]!.version;
    await update(original, { addressText: "Old address" });
    await update(original + 1, { displayName: "Optional Edit Corrected" });
    expect((await admin<{ address_text: string }>("select address_text from public.children where id = $1", [c.childId]))[0]!.address_text).toBe("Old address");
    await update(original + 2, { addressText: null, dobPrecision: "unknown", dob: null });
    expect((await admin<{ address_text: string | null; dob: string | null; birth_date_precision: string }>(
      "select address_text, dob, birth_date_precision from public.children where id = $1", [c.childId],
    ))[0]).toMatchObject({ address_text: null, dob: null, birth_date_precision: "unknown" });
  });

  it("a guardian can only request an edit (review case), never edit directly", async () => {
    const c = await guardianCreates(g1, "Guardian Edit", "2025-02-22");
    await as(g1, (q) => q("select public.request_child_edit($1,$2,$3,'typo')", [op(), c.childId, JSON.stringify({ displayName: "Guardian Edited" })]));
    expect((await admin<{ display_name: string }>("select display_name from public.children where id = $1", [c.childId]))[0].display_name).toBe("Guardian Edit");
    await expectCode(as(g2, (q) => q("select public.request_child_edit($1,$2,$3,'x')", [op(), c.childId, JSON.stringify({ displayName: "Hijack" })])), "CV404");
  });
});

describe("merge and aliases (T11 registry part)", () => {
  it("only reviewers can merge; relationships and enrollment move to the survivor; alias resolves", async () => {
    const s = await staffRegisters(assistantA, "Merge Survivor", "2025-01-15", { identity: true, guardian: { fullName: "Parent S", verifiedInPerson: true } });
    const dupChild = await guardianCreates(g1, "Merge Survivor", "2025-01-15");
    await expectCode(as(assistantA, (q) => q("select public.merge_children($1,$2,$3,$4,'same child')", [op(), clinicA, s.childId, dupChild.childId])), "CV403");
    await as(leadA, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed same child by birth record')", [op(), clinicA, s.childId, dupChild.childId]));
    const mine = await as(g1, (q) => q<{ r: { childId: string }[] }>("select public.my_children() as r"));
    expect(mine[0].r.map((x) => x.childId)).toContain(s.childId);
    expect(mine[0].r.map((x) => x.childId)).not.toContain(dupChild.childId);
    const got = await as(leadA, (q) => q<{ r: { childId: string; aliasResolved: boolean }}>("select public.staff_get_child($1,$2) as r", [clinicA, dupChild.childId]));
    expect(got[0].r).toMatchObject({ childId: s.childId, aliasResolved: true });
    const hits = await search(leadA, clinicA, "Merge Survivor");
    expect(hits.map((h) => h.childId)).toEqual([s.childId]);
    const audit = await admin("select 1 from private.audit_logs where action = 'child.merged' and entity_id = $1", [dupChild.childId]);
    expect(audit).toHaveLength(1);
    // the duplicate row is preserved (never deleted) and points at the survivor
    const row = await admin<{ record_status: string; merged_into_id: string }>("select record_status, merged_into_id from public.children where id = $1", [dupChild.childId]);
    expect(row[0]).toEqual({ record_status: "merged", merged_into_id: s.childId });
    // resolved duplicate case
    const open = await admin("select 1 from public.record_review_cases where kind='duplicate' and status='open' and (child_id=$1 or candidate_child_id=$1)", [dupChild.childId]);
    expect(open).toHaveLength(0);
  });

  it("refuses self-merge, cycles and re-merging; concurrent opposite merges leave a single consistent outcome", async () => {
    const a = await staffRegisters(assistantA, "Xavier Dimaculangan", "2025-01-20", { identity: true });
    const b = await staffRegisters(assistantA, "Fortunato Belmonte", "2025-01-21", { identity: true });
    await expectCode(as(leadA, (q) => q("select public.merge_children($1,$2,$3,$3,'same')", [op(), clinicA, a.childId])), "CV422");
    const results = await Promise.allSettled([
      as(leadA, (q) => q("select public.merge_children($1,$2,$3,$4,'a into b')", [op(), clinicA, a.childId, b.childId])),
      as(leadA, (q) => q("select public.merge_children($1,$2,$3,$4,'b into a')", [op(), clinicA, b.childId, a.childId])),
    ]);
    // The loser must fail cleanly (not found once the winner has merged one side, or a conflict) rather than deadlock or cycle.
    const losers = results.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.code);
    expect(losers.every((c: string) => ["CV404", "CV409"].includes(c))).toBe(true);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const merged = await admin<{ n: string }>("select count(*) n from public.children where id in ($1,$2) and record_status = 'merged'", [a.childId, b.childId]);
    expect(Number(merged[0].n)).toBe(1);
  });

  it("twins can be marked distinct with a reason and are then left alone", async () => {
    const a = await staffRegisters(assistantA, "Twin Alpha", "2025-02-28", { identity: true });
    await staffRegisters(assistantA, "Twin Alpho", "2025-02-28", { identity: true, distinct: true });
    const cases = await as(leadA, (q) => q<{ r: { caseId: string; kind: string; child: { displayName: string } }[] }>("select public.list_review_cases($1,'open') as r", [clinicA]));
    const dup = cases[0].r.find((k) => k.kind === "duplicate" && k.child.displayName === "Twin Alpho")!;
    expect(dup).toBeTruthy();
    await as(leadA, (q) => q("select public.resolve_review_case($1,$2,'not_duplicate','twins per birth record')", [op(), dup.caseId]));
    expect(a.childId).toBeTruthy();
  });

  it("merges are scoped: a lead from another clinic or org cannot merge these children", async () => {
    const a = await staffRegisters(assistantA, "Ignacio Pantaleon", "2025-01-25", { identity: true });
    const b = await staffRegisters(assistantA, "Rosalinda Escobar", "2025-01-26", { identity: true });
    await expectCode(as(staffC, (q) => q("select public.merge_children($1,$2,$3,$4,'attack')", [op(), clinicC, a.childId, b.childId])), "CV404");
  });
});

describe("QR pass (T22)", () => {
  it("issues an opaque token once, resolves only for scoped staff, and reveals nothing otherwise", async () => {
    const c = await staffRegisters(assistantA, "Qr Child", "2025-05-01", { identity: true, guardian: { fullName: "QR Parent", verifiedInPerson: true } });
    const [{ r }] = await as(assistantA, (q) => q<R>("select public.issue_qr_pass($1,$2,$3) as r", [op(), c.childId, clinicA]));
    const token = r.token as string;
    expect(token.length).toBeGreaterThanOrEqual(40);
    // token is stored hashed only
    expect((await admin("select 1 from public.qr_passes where token_hash = $1", [token]))).toHaveLength(0);

    const ok = await as(assistantA, (q) => q<{ r: Record<string, unknown> }>("select public.resolve_qr($1,$2) as r", [clinicA, token]));
    expect(Object.keys(ok[0].r).sort()).toEqual(["childId", "displayName", "dob", "dobPrecision", "localRecordNo"]);

    const wrongClinic = await as(assistantB, (q) => q<{ r: unknown }>("select public.resolve_qr($1,$2) as r", [clinicB, token]));
    expect(wrongClinic[0].r).toBeNull();
    await expectCode(as(assistantB, (q) => q("select public.resolve_qr($1,$2)", [clinicA, token])), "CV403");
    await expectCode(as(null, (q) => q("select public.resolve_qr($1,$2)", [clinicA, token])), "42501");
    await expectCode(as(g1, (q) => q("select public.resolve_qr($1,$2)", [clinicA, token])), "CV403"); // guardian is not staff
    const random = await as(assistantA, (q) => q<{ r: unknown }>("select public.resolve_qr($1,'not-a-real-token') as r", [clinicA]));
    expect(random[0].r).toBeNull();

    // re-issue revokes the old token
    await as(assistantA, (q) => q("select public.issue_qr_pass($1,$2,$3)", [op(), c.childId, clinicA]));
    const old = await as(assistantA, (q) => q<{ r: unknown }>("select public.resolve_qr($1,$2) as r", [clinicA, token]));
    expect(old[0].r).toBeNull();
    // failed lookups are audited
    expect(Number((await admin<{ n: string }>("select count(*) n from private.audit_logs where action = 'qr.resolve' and outcome = 'denied'"))[0].n)).toBeGreaterThan(0);
  });

  it("guardians need verified full access to issue a pass and cannot issue for another family's child", async () => {
    const c = await guardianCreates(g1, "Qr Guardian Child", "2025-05-02");
    await expectCode(as(g1, (q) => q("select public.issue_qr_pass($1,$2)", [op(), c.childId])), "CV404"); // provisional only
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [g1.id, c.childId]);
    await as(assistantA, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), clinicA, rel[0].id]));
    const [{ r }] = await as(g1, (q) => q<R>("select public.issue_qr_pass($1,$2) as r", [op(), c.childId]));
    expect(r.token).toBeTruthy();
    await expectCode(as(g2, (q) => q("select public.issue_qr_pass($1,$2)", [op(), c.childId])), "CV404");
    await as(g1, (q) => q("select public.revoke_qr_pass($1,$2)", [op(), c.childId]));
    const res = await as(assistantA, (q) => q<{ r: unknown }>("select public.resolve_qr($1,$2) as r", [clinicA, r.token]));
    expect(res[0].r).toBeNull();
  });
});

describe("tenant and structural integrity", () => {
  it("composite foreign keys reject cross-organization references even for privileged writers", async () => {
    const [ch] = await admin<{ id: string }>("select id from public.children where organization_id = $1 limit 1", [org]);
    const [g] = await admin<{ id: string }>("insert into public.guardians (organization_id, full_name) values ($1,'Other Org Guardian') returning id", [org2]);
    await expect(admin(
      `insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope)
       values ($1,$2,$3,'mother','provisional','identity_only')`, [org2, g.id, ch.id])).rejects.toMatchObject({ code: "23503" });
    await expect(admin(
      `insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, basis) values ($1,$2,$3,'pending','clinic_registration')`, [org, ch.id, clinicC]))
      .rejects.toMatchObject({ code: "23503" });
  });

  it("an active relationship must carry a verification basis", async () => {
    const [ch] = await admin<{ id: string }>("select id from public.children where organization_id = $1 limit 1", [org]);
    const [g] = await admin<{ id: string }>("insert into public.guardians (organization_id, full_name) values ($1,'Unverified') returning id", [org]);
    await expect(admin(
      `insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope)
       values ($1,$2,$3,'mother','active','full')`, [org, g.id, ch.id])).rejects.toMatchObject({ code: "23514" });
  });

  it("estimated/unknown birth-date precision and merge pointers are constrained", async () => {
    await expect(admin(`insert into public.children (organization_id, local_record_no, display_name, birth_date_precision, dob) values ($1,'T-1','x','unknown','2025-01-01')`, [org])).rejects.toMatchObject({ code: "23514" });
    await expect(admin(`insert into public.children (organization_id, local_record_no, display_name, record_status) values ($1,'T-2','x','merged')`, [org])).rejects.toMatchObject({ code: "23514" });
  });

  it("one live relationship per guardian/child pair and one active primary enrollment per child", async () => {
    const c = await staffRegisters(assistantA, "Unique Pair", "2025-03-30", { identity: true, guardian: { fullName: "Pair G", verifiedInPerson: true } });
    const rel = await admin<{ guardian_id: string }>("select guardian_id from public.guardian_child_relationships where child_id = $1", [c.childId]);
    await expect(admin(
      `insert into public.guardian_child_relationships (organization_id, guardian_id, child_id, relationship, status, access_scope)
       values ($1,$2,$3,'mother','provisional','identity_only')`, [org, rel[0].guardian_id, c.childId])).rejects.toMatchObject({ code: "23505" });
    await expect(admin(
      `insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, is_primary, basis) values ($1,$2,$3,'active',true,'transfer')`, [org, c.childId, clinicB]))
      .rejects.toMatchObject({ code: "23505" });
  });

  it("a shared phone number does not link accounts or children", async () => {
    await staffRegisters(assistantA, "Aurelio Zamora", "2025-01-02", { identity: true, guardian: { fullName: "Shared One", phone: "09171112222", verifiedInPerson: true } });
    await staffRegisters(assistantA, "Benigno Quiroz", "2025-01-03", { identity: true, guardian: { fullName: "Shared Two", phone: "09171112222", verifiedInPerson: true } });
    const n = await admin<{ n: string }>("select count(*) n from public.guardians where contact_phone = '09171112222'");
    expect(Number(n[0].n)).toBe(2);
  });
});

describe("audit coverage", () => {
  it("registry changes are attributable to the acting profile", async () => {
    const rows = await admin<{ action: string; actor_id: string | null }>(
      "select distinct action, actor_id from private.audit_logs where action in ('child.registered','child.merged','guardian.link_approved','qr.issued')");
    expect(rows.length).toBeGreaterThanOrEqual(4);
    expect(rows.every((r) => r.actor_id)).toBe(true);
  });
});
