import { beforeEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement, type ReactElement } from 'react';
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>[initial,vi.fn()]}));
const stub=vi.hoisted(()=>({run:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock('@/lib/client/api',()=>({useMutation:()=>({state:{phase:'idle'},run:stub.run})}));
vi.mock('@/app/children/privacy-notice',()=>({SelectedClinicPrivacy:()=>null,useClinicPrivacy:()=>({ready:true})}));
import { AddChildForm } from '@/app/children/forms';
beforeEach(()=>{stub.run.mockReset();stub.run.mockResolvedValue(null);});
it('provides bounded address fields and optional clinical sex without blocking unknown addresses',()=>{
 const html=renderToStaticMarkup(createElement(AddChildForm,{clinics:[{id:'clinic',name:'Clinic'}]}));
 for(const field of ['province','cityMunicipality','barangay','streetAddress','postalCode','sex'])expect(html).toContain(`name="${field}"`);
 expect(html).toContain('Leave unknown details blank');
 expect(html).toMatch(/maxLength="80"/i);
});
it.each([
 [{streetAddress:' Purok 2 ',barangay:' Bunao ',cityMunicipality:' Dumaguete City ',province:' Negros Oriental ',postalCode:' 6200 ',sex:'male'},'Purok 2, Barangay Bunao, Dumaguete City, Negros Oriental, 6200'],
 [{},undefined],
])('saves the entered home address through the existing validated child command',async(address,expected)=>{
 const tree=AddChildForm({clinics:[{id:'clinic',name:'Clinic'}]}) as ReactElement<{onSubmit:(event:unknown)=>Promise<void>}>;
 const values:Record<string,string>={clinicId:'clinic',givenNames:'Child',relationship:'mother',...address};
 vi.stubGlobal('FormData',class{get(key:string){return values[key]??null;}});
 try{await tree.props.onSubmit({preventDefault(){},currentTarget:{}});expect(stub.run).toHaveBeenCalledWith(expect.objectContaining({child:expect.objectContaining({addressText:expected,sex:values.sex||undefined})}));}finally{vi.unstubAllGlobals();vi.restoreAllMocks();}
});
