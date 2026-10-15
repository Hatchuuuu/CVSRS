import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

let org: string, clinic: string, otherClinic: string, lead: Actor, outsider: Actor, childId: string;
type Hit = { childId: string; recordStatus: string };
const search = (actor: Actor, query: string) => as(actor, (q) => q<{ r: Hit[] }>("select public.staff_search_children($1,$2,null,20) r", [clinic, query]));

beforeAll(async () => {
  org = await makeOrg("Inactive search fixtures");
  clinic = await makeClinic(org, "Returning family clinic");
  otherClinic = await makeClinic(org, "Other family clinic");
  lead = await newUser("Inactive search lead");
  outsider = await newUser("Other clinic reader");
  await grant(org, clinic, lead, "clinical_lead");
  await grant(org, otherClinic, outsider, "assistant");
  const [{ r }] = await as(lead, (q) => q<{ r: { childId: string } }>("select public.register_child_staff($1,$2,$3,null,true,true) r", [op(), clinic, JSON.stringify({ displayName: "Returning Search Child", dobPrecision: "unknown" })]));
  childId = r.childId;
});
afterAll(() => pool.end());

describe("inactive record rediscovery", () => {
  it("finds an inactive child by name and record number so the lead can reactivate it", async () => {
    await as(lead, (q) => q("select public.set_child_record_status($1,$2,$3,'inactive','moved',null)", [op(), clinic, childId]));
    const [{ local_record_no: recordNo }] = await admin<{ local_record_no: string }>("select local_record_no from public.children where id=$1", [childId]);
    for (const query of ["Returning Search", recordNo]) {
      const [{ r }] = await search(lead, query);
      expect(r).toContainEqual(expect.objectContaining({ childId, recordStatus: "inactive" }));
    }
    await expectCode(search(outsider, recordNo), "CV403");
    await as(lead, (q) => q("select public.set_child_record_status($1,$2,$3,'active',null,null)", [op(), clinic, childId]));
    const [{ r }] = await search(lead, recordNo);
    expect(r).toContainEqual(expect.objectContaining({ childId, recordStatus: "active" }));
  });

  it("chooses the best name match before limiting the search results", async () => {
    await admin(`insert into public.children (organization_id,local_record_no,display_name,birth_date_precision,record_status)
      select $1,'RANK-'||g,'Ranking Target Child '||g,'unknown','active' from generate_series(1,26) g`, [org]);
    const [{ id }] = await admin<{ id: string }>(`insert into public.children (organization_id,local_record_no,display_name,birth_date_precision,record_status)
      values ($1,'RANK-EXACT','Ranking Target Child','unknown','active') returning id`, [org]);
    await admin(`insert into public.child_clinic_enrollments (organization_id,child_id,clinic_id,status,is_primary,basis)
      select $1,id,$2,'active',true,'clinic_registration' from public.children where organization_id=$1 and local_record_no like 'RANK-%'`, [org, clinic]);
    const [{ r }] = await as(lead, (q) => q<{ r: Hit[] }>("select public.staff_search_children($1,$2,null,1) r", [clinic, "Ranking Target Child"]));
    expect(r.map((hit) => hit.childId)).toEqual([id]);
  });
});
