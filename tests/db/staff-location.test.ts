import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, as, expectCode, grant, op, pool } from "./helpers";
import { clinicalWorld, setDemoMode, type ClinicalWorld } from "./clinical-setup";
let w: ClinicalWorld;
let member: { id: string; version: number };
beforeAll(async () => {
  w = await clinicalWorld();
  [member] = await admin<{ id: string; version: number }>("select id,version from public.staff_memberships where clinic_id=$1 and profile_id=$2", [w.clinic, w.assistant.id]);
});
afterAll(async () => { await setDemoMode(false); await pool.end(); });
it("stores and lists the clinic-specific assignment with idempotency", async () => {
  const key = op();
  const call = () => as(w.techAdmin, q => q("select public.update_staff_location($1,$2,$3,$4,' Bunao ',' Dumaguete City ') r", [key, w.clinic, member.id, member.version]));
  const result = await call(); expect(await call()).toEqual(result);
  const [{ r }] = await as(w.techAdmin, q => q<{ r: { membershipId: string; barangay: string; cityMunicipality: string }[] }>("select public.list_staff_memberships($1) r", [w.clinic]));
  expect(r.find(row => row.membershipId === member.id)).toMatchObject({ barangay: "Bunao", cityMunicipality: "Dumaguete City" });
});
it("rejects unauthorized, cross-clinic, partial and stale edits", async () => {
  await expectCode(as(w.assistant, q => q("select public.update_staff_location($1,$2,$3,1,'Bunao','Dumaguete City')", [op(), w.clinic, member.id])), "CV403");
  await expectCode(as(w.techAdmin, q => q("select public.update_staff_location($1,$2,$3,1,'Bunao','')", [op(), w.clinic, member.id])), "CV422");
  await expectCode(as(w.techAdmin, q => q("select public.update_staff_location($1,$2,$3,$4,'Bunao','Dumaguete City')", [op(), w.clinic, member.id, member.version])), "CV409");
  await expectCode(as(w.techAdmin, q => q("select public.update_staff_location($1,$2,$3,1,'Bunao','Dumaguete City')", [op(), w.clinic, op()])), "CV404");
  await expectCode(as(w.otherClinicStaff, q => q("select public.list_staff_memberships($1)", [w.clinic])), "CV403");
  await grant(w.org, w.otherClinic, w.techAdmin, "tech_admin");
  await expectCode(as(w.techAdmin, q => q("select public.update_staff_location($1,$2,$3,1,'Bunao','Dumaguete City')", [op(), w.otherClinic, member.id])), "CV404");
});
it("clears both fields without changing role or access status and audits the change", async () => {
  const [{ version }] = await admin<{ version: number }>("select version from public.staff_memberships where id=$1", [member.id]);
  await as(w.techAdmin, q => q("select public.update_staff_location($1,$2,$3,$4,'','')", [op(), w.clinic, member.id, version]));
  const [row] = await admin("select barangay,city_municipality,role_code,status from public.staff_memberships where id=$1", [member.id]);
  expect(row).toEqual({ barangay: null, city_municipality: null, role_code: "assistant", status: "active" });
  const [{ n }] = await admin<{ n: string }>("select count(*) n from private.audit_logs where entity_id=$1 and action='staff.location_updated'", [member.id]);
  expect(Number(n)).toBe(2);
});
