import { expect } from '@playwright/test';
import { journeyTest as test, signInFamily, signInStaff, readVisitState, clinicDate, asDatabaseOwner } from './support';

test('parent registers child address and authorized clinic staff can read the saved residence',async({browser})=>{
 const family=await signInFamily(browser);const nurse=await signInStaff(browser,'nurse');
 try{
  const {clinicId}=readVisitState();if(!clinicId)throw new Error('Clinic fixture missing');await family.page.goto('/children/register');
  const form=family.page.locator('form').filter({has:family.page.getByLabel('Province (optional)',{exact:true})});
  await form.getByLabel('Clinic',{exact:true}).selectOption(clinicId);
  const name=`Address Child ${Date.now()}`;
  await form.getByLabel("Child's given name(s)",{exact:true}).fill(name);
  await form.getByLabel("Child's family name",{exact:true}).fill('Example');
  await form.getByLabel('Date of birth',{exact:true}).fill(clinicDate(-90));
  await form.getByLabel('Sex for clinical reference (optional)',{exact:true}).selectOption('male');
  for(const [label,value] of Object.entries({'Province (optional)':'Negros Oriental','City / municipality (optional)':'Dumaguete City','Barangay (optional)':'Bunao','Postal code (optional)':'6200','House / lot, street, sitio or purok (optional)':'Purok 2'}))await form.getByLabel(label,{exact:true}).fill(value);
  const response=family.page.waitForResponse(r=>r.url().endsWith('/api/v1/children')&&r.request().method()==='POST');
  await form.getByRole('button',{name:'Add child',exact:true}).click();const saved=await response;expect(saved.status(),await saved.text()).toBe(200);const {data}=await saved.json();const childId=data.childId as string;
  await expect(form.getByLabel('Province (optional)',{exact:true})).toHaveValue('');
  await family.page.goto("/children");await family.page.reload();await expect(family.page.getByRole('heading',{name:`${name} Example`,exact:true})).toBeVisible();
  const expected='Purok 2, Barangay Bunao, Dumaguete City, Negros Oriental, 6200';
  const row=await asDatabaseOwner(async db=>(await db.query('select address_text,sex_for_clinical_reference from public.children where id=$1',[childId])).rows[0]);expect(row).toEqual({address_text:expected,sex_for_clinical_reference:'male'});
  await nurse.page.goto(`/clinic/${clinicId}/children/${childId}`);await expect(nurse.page.getByText(`Home address: ${expected}`,{exact:true})).toBeVisible();
  await family.page.setViewportSize({width:390,height:844});await family.page.goto('/children/register');await family.page.getByLabel('Province (optional)',{exact:true}).scrollIntoViewIfNeeded();expect(await family.page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(390);
 }finally{await family.context.close();await nurse.context.close();}
});
