import { expect } from "@playwright/test";
import { journeyTest as test, readVisitState, signInFamily, signInStaff, account } from "./support";

test("a family scans all rows locally, edits the draft, and the nurse requests corrections", async ({ browser }) => {
  test.setTimeout(180000);
  const { childId, clinicId }=readVisitState();
  const family=await signInFamily(browser);
  const cardLabel=`Test BCG card entry ${Date.now()}`;
  const reviewNote=`Please confirm the date on the paper card. ${cardLabel}`;
  try {
    // A synthetic card fixture exercises the real OCR engine without using a patient's image.
    const imagePage=await family.context.newPage();
    await imagePage.setContent('<div style="padding:40px;background:white;color:black;font:32px Arial;width:850px">BCG | 1 | 2024-06-16 | LOT-A1<br><br>Penta | 1 | 2024-08-20 | LOT-P7</div>');
    const image=await imagePage.locator("div").screenshot(); await imagePage.close();
    const external:string[]=[]; family.page.on("request",r=> { if (/tesseract|traineddata|ocr\//i.test(r.url()) && new URL(r.url()).hostname!=="localhost") external.push(r.url()); });
    await family.page.goto(`/children/${childId}`);
    const card=family.page.getByRole("region",{name:"Vaccination card",exact:true});
    await expect(card.locator('input[type=file]:not([capture])')).toBeEnabled();
    await card.locator('input[type=file]:not([capture])').setInputFiles({name:"synthetic-card.png",mimeType:"image/png",buffer:image});
    await expect(card.getByLabel("Vaccine as written",{exact:true}).first()).toBeDisabled();
    await expect(card.getByRole("button",{name:"Submit card for review"})).toBeDisabled();
    await expect(card.getByText("Draft ready to review")).toBeVisible({timeout:120000});
    await expect(card.getByLabel("Vaccine as written",{exact:true})).toHaveCount(2);
    await expect(card.getByLabel("Vaccine as written",{exact:true}).first()).toBeEnabled();
    await card.getByLabel("Vaccine as written",{exact:true}).first().fill(cardLabel);
    await card.getByLabel("I checked every entry against the paper vaccination card.").check();
    await card.getByRole("button",{name:"Submit card for review"}).click();
    await expect(card.getByText("Card sent for clinic review")).toBeVisible();
    expect(external).toEqual([]);
    const nurse=await signInStaff(browser,"nurse");
    try {
      await nurse.page.goto(`/clinic/${clinicId}/children/${childId}`);
      const submitted=nurse.page.locator("article").filter({hasText:cardLabel});
      await expect(submitted).toContainText("Penta");
      await submitted.getByLabel("Review note for the family").fill(reviewNote);
      await submitted.getByRole("button",{name:"Save review decision"}).click();
      await expect(submitted).toContainText("changes requested");
    } finally { await nurse.context.close(); }
    await family.page.reload();
    await expect(card.getByText(reviewNote,{exact:true})).toBeVisible();
    await card.locator("li").filter({hasText:reviewNote}).getByRole("button",{name:"Edit requested changes"}).click();
    await expect(card.getByLabel("Vaccine as written",{exact:true})).toHaveCount(2);
  } finally { await family.context.close(); }
});

test("the administrator creates a confirmed nurse account and it appears for access approval", async ({ browser }) => {
  const { clinicId }=readVisitState(); const admin=await signInStaff(browser,"admin");
  const email=`admin-created-${Date.now()}@e2e.test`;
  try {
    await admin.page.goto(`/developer/${clinicId}/staff`);
    await admin.page.getByRole("link",{name:"Create staff account",exact:true}).click();
    await admin.page.waitForURL(new RegExp(`/developer/${clinicId}/staff/create$`));
    const form=admin.page.getByRole("region",{name:"Create staff account",exact:true});
    await form.getByLabel("Full name",{exact:true}).fill("Admin Created Midwife");
    await form.getByLabel("Email address",{exact:true}).fill(email);
    await form.getByLabel("Clinic role",{exact:true}).selectOption("clinical_staff");
    await form.getByLabel("Job title (optional)").fill("Midwife");
    await form.getByLabel("Temporary password",{exact:true}).fill("LocalMidwife123!");
    await form.getByRole("button",{name:"Create staff account",exact:true}).click();
    await expect(form.getByText("Staff account created",{exact:true})).toBeVisible();
    await admin.page.getByRole("link",{name:"Back to staff accounts",exact:true}).click();
    await expect(admin.page.getByRole("region",{name:"Access waiting for approval",exact:true})).toContainText("Admin Created Midwife");
    expect(account("admin")).not.toBe(email);
  } finally { await admin.context.close(); }
});
