import { expect } from '@playwright/test';
import { journeyTest as test, signInFamily, signInStaff, readVisitState, apiPost } from './support';

test('parent and role-specific clinic dashboards keep actions usable at desktop and mobile widths',async({browser})=>{
 test.setTimeout(240000);const {clinicId}=readVisitState();if(!clinicId)throw new Error('Clinic fixture missing');
 const family=await signInFamily(browser);
 try{
  await family.page.goto('/children');await family.page.getByRole('link',{name:'Register a child',exact:true}).first().click();await expect(family.page.getByLabel("Child's given name(s)",{exact:true})).toBeVisible();
  const created=await apiPost(family.page,'/api/v1/children',{clinicId,child:{displayName:`Dashboard preview ${Date.now()}`,dobPrecision:'unknown'},relationship:'mother'});expect(created.status,created.text).toBe(200);const id=String(created.body.data!.childId);
  for(const [name,path] of [['parent','/children'],['child',`/children/${id}`]] as const){
   await family.page.goto(path);
   for(const width of [1440,390]){await family.page.setViewportSize({width,height:1000});await family.page.screenshot({path:`tmp/dashboard-${name}-${width}.png`});expect(await family.page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(width);
    const rail=family.page.getByRole('complementary',{name:'Workspace sidebar'});
    if(width===1440){await expect(rail).toBeVisible();const bounds=await rail.boundingBox();expect(bounds!.x).toBe(0);expect(bounds!.height+bounds!.y).toBeCloseTo(1000,0);await family.page.evaluate(()=>window.scrollTo(0,500));await family.page.getByRole('button',{name:/^Account menu for/}).click();await family.page.getByRole('group',{name:'Account options'}).getByRole('button',{name:'Sign out',exact:true}).click();await expect(family.page.getByRole('dialog',{name:'Sign out of eVacTrack?'})).toBeVisible();await family.page.getByRole('button',{name:'Cancel',exact:true}).click();await family.page.keyboard.press('Escape');await family.page.evaluate(()=>window.scrollTo(0,0));}
    else{await expect(rail).toBeHidden();await family.page.getByRole('button',{name:/^Menu/}).click();await expect(family.page.getByRole('link',{name:'Settings / Account',exact:true})).toBeVisible();await family.page.keyboard.press('Escape');}
   }
  }
  const manual=family.page.getByRole('link',{name:'Enter details manually',exact:true});await manual.click();await expect(family.page.getByLabel('Vaccine as written',{exact:true}).first()).toBeVisible();
  await family.page.goto('/account');
  const fullName=family.page.getByLabel('Full name',{exact:true});const savedName=await fullName.inputValue();
  await fullName.fill(`${savedName.toUpperCase()} UPDATED`);await family.page.getByRole('button',{name:'Save',exact:true}).click();await expect(family.page.getByRole('status').filter({hasText:'Saved'})).toBeVisible();await family.page.reload();await expect(fullName).toHaveValue(`${savedName} Updated`);
  await fullName.fill(savedName);await family.page.getByRole('button',{name:'Save',exact:true}).click();await expect(family.page.getByRole('status').filter({hasText:'Saved'})).toBeVisible();
  await family.page.getByLabel('New password',{exact:true}).fill('ExamplePassword123!');await family.page.getByLabel('Type the new password again',{exact:true}).fill('DifferentPassword123!');await family.page.getByRole('button',{name:'Change password',exact:true}).click();await expect(family.page.getByRole('region',{name:'Signing in',exact:true}).getByRole('alert')).toContainText('The new passwords do not match.');
  for(const [name,path] of [['account','/account'],['messages','/messages'],['care','/help']] as const){await family.page.goto(path);for(const width of [1440,390]){await family.page.setViewportSize({width,height:1000});await family.page.screenshot({path:`tmp/dashboard-${name}-${width}.png`});expect(await family.page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(width);}}
  await family.page.goto('/');await family.page.setViewportSize({width:1440,height:1000});await expect(family.page.getByRole('complementary',{name:'Workspace sidebar'})).toBeHidden();expect((await family.page.locator('#main').boundingBox())!.width).toBe(1440);
 }finally{await family.context.close();}
 for(const [role,route,title] of [['nurse','today','Clinic today'],['admin','admin','Staff accounts and access'],['bhw','followup','Follow-up list'],['nurse','inventory','Vaccine stock']] as const){
  const staff=await signInStaff(browser,role);
  try{await staff.page.goto(`/clinic/${clinicId}/${route}`);await expect(staff.page.getByRole('heading',{name:title,exact:true})).toBeVisible();
   for(const width of [1440,390]){await staff.page.setViewportSize({width,height:1000});await staff.page.screenshot({path:`tmp/dashboard-${route}-${width}.png`});expect(await staff.page.locator('body').evaluate(el=>el.scrollWidth)).toBeLessThanOrEqual(width);}
   if(route==='today'){await staff.page.getByRole('link',{name:'Check in a walk-in',exact:true}).click();await expect(staff.page.getByRole('region',{name:'Walk-in arrival',exact:true})).toBeVisible();}
   if(role==='bhw')await expect(staff.page.getByRole('link',{name:'Admin console',exact:true})).toHaveCount(0);
  }finally{await staff.context.close();}
 }
});
