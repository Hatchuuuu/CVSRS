import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

let org: string, clinic: string, foreign: string, tech: Actor, parent: Actor, clinical: Actor;
type Page = { items: { id: string; action: string; actorName: string; targetType: string; createdAt: string; outcome: string | null }[]; nextCursor: { before: string; beforeId: string } | null };
const read = (actor: Actor, args: unknown[] = [clinic]) => as(actor, (q) => q<{ r: Page }>(`select public.list_technical_audit(${args.map((_, i) => `$${i + 1}`).join(",")}) r`, args));
beforeAll(async () => {
  org = await makeOrg("Technical audit synthetic"); clinic = await makeClinic(org, "Own technical clinic"); foreign = await makeClinic(org, "Foreign technical clinic");
  tech = await newUser("technical"); parent = await newUser("parent"); clinical = await newUser("clinical");
  await grant(org, clinic, tech, "tech_admin"); await grant(org, clinic, clinical, "clinical_lead");
});
afterAll(async () => { await pool.end(); });
it("denies parent, clinical-only, foreign clinic and no MFA reads", async () => {
  await expectCode(read(parent), "CV403"); await expectCode(read(clinical), "CV403");
  await expectCode(read(tech, [foreign]), "CV403"); await expectCode(read({ ...tech, aal: "aal1" }), "CV403");
});
it("returns only sanitized allowlisted own-clinic facts with stable equal-time paging", async () => {
  const stamp = "2026-01-01T12:00:00Z";
  const ids: string[] = [];
  for (const [action, entity, id] of [["clinic.profile_changed", "clinic", clinic], ["ops.check_recorded", "clinic", clinic], ["child.created", "child", op()], ["clinic.profile_changed", "clinic", foreign]]) {
    const [{ id: auditId }] = await admin<{ id: string }>("insert into private.audit_logs(organization_id,actor_id,action,entity_type,entity_id,server_time,request_id,outcome,after) values($1,$2,$3,$4,$5,$6,$7,'success',$8) returning id", [org, tech.id, action, entity, id, stamp, op(), JSON.stringify({ childId: op(), password: "SECRET", health: "PRIVATE", secret: "TOKEN" })]);
    if (id === clinic) ids.push(auditId);
  }
  const [{ r: first }] = await read(tech, [clinic, 1]);
  expect(first.items).toHaveLength(1); expect(first.nextCursor).not.toBeNull();
  const [{ r: second }] = await read(tech, [clinic, 1, first.nextCursor!.before, first.nextCursor!.beforeId]);
  expect(new Set([...first.items, ...second.items].map((item) => item.id))).toEqual(new Set(ids));
  const [{ r: all }] = await read(tech);
  expect(all.items.map((item) => item.action).sort()).toEqual(["clinic.profile_changed", "ops.check_recorded"]);
  expect(Object.keys(all.items[0]).sort()).toEqual(["action", "actorName", "createdAt", "id", "outcome", "targetType"]);
  expect(JSON.stringify(all)).not.toMatch(/SECRET|PRIVATE|TOKEN|childId|password|health/);
});
it("validates limits and cursor pairing", async () => {
  for (const args of [[clinic, 0], [clinic, 101], [clinic, 1, "2026-01-01", null], [clinic, 1, null, op()]]) await expectCode(read(tech, args), "CV422");
});
it("rechecks technical membership expiry and revocation", async () => {
  const expired = await newUser("expired-technical"); const id = await grant(org, clinic, expired, "tech_admin");
  await admin("update public.staff_memberships set valid_from=now()-interval '2 days',valid_until=now()-interval '1 day' where id=$1", [id]);
  await expectCode(read(expired), "CV403");
  await admin("update public.staff_memberships set valid_until=null,status='revoked' where id=$1", [id]);
  await expectCode(read(expired), "CV403");
});
it("reads durable configuration audit after a real command without granting broad audit access", async () => {
  await as(tech, (q) => q("select public.update_clinic_profile($1,$2,'Renamed synthetic clinic','','','','Asia/Manila')", [op(), clinic]));
  const [{ r }] = await read(tech);
  expect(r.items[0].action).toBe("clinic.profile_changed"); expect(r.items[0].outcome).toBe("success");
  await expectCode(as(tech, (q) => q("select public.search_audit($1)", [clinic])), "CV403");
});
it("technical directory retains a real revoked grant without widening the clinical directory", async () => {
  const person = await newUser("revoked-directory-staff");
  const id = await grant(org, clinic, person, "assistant");
  const [{ version }] = await admin<{ version: number }>("select version from public.staff_memberships where id=$1", [id]);
  await as(tech, (q) => q("select public.revoke_staff_membership($1,$2,$3)", [op(), id, "Synthetic access no longer required"]));
  const [{ rows }] = await as(tech, (q) => q<{ rows: { membershipId: string; status: string; version: number }[] }>("select public.list_technical_staff_memberships($1) rows", [clinic]));
  expect(rows.find((r) => r.membershipId === id)).toMatchObject({ status: "revoked", version: version + 1 });
  const [{ rows: clinicalRows }] = await as(tech, (q) => q<{ rows: { membershipId: string }[] }>("select public.list_staff_memberships($1) rows", [clinic]));
  expect(clinicalRows.some((r) => r.membershipId === id)).toBe(false);
  const [{ r }] = await read(tech);
  expect(r.items.some((item) => item.action === "staff_membership.revoked")).toBe(true);
});
it("technical directory denies parent, clinical-only, foreign and no-MFA reads", async () => {
  for (const [actor, target] of [[parent, clinic], [clinical, clinic], [tech, foreign], [{ ...tech, aal: "aal1" }, clinic]] as const) {
    await expectCode(as(actor, (q) => q("select public.list_technical_staff_memberships($1)", [target])), "CV403");
  }
});

