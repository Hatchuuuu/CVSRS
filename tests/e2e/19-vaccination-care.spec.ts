import { expect } from '@playwright/test';
import { journeyTest as test, readVisitState, signInStaff, signInFamily, apiPost, clinicDate } from './support';

test('nurse records vaccine and care instructions; parent sees them and BHW follow-up',async({browser})=>{
 test.setTimeout(240000);
 const {clinicId}=readVisitState();
 const family=await signInFamily(browser); const nurse=await signInStaff(browser,'nurse');
 try {
  const created=await apiPost(family.page,'/api/v1/children',{clinicId,child:{displayName:`Care flow ${Date.now()}`,dob:clinicDate(-60)},relationship:'mother'});
  expect(created.status,created.text).toBe(200); const childId=String(created.body.data!.childId);
  await family.page.goto(`/children/${childId}`);
  await expect(family.page.getByText('Waiting for the clinic to verify you',{exact:true})).toBeVisible();
  await expect(family.page.getByRole('region',{name:'Notes from the clinic',exact:true})).toHaveCount(0);
  await nurse.page.goto(`/clinic/${clinicId}/children/${childId}`);
  await expect(nurse.page.getByText('Complete registration verification',{exact:true})).toBeVisible();
  await nurse.page.getByRole('button',{name:'Confirm child identity',exact:true}).click();
  await expect(nurse.page.getByRole('status').filter({hasText:'Identity confirmed'})).toBeVisible();
  const guardians=nurse.page.getByRole('region',{name:'Guardians',exact:true});
  await guardians.getByLabel('Verified by',{exact:true}).selectOption('in_person_id');
  await guardians.getByRole('button',{name:'Verify this guardian',exact:true}).click();
  await expect(guardians.getByRole('status').filter({hasText:'Guardian verified'})).toBeVisible();
  await family.page.getByRole('button',{name:'Check verification status',exact:true}).click();
  await expect(family.page.getByText('Waiting for the clinic to verify you',{exact:true})).toHaveCount(0);
  expect((await apiPost(nurse.page,`/api/v1/clinics/${clinicId}/sessions`,{serviceDate:clinicDate(),startTime:'00:00',endTime:'23:59',serviceCode:`CARE-${Date.now()}`,totalCapacity:20,onlineCapacity:0,walkinCapacity:20})).status).toBe(200);
  const checkin=await apiPost(nurse.page,`/api/v1/clinics/${clinicId}/queue/check-in`,{childId,overflowReason:'Synthetic care workflow'});
  expect(checkin.status,checkin.text).toBe(200); const entry=checkin.body.data!;
  const called=await apiPost(nurse.page,`/api/v1/clinics/${clinicId}/queue/${entry.queueEntryId}/transition`,{to:'called',expectedVersion:entry.version,station:'CARE'}); expect(called.status,called.text).toBe(200);
  expect((await apiPost(nurse.page,`/api/v1/clinics/${clinicId}/queue/${entry.queueEntryId}/transition`,{to:'in_service',expectedVersion:called.body.data!.version,station:'CARE'})).status).toBe(200);
  await nurse.page.goto(`/clinic/${clinicId}/children/${childId}`);
  const give=nurse.page.getByRole('region',{name:'Give a vaccine',exact:true});
  const option=give.getByLabel('Vaccine and lot').locator('option').filter({hasText:/alpha/i}).first(); await expect(option).toHaveCount(1); await give.getByLabel('Vaccine and lot').selectOption((await option.getAttribute('value'))!);
  const care={'Medicine given or advised':'No medicine given','Side effects discussed':'Side effects discussed with family','Reactions or symptoms observed':'Observation recorded by nurse','Home care instructions':'Care explained at clinic','When to seek medical help':'Escalation instructions explained','Follow-up instructions':'Return instructions recorded'};
  for(const [label,value] of Object.entries(care)) await give.getByLabel(label,{exact:true}).fill(value);
  await give.getByRole('button',{name:'Review before signing'}).click(); for(const value of Object.values(care)) await expect(give.getByText(value,{exact:true})).toBeVisible();
  await give.getByRole('button',{name:'Sign and record',exact:true}).click(); await expect(give.getByRole('status').filter({hasText:'Vaccination recorded and signed'})).toBeVisible();
  await family.page.goto(`/children/${childId}`); const notes=family.page.getByRole('region',{name:'Notes from the clinic',exact:true});
  for(const value of Object.values(care)) await expect(notes).toContainText(value); await expect(notes).toContainText('Vaccine given:'); await expect(notes).toContainText(/Clinical staff/);
  const bhw=await signInStaff(browser,'bhw');
  try {
   await bhw.page.goto(`/clinic/${clinicId}/children/${childId}`); await expect(bhw.page.getByRole('region',{name:'Give a vaccine',exact:true})).toHaveCount(0);
   const staffNotes=bhw.page.getByRole('region',{name:'Staff notes',exact:true}); await staffNotes.getByLabel('Note type').selectOption('follow_up'); await staffNotes.getByLabel('Staff observation').fill('Family follow-up recorded by barangay health worker'); await staffNotes.getByRole('button',{name:'Add note',exact:true}).click(); await expect(staffNotes.getByRole('status').filter({hasText:'Note saved'})).toBeVisible();
  }finally{await bhw.context.close();}
  await family.page.reload(); await expect(notes).toContainText('Family follow-up recorded by barangay health worker'); await expect(notes).toContainText('Barangay health worker');
 }finally{await nurse.context.close();await family.context.close();}
});
