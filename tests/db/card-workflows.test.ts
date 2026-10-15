import { afterAll, beforeAll, expect, it } from "vitest";
import { admin, as, expectCode, grant, newUser, op, pool } from "./helpers";
import { clinicalWorld, setDemoMode, type ClinicalWorld } from "./clinical-setup";
let w: ClinicalWorld; let child: string; let submission: string;
beforeAll(async () => {
  w = await clinicalWorld();
  const [{ r }] = await as(w.g1, q => q<{ r: { childId: string } }>("select public.create_child_provisional($1,$2,$3) r", [op(), w.clinic, JSON.stringify({ displayName: "Card Test Child", dob: "2024-06-15" })]));
  child = r.childId;
});
afterAll(async () => { await setDemoMode(false); await pool.end(); });
it("lets the provisional parent submit all card rows without writing clinical history", async () => {
  const key = op(); const rows = [{ productText: "BCG", administeredOn: "2024-06-16", precision: "exact", source: "manual" }, { productText: "Penta", precision: "unknown", source: "ocr" }];
  const call = () => as(w.g1, q => q<{ r: { submissionId: string } }>("select public.submit_card_record($1,$2,$3) r", [key, child, JSON.stringify(rows)]));
  const [{ r }] = await call(); submission = r.submissionId;
  expect((await call())[0]!.r).toEqual(r);
  expect((await admin<{ n: string }>("select count(*) n from public.vaccination_events where original_child_id=$1", [child]))[0]!.n).toBe("0");
  await expectCode(as(w.g2, q => q("select public.guardian_list_card_submissions($1)", [child])), "CV404");
});
it("keeps review clinic scoped and refuses BHW clinical approval", async () => {
  const bhw = await newUser("card-bhw"); await grant(w.org, w.clinic, bhw, "bhw");
  await expectCode(as(bhw, q => q("select public.review_card_submission($1,$2,$3,'approved','checked',1,'[]')", [op(), w.clinic, submission])), "CV403");
  await expectCode(as(w.otherClinicStaff, q => q("select public.staff_list_card_submissions($1,$2)", [w.otherClinic, child])), "CV404");
  await expectCode(as({ ...w.clinician, aal: "aal1" }, q => q("select public.staff_list_card_submissions($1,$2)", [w.clinic, child])), "CV403");
});
it("stores staff notes with idempotency and prevents BHW post-vaccination notes", async () => {
  const bhw = await newUser("note-bhw"); await grant(w.org, w.clinic, bhw, "bhw");
  await expectCode(as(bhw, q => q("select public.add_child_note($1,$2,$3,'post_vaccination','Observation')", [op(), w.clinic, child])), "CV403");
  const key = op();
  const call = () => as(bhw, q => q("select public.add_child_note($1,$2,$3,'follow_up','Family contacted',false)", [key, w.clinic, child]));
  expect(await call()).toEqual(await call());
  expect((await admin<{ n: string }>("select count(*) n from public.child_staff_notes where child_id=$1", [child]))[0]!.n).toBe("1");
  expect((await admin<{ author_role: string }>("select author_role from public.child_staff_notes where child_id=$1", [child]))[0]!.author_role).toBe("bhw");
});
it("requests changes, resubmits all rows, and approves atomically into verified history", async () => {
  const review = (decision: string, version: number, rows: unknown[] = []) => as(w.clinician, q => q("select public.review_card_submission($1,$2,$3,$4,'Paper card checked',$5,$6)", [op(), w.clinic, submission, decision, version, JSON.stringify(rows)]));
  await review("changes_requested", 1);
  const rows = [{ productText: "Alpha vaccine", administeredOn: "2024-06-16", precision: "exact", source: "manual" }];
  await as(w.g1, q => q("select public.submit_card_record($1,$2,$3,$4,2)", [op(), child, JSON.stringify(rows), submission]));
  await expectCode(review("approved", 3, [{ productText: "Alpha vaccine", administeredOn: "2024-06-16", productId: crypto.randomUUID() }]), "CV422");
  expect((await admin<{ status: string }>("select status from public.card_submissions where id=$1", [submission]))[0]!.status).toBe("pending");
  await review("approved", 3, [{ productText: "Alpha vaccine", administeredOn: "2024-06-16", productId: w.products["DEMO-P-ALPHA"] }]);
  expect((await admin<{ status: string }>("select status from public.card_submissions where id=$1", [submission]))[0]!.status).toBe("approved");
  expect((await admin<{ n: string }>("select count(*) n from public.vaccination_revisions where child_id=$1 and verification_status='verified'", [child]))[0]!.n).toBe("1");
  await expectCode(review("approved", 3), "CV409");
});
it("BHW finds the child by parent name and gets intake access without clinical history", async () => {
  const bhw=await newUser("registry-bhw"); await grant(w.org,w.clinic,bhw,"bhw");
  await admin("update public.guardians set full_name='Unique Parent CardTest' where profile_id=$1",[w.g1.id]);
  const [{ r }]=await as(bhw,q=>q<{r:{childId:string}[]}>("select public.staff_search_children($1,'Unique Parent CardTest') r",[w.clinic]));
  expect(r.map(row=>row.childId)).toContain(child);
  await expectCode(as(bhw,q=>q("select public.list_child_history($1,$2)",[w.clinic,child])),"CV403");
  await expectCode(as(w.g1,q=>q("select public.guardian_child_notes($1)",[child])),"CV404");
});
it("merging duplicate records preserves submitted cards and immutable note contents",async()=> {
 const [{r}]=await as(w.g1,q=>q<{r:{childId:string}}>("select public.create_child_provisional($1,$2,$3) r",[op(),w.clinic,JSON.stringify({displayName:"Duplicate Card Child",dob:"2024-06-15"})]));
 const duplicate=r.childId;
 await as(w.g1,q=>q("select public.submit_card_record($1,$2,$3)",[op(),duplicate,JSON.stringify([{productText:"BCG",precision:"unknown",source:"manual"}])]));
 await as(w.assistant,q=>q("select public.add_child_note($1,$2,$3,'intake','Paper card brought to desk')",[op(),w.clinic,duplicate]));
 const note=(await admin<{note:string;created_by:string;author_role:string}>("select note,created_by,author_role from public.child_staff_notes where child_id=$1",[duplicate]))[0]!;
 await as(w.lead,q=>q("select public.merge_children($1,$2,$3,$4,'Identity documents establish that both records are the same child')",[op(),w.clinic,child,duplicate]));
 expect((await admin<{n:string}>("select count(*) n from public.card_submissions where child_id=$1",[duplicate]))[0]!.n).toBe("0");
 expect((await admin<{note:string;created_by:string;author_role:string}>("select note,created_by,author_role from public.child_staff_notes where child_id=$1 and note='Paper card brought to desk'",[child]))[0]).toEqual(note);
});
it("transfers actionable card reviews to the receiving clinic",async()=> {
 const [{version,record_status}]=await admin<{version:number;record_status:string}>("select version,record_status from public.children where id=$1",[child]);
 if(record_status==='provisional') await as(w.assistant,q=>q("select public.confirm_child_identity($1,$2,$3,$4)",[op(),w.clinic,child,version]));
 const [{id}]=await admin<{id:string}>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id=r.guardian_id where r.child_id=$1 and g.profile_id=$2 and r.status='provisional'",[child,w.g1.id]);
 await as(w.assistant,q=>q("select public.verify_relationship($1,$2,$3,'in_person_id')",[op(),w.clinic,id]));
 const [{r:card}]=await as(w.g1,q=>q<{r:{submissionId:string}}>("select public.submit_card_record($1,$2,$3) r",[op(),child,JSON.stringify([{productText:"Transfer card dose",precision:"unknown",source:"manual"}])]));
 const [{r:transfer}]=await as(w.g1,q=>q<{r:{transferId:string}}>("select public.request_record_transfer_guardian($1,$2,$3) r",[op(),child,w.otherClinic]));
 await as(w.lead,q=>q("select public.approve_record_transfer_release($1,$2,$3)",[op(),w.clinic,transfer.transferId]));
 await as(w.otherClinicStaff,q=>q("select public.accept_record_transfer($1,$2,$3)",[op(),w.otherClinic,transfer.transferId]));
 const [{r}]=await as(w.otherClinicStaff,q=>q<{r:{submissionId:string}[]}>("select public.staff_list_card_submissions($1,$2) r",[w.otherClinic,child]));
 expect(r.map(row=>row.submissionId)).toContain(card.submissionId);
});
it("holds the child lock during card review so merge and transfer cannot overtake it",async()=> {
 const [{r:card}]=await as(w.g1,q=>q<{r:{submissionId:string}}>("select public.submit_card_record($1,$2,$3) r",[op(),child,JSON.stringify([{productText:"Lock check",precision:"unknown",source:"manual"}])]));
 let reviewed!:()=>void; let release!:()=>void;
 const ready=new Promise<void>(resolve=>{reviewed=resolve;});
 const hold=new Promise<void>(resolve=>{release=resolve;});
 const review=as(w.otherClinicStaff,async q=>{
  await q("select public.review_card_submission($1,$2,$3,'changes_requested','Check the paper card',1)",[op(),w.otherClinic,card.submissionId]);
  reviewed(); await hold;
 });
 try {
  await Promise.race([ready,review]);
  await expectCode(admin("select id from public.children where id=$1 for update nowait",[child]),"55P03");
 } finally { release(); await review; }
});
