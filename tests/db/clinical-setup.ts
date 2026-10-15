import { admin, as, grant, makeClinic, makeOrg, newUser, op, type Actor } from "./helpers";
import { DEMO_ANTIGENS, DEMO_PRODUCTS, demoSchedule } from "../fixtures/synthetic-schedule";

export interface ClinicalWorld {
  org: string;
  clinic: string;
  otherClinic: string;
  techAdmin: Actor;
  clinician: Actor; // clinical_staff: rules.propose + evidence.verify
  lead: Actor;
  lead2: Actor;
  assistant: Actor;
  inventory: Actor;
  g1: Actor;
  g2: Actor;
  otherClinicStaff: Actor;
  products: Record<string, string>;
}

export const setDemoMode = (on: boolean) => admin("update private.settings set value = $1::jsonb where key = 'demo_mode'", [JSON.stringify(on)]);

type R = { r: Record<string, unknown> };

export async function clinicalWorld(): Promise<ClinicalWorld> {
  await setDemoMode(true);
  const org = await makeOrg("Clinical Org");
  const clinic = await makeClinic(org, "Clinical Clinic");
  const otherClinic = await makeClinic(org, "Other Clinic");
  const [techAdmin, clinician, lead, lead2, assistant, inventory, g1, g2, otherClinicStaff] = await Promise.all(
    ["tadmin", "clinician", "lead", "lead2", "asst", "inv", "g1", "g2", "otherstaff"].map(newUser));
  await grant(org, clinic, techAdmin, "tech_admin");
  await grant(org, clinic, clinician, "clinical_staff");
  await grant(org, clinic, lead, "clinical_lead");
  await grant(org, clinic, lead2, "clinical_lead");
  await grant(org, clinic, assistant, "assistant");
  await grant(org, clinic, inventory, "inventory");
  await grant(org, otherClinic, otherClinicStaff, "clinical_lead");

  for (const [code, name] of DEMO_ANTIGENS) {
    const [{ r }] = await as(techAdmin, (q) => q<R>("select public.create_antigen($1,$2,$3,$4) as r", [op(), clinic, code, name]));
    await as(lead, (q) => q("select public.set_master_status($1,$2,'antigen',$3,'active')", [op(), clinic, r.antigenId]));
  }
  const products: Record<string, string> = {};
  for (const p of DEMO_PRODUCTS) {
    const [{ r }] = await as(techAdmin, (q) => q<R>("select public.create_vaccine_product($1,$2,$3) as r", [op(), clinic, JSON.stringify(p)]));
    await as(lead, (q) => q("select public.set_master_status($1,$2,'product',$3,'active')", [op(), clinic, r.productId]));
    products[p.code] = r.productId as string;
  }
  return { org, clinic, otherClinic, techAdmin, clinician, lead, lead2, assistant, inventory, g1, g2, otherClinicStaff, products };
}

/** Full governed path: propose -> submit -> approve (different person) -> activate. Returns the version id. */
export async function activateDemoSchedule(w: ClinicalWorld, label: string, effectiveFrom = isoDaysFromToday(0), over: Parameters<typeof demoSchedule>[1] = {}) {
  const [{ r }] = await as(w.clinician, (q) => q<R>("select public.import_schedule_draft($1,$2,$3) as r", [op(), w.clinic, JSON.stringify(demoSchedule(label, over))]));
  const id = r.versionId as string;
  await as(w.clinician, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, id]));
  await as(w.lead, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, id]));
  await as(w.lead, (q) => q("select public.activate_schedule($1,$2,$3,$4)", [op(), w.clinic, id, effectiveFrom]));
  return id;
}

/** Clinic-local calendar date (Asia/Manila, the default clinic timezone) shifted by n days: never use the UTC date for clinic semantics. */
export const isoDaysFromToday = (n: number) => {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  const d = new Date(local + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
