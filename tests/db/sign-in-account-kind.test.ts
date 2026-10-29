import { afterAll, expect, it } from 'vitest';
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool } from './helpers';
afterAll(() => pool.end());
it('classifies only the current account from governed staff records, including pending and paused staff', async () => {
 const org=await makeOrg('Portal account type'); const clinic=await makeClinic(org,'Portal clinic');
 const parent=await newUser('portal-parent');const staff=await newUser('portal-staff');const applicant=await newUser('portal-applicant');
 const kind=(actor: typeof parent)=>as(actor,q=>q<{kind:string}>('select public.get_sign_in_account_kind() kind')).then(rows=>rows[0].kind);
 expect(await kind(parent)).toBe('family');
 await admin("update auth.users set raw_user_meta_data=raw_user_meta_data||'{\"role\":\"staff\",\"account_type\":\"staff\"}'::jsonb where id=$1",[parent.id]);
 expect(await kind(parent)).toBe('family');
 const membership=await grant(org,clinic,staff,'bhw');expect(await kind(staff)).toBe('staff');
 await admin("update public.staff_memberships set status='suspended' where id=$1",[membership]);expect(await kind(staff)).toBe('staff');
 await as(applicant,q=>q("select public.submit_staff_application($1,$2,'assistant',null,null)",[op(),clinic]));expect(await kind(applicant)).toBe('staff');
 expect(await kind(parent)).toBe('family');
 await expectCode(as(null,q=>q('select public.get_sign_in_account_kind()')),'42501');
});
