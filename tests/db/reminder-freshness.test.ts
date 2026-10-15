import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, op, pool } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let lot: string;
let location: string;
type R = { r: Record<string, unknown> };
type Job = { id: string; dedupe_key: string };

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "reminder-freshness");
  location = (await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,'Reminder fridge','usable') r", [op(), w.clinic])))[0]!.r.locationId as string;
  lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'REMINDERS',$4) r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], isoDaysFromToday(100)])))[0]!.r.lotId as string;
  await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,20,'REMINDER-STOCK')", [op(), w.clinic, location, lot]));
});
afterAll(async () => {
  // Existing SMS tests count record texts across the disposable database.
  // Remove only this suite's reminder texts so its fixtures cannot affect them.
  if (w) await admin("delete from public.sms_messages where organization_id = $1", [w.org]);
  await setDemoMode(false);
  await pool.end();
});

async function child() {
  const id = (await as(w.g1, (q) => q<R>("select public.create_child_provisional($1,$2,$3) r", [op(), w.clinic, JSON.stringify({ displayName: `Reminder child ${op()}`, dob: isoDaysFromToday(-14) })])))[0]!.r.childId as string;
  await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, id]));
  const relationship = (await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where r.child_id = $1 and g.profile_id = $2", [id, w.g1.id]))[0]!.id;
  await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, relationship]));
  await admin("update public.guardians set contact_phone = '09171234567' where profile_id = $1", [w.g1.id]);
  await admin("update public.guardians set contact_verified_at = now(), contact_verified_by = $2, contact_status = 'verified', sms_opt_in = true where profile_id = $1", [w.g1.id, w.assistant.id]);
  return id;
}
async function queued(childId: string, kind = "dose.due", aggregate = childId) {
  await admin("select private.enqueue_daily_reminders(2000)");
  const job = (await admin<Job>("select id,dedupe_key from private.outbox_jobs where aggregate_id = $1 and job_type = $2", [aggregate, kind]))[0];
  expect(job).toBeDefined();
  return job!;
}
const hold = (id: string) => as(w.clinician, (q) => q("select public.place_clinical_hold($1,$2,$3,'clinical_assessment')", [op(), w.clinic, id]));
const deliver = () => admin("select private.process_outbox(200)");
async function absent(job: Job) {
  expect((await admin("select id from public.messages where dedupe_key = $1", [job.dedupe_key]))).toHaveLength(0);
  expect((await admin("select id from public.sms_messages where dedupe_key = $1", [job.dedupe_key]))).toHaveLength(0);
  expect((await admin<{ status: string }>("select status from private.outbox_jobs where id = $1", [job.id]))[0]!.status).toBe("cancelled");
}
async function appointment() {
  const id = await child();
  const session = (await as(w.assistant, (q) => q<R>("select public.create_session($1,$2,$3) r", [op(), w.clinic, JSON.stringify({ serviceDate: isoDaysFromToday(1), startTime: "09:00", endTime: "10:00", totalCapacity: 10, onlineCapacity: 10, walkinCapacity: 0 })])))[0]!.r.sessionId as string;
  const booking = (await as(w.g1, (q) => q<R>("select public.book_appointment($1,$2,$3) r", [op(), id, session])))[0]!.r.appointmentId as string;
  return { session, job: await queued(id, "appointment.reminder", booking) };
}
const ageSession = (session: string) => admin("update public.clinic_sessions set service_date = service_date - 2, starts_at = starts_at - interval '2 days', ends_at = ends_at - interval '2 days' where id = $1", [session]);

describe("reminders use current facts at delivery", () => {
  it("still delivers a vaccine reminder when a dose remains due", async () => {
    const job = await queued(await child());
    await deliver();
    expect((await admin("select id from public.messages where dedupe_key = $1", [job.dedupe_key]))).toHaveLength(1);
    expect((await admin("select id from public.sms_messages where dedupe_key = $1", [job.dedupe_key]))).toHaveLength(1);
  });

  it("cancels a queued due reminder after vaccination removes the due dose", async () => {
    const id = await child();
    const job = await queued(id);
    const arrival = (await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'test visit') r", [op(), w.clinic, id])))[0]!.r;
    const called = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4) r", [op(), w.clinic, arrival.queueEntryId, arrival.version])))[0]!.r;
    const visit = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'in_service',$4) r", [op(), w.clinic, arrival.queueEntryId, called.version])))[0]!.r;
    await as(w.clinician, (q) => q("select public.record_administration($1,$2,$3,$4)", [op(), w.clinic, visit.encounterId, JSON.stringify({ lotId: lot, locationId: location })]));
    await deliver();
    await absent(job);
  });

  it("cancels a queued due reminder after a clinical hold", async () => {
    const id = await child();
    const job = await queued(id);
    await hold(id);
    await deliver();
    await absent(job);
  });

  it("cancels a delayed visit-tomorrow reminder when the clinic-local day has passed", async () => {
    const { session, job } = await appointment();
    await ageSession(session);
    await deliver();
    await absent(job);
  });

  it("does not claim an already-created due SMS after a clinical hold", async () => {
    const id = await child();
    const job = await queued(id);
    await deliver();
    const sms = (await admin<{ id: string }>("select id from public.sms_messages where dedupe_key = $1", [job.dedupe_key]))[0]!.id;
    await hold(id);
    const claimed = await admin<{ id: string }>("select * from private.claim_sms(100)");
    expect(claimed.map((row) => row.id)).not.toContain(sms);
    expect((await admin<{ status: string; last_error_code: string }>("select status,last_error_code from public.sms_messages where id = $1", [sms]))[0]).toEqual({ status: "undeliverable", last_error_code: "stale_reminder" });
  });

  it("does not claim an already-created visit SMS after its appointment day passes", async () => {
    const { session, job } = await appointment();
    await deliver();
    const sms = (await admin<{ id: string }>("select id from public.sms_messages where dedupe_key = $1", [job.dedupe_key]))[0]!.id;
    await ageSession(session);
    const claimed = await admin<{ id: string }>("select * from private.claim_sms(100)");
    expect(claimed.map((row) => row.id)).not.toContain(sms);
  });
});
