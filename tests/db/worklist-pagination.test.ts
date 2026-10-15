import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, pool, type Actor } from "./helpers";

let org: string, clinic: string, reader: Actor, other: Actor;
type Message = { id: string; createdAt: string };
type Review = { caseId: string; createdAt: string };
type Followup = { childId: string; childName: string; behind: number; due: number };

beforeAll(async () => {
  org = await makeOrg("Paging fixtures");
  clinic = await makeClinic(org, "Paging clinic");
  reader = await newUser("Paging reader");
  other = await newUser("Other reader");
  await grant(org, clinic, reader, "assistant", ["bhw.followup"]);
  await admin(`insert into public.messages (organization_id,recipient_profile_id,kind,title,body,dedupe_key,created_at)
    select $1,$2,'test','Paging message','Fixture',g::text,'2026-10-07T00:00:00Z' from generate_series(1,125) g`, [org, reader.id]);
  await admin(`insert into public.messages (organization_id,recipient_profile_id,kind,title,body,dedupe_key) values ($1,$2,'test','Private message','Fixture','other')`, [org, other.id]);
  await admin(`insert into public.record_review_cases (organization_id,clinic_id,kind,created_at)
    select $1,$2,'sync','2026-10-07T00:00:00Z' from generate_series(1,125)`, [org, clinic]);
  await admin(`insert into public.children (organization_id,local_record_no,display_name,birth_date_precision,record_status)
    select $1,'PAGING-'||g,'Same Name','unknown','active' from generate_series(1,125) g`, [org]);
  await admin(`insert into public.child_clinic_enrollments (organization_id,child_id,clinic_id,status,is_primary,basis)
    select $1,id,$2,'active',true,'clinic_registration' from public.children where organization_id=$1`, [org, clinic]);
  await admin(`insert into public.followup_snapshots (organization_id,child_id,clinic_id,as_of,status,behind,due)
    select $1,id,$2,current_date,'evaluated',2,1 from public.children where organization_id=$1`, [org, clinic]);
});
afterAll(() => pool.end());

describe("worklist pagination beyond the first 100 records", () => {
  it("pages tied message timestamps without skipping or repeating, preserving recipient scope", async () => {
    const ids: string[] = [];
    let cursor: Message | undefined;
    for (let page = 0; page < 4; page++) {
      const [{ r }] = await as(reader, (q) => q<{ r: { unread: number; items: Message[] } }>("select public.my_messages(50,$1,$2) r", [cursor?.createdAt ?? null, cursor?.id ?? null]));
      expect(r.unread).toBe(125);
      ids.push(...r.items.map((m) => m.id));
      cursor = r.items.at(-1);
      if (r.items.length < 50) break;
    }
    expect(ids).toHaveLength(125);
    expect(new Set(ids).size).toBe(125);
    await expectCode(as(null, (q) => q("select public.my_messages(50,null,null)")), "42501");
    await expectCode(as(reader, (q) => q("select public.my_messages(50,now(),null)")), "CV422");
  });
  it("allows later review cases to be reached while earlier cases remain open", async () => {
    const ids: string[] = [];
    let cursor: Review | undefined;
    for (let page = 0; page < 4; page++) {
      const [{ r }] = await as(reader, (q) => q<{ r: Review[] }>("select public.list_review_cases($1,'open',50,$2,$3) r", [clinic, cursor?.createdAt ?? null, cursor?.caseId ?? null]));
      ids.push(...r.map((m) => m.caseId));
      cursor = r.at(-1);
      if (r.length < 50) break;
    }
    expect(ids).toHaveLength(125);
    expect(new Set(ids).size).toBe(125);
    await expectCode(as(other, (q) => q("select public.list_review_cases($1,'open',50,null,null)", [clinic])), "CV403");
    await expectCode(as(reader, (q) => q("select public.list_review_cases($1,'open',50,now(),null)", [clinic])), "CV422");
  });
  it("pages equal follow-up priorities and names with the child id tie breaker", async () => {
    const ids: string[] = [];
    let cursor: Followup | undefined;
    for (let page = 0; page < 4; page++) {
      const [{ r }] = await as(reader, (q) => q<{ r: { items: Followup[] } }>("select public.list_followup_worklist($1,'behind',50,$2,$3,$4,$5) r", [clinic, cursor?.behind ?? null, cursor?.due ?? null, cursor?.childName ?? null, cursor?.childId ?? null]));
      ids.push(...r.items.map((m) => m.childId));
      cursor = r.items.at(-1);
      if (r.items.length < 50) break;
    }
    expect(ids).toHaveLength(125);
    expect(new Set(ids).size).toBe(125);
    await expectCode(as(other, (q) => q("select public.list_followup_worklist($1,'behind',50,null,null,null,null)", [clinic])), "CV403");
    await expectCode(as(reader, (q) => q("select public.list_followup_worklist($1,'behind',50,2,null,null,null)", [clinic])), "CV422");
  });
});
