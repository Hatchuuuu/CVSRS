import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, as, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

let org: string, clinic: string, lead: Actor, guardian: Actor;

beforeAll(async () => {
  org = await makeOrg("Guardian merge integrity");
  clinic = await makeClinic(org, "Guardian merge clinic");
  lead = await newUser("Merge lead");
  guardian = await newUser("Merge guardian");
  await grant(org, clinic, lead, "clinical_lead");
});
afterAll(() => pool.end());

async function mergePair(survivorStatus: "provisional" | "active" | "suspended", expired = false, survivorExpired = false) {
  const children = await admin<{ id: string }>(
    "insert into public.children (organization_id, local_record_no, display_name, record_status) values ($1,$2,'Merge survivor','active'),($1,$3,'Merge duplicate','active') returning id",
    [org, op(), op()],
  );
  const survivor = children[0]!.id, duplicate = children[1]!.id;
  await admin("insert into public.child_clinic_enrollments (organization_id, child_id, clinic_id, status, basis) values ($1,$2,$4,'active','clinic_registration'),($1,$3,$4,'active','clinic_registration')", [org, survivor, duplicate, clinic]);
  const [{ id: guardianId }] = await admin<{ id: string }>("insert into public.guardians (organization_id, profile_id, full_name) values ($1,$2,'Merge guardian') on conflict (organization_id, profile_id) where profile_id is not null do update set full_name = excluded.full_name returning id", [org, guardian.id]);
  const [{ id: provisionalId }] = await admin<{ id: string }>(
    "insert into public.guardian_child_relationships (organization_id,guardian_id,child_id,relationship,status,access_scope,verified_by,verified_at,verification_method) values ($1,$2,$3,'mother',$4,$5,$6,now(),'in_person_id') returning id",
    [org, guardianId, survivor, survivorStatus, survivorStatus === "provisional" ? "identity_only" : "full", lead.id],
  );
  const [{ id: verifiedId }] = await admin<{ id: string }>(
    "insert into public.guardian_child_relationships (organization_id,guardian_id,child_id,relationship,status,access_scope,verified_by,verified_at,verification_method,ends_at) values ($1,$2,$3,'mother','active','full',$4,now(),'clinic_record',$5) returning id",
    [org, guardianId, duplicate, lead.id, expired ? "2020-01-01" : null],
  );
  if (survivorExpired) await admin("update public.guardian_child_relationships set ends_at = '2020-01-01' where id = $1", [provisionalId]);
  await as(lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed duplicate record')", [op(), clinic, survivor, duplicate]));
  return { survivor, provisionalId, verifiedId, rows: await admin<{ id: string; child_id: string; status: string; access_scope: string; verification_method: string }>("select id,child_id,status,access_scope,verification_method from public.guardian_child_relationships where id in ($1,$2)", [provisionalId, verifiedId]) };
}

it("keeps the verified full relationship when the surviving record only has a provisional link", async () => {
  const result = await mergePair("provisional");
  expect(result.rows.find((r) => r.id === result.verifiedId)).toMatchObject({ child_id: result.survivor, status: "active", access_scope: "full", verification_method: "clinic_record" });
  expect(result.rows.find((r) => r.id === result.provisionalId)?.status).toBe("revoked");
  const [{ children }] = await as(guardian, (q) => q<{ children: { childId: string; accessScope: string }[] }>("select public.my_children() as children"));
  expect(children.find((child) => child.childId === result.survivor)?.accessScope).toBe("full");
});

it("preserves an intentional suspension on the surviving record", async () => {
  const result = await mergePair("suspended");
  expect(result.rows.find((r) => r.id === result.provisionalId)?.status).toBe("suspended");
  expect(result.rows.find((r) => r.id === result.verifiedId)?.status).toBe("revoked");
});

it("keeps the existing verified survivor relationship", async () => {
  const result = await mergePair("active");
  expect(result.rows.find((r) => r.id === result.provisionalId)?.status).toBe("active");
  expect(result.rows.find((r) => r.id === result.verifiedId)?.status).toBe("revoked");
});

it("does not turn an expired verified duplicate relationship into current access", async () => {
  const result = await mergePair("provisional", true);
  expect(result.rows.find((r) => r.id === result.provisionalId)?.status).toBe("provisional");
  expect(result.rows.find((r) => r.id === result.verifiedId)?.status).toBe("revoked");
});

it("retains current verified access when the surviving verified relationship has expired", async () => {
  const result = await mergePair("active", false, true);
  expect(result.rows.find((r) => r.id === result.verifiedId)).toMatchObject({ child_id: result.survivor, status: "active", access_scope: "full" });
  expect(result.rows.find((r) => r.id === result.provisionalId)?.status).toBe("revoked");
});
