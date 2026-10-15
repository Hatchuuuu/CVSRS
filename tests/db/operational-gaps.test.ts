import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { admin, as, expectCode, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";
import { demoSchedule } from "../fixtures/synthetic-schedule";

// 0037: the gaps found by the 2026-10-04 whole-system audit (F40-F50).
let w: ClinicalWorld;
let seq = 0;
type R = { r: Record<string, unknown> };
let today: string;
let tomorrow: string;
let yesterday: string;

beforeEach(() => {
  today = isoDaysFromToday(0);
  tomorrow = isoDaysFromToday(1);
  yesterday = isoDaysFromToday(-1);
});

const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);
const deliver = () => admin("select private.process_outbox(500)");
const messagesFor = (profile: string, title: string) => count("select count(*) n from public.messages where recipient_profile_id = $1 and title = $2", [profile, title]);

const mkSession = async (date: string, over: Partial<{ total: number; online: number; walkin: number }> = {}) => {
  const s = { serviceDate: date, startTime: "00:00", endTime: "23:59", totalCapacity: over.total ?? 10, onlineCapacity: over.online ?? 8, walkinCapacity: over.walkin ?? 2 };
  const [{ r }] = await as(w.assistant, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), w.clinic, JSON.stringify(s)]));
  if (date === today) await admin("update public.clinic_sessions set ends_at = greatest(ends_at, now() + interval '1 hour') where id = $1", [r.sessionId]);
  return r.sessionId as string;
};

/** Identity-confirmed child at the clinic, with a verified guardian account when given. */
async function child(guardian?: Actor) {
  const name = `Gap Kid ${++seq}`;
  if (guardian) {
    const [{ r }] = await as(guardian, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: name, dob: isoDaysFromToday(-40) })]));
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, r.childId]));
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [guardian.id, r.childId]);
    await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
    return r.childId as string;
  }
  const [{ r }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: name, dob: isoDaysFromToday(-40) })]));
  return r.childId as string;
}

async function guardian(label: string, meta: Record<string, string> = {}) {
  const id = randomUUID();
  await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `${label}-${id.slice(0, 8)}@example.test`, JSON.stringify({ display_name: label, ...meta })]);
  return { id, aal: "aal2" as const };
}

/** Moves a whole visit day back to yesterday, as if staff had not finished it. */
async function backdate(session: string) {
  await admin("update public.clinic_sessions set service_date = $2, starts_at = starts_at - interval '1 day', ends_at = ends_at - interval '1 day' where id = $1", [session, yesterday]);
  await admin("update public.queue_entries set service_date = $2 where clinic_id = $1 and service_date = $3", [w.clinic, yesterday, today]);
  await admin("update public.encounters set service_date = $2 where clinic_id = $1 and service_date = $3", [w.clinic, yesterday, today]);
}

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "gaps-v1");
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("F40 a service day closes", () => {
  it("closes unfinished tickets, visits, missed bookings and sessions, once", async () => {
    // Clean slate: earlier suites may have left today's rows in this disposable clinic.
    await admin("select private.close_service_day_core($1, $2, 'test setup')", [w.clinic, isoDaysFromToday(-2)]).catch(() => undefined);
    const s = await mkSession(today);
    const waiting = await child();
    const inService = await child();
    const missed = await child(w.g1);
    await as(w.g1, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), missed, s]));
    const [{ r: t1 }] = await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'walk-in') as r", [op(), w.clinic, waiting]));
    const [{ r: t2 }] = await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'walk-in') as r", [op(), w.clinic, inService]));
    const [{ r: called }] = await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4) as r", [op(), w.clinic, t2.queueEntryId, t2.version]));
    const [{ r: served }] = await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'in_service',$4) as r", [op(), w.clinic, t2.queueEntryId, called.version]));
    expect(t1.queueEntryId).toBeTruthy();
    await backdate(s);

    // Yesterday's unfinished visit is not offered as the open visit (0038)...
    const [{ r: offered }] = await as(w.clinician, (q) => q<{ r: unknown }>("select public.get_open_encounter($1,$2) as r", [w.clinic, inService]));
    expect(offered).toBeNull();
    // ...and cannot take a vaccination any more (it would be dated to the wrong visit).
    await expectCode(admin("insert into public.vaccination_events (organization_id, original_child_id, encounter_id, origin, source_operation_id, created_by) values ($1,$2,$3,'clinic_administered',$4,$5)",
      [w.org, inService, served.encounterId, randomUUID(), w.clinician.id]), "CV409");

    const [{ r: backlog }] = await as(w.assistant, (q) => q<{ r: { open: { serviceDate: string; openTickets: number; openVisits: number; unconfirmedBookings: number }[] } }>("select public.service_day_backlog($1) as r", [w.clinic]));
    const day = backlog.open.find((d) => d.serviceDate === yesterday)!;
    expect(day).toMatchObject({ openTickets: 2, openVisits: 1, unconfirmedBookings: 1 });

    await expectCode(as(w.inventory, (q) => q("select public.close_service_day($1,$2,$3)", [op(), w.clinic, yesterday])), "CV403");
    await expectCode(as(w.assistant, (q) => q("select public.close_service_day($1,$2,$3)", [op(), w.clinic, today])), "CV422");
    const [{ r }] = await as(w.assistant, (q) => q<R>("select public.close_service_day($1,$2,$3) as r", [op(), w.clinic, yesterday]));
    expect(r).toMatchObject({ ticketsLeft: 1, visitsCompleted: 0, visitsUnserved: 1, noShows: 1, sessionsClosed: 1 });

    expect(await count("select count(*) n from public.queue_entries where clinic_id = $1 and service_date = $2 and status in ('waiting','called','held','in_service')", [w.clinic, yesterday])).toBe(0);
    expect((await admin<{ status: string; outcome: string }>("select status, outcome from public.encounters where id = $1", [served.encounterId]))[0]).toEqual({ status: "cancelled", outcome: "left" });
    expect(await count("select count(*) n from public.appointments where session_id = $1 and status = 'no_show'", [s])).toBe(1);
    expect((await admin<{ status: string }>("select status from public.clinic_sessions where id = $1", [s]))[0]!.status).toBe("closed");
    // The daily report now counts the missed booking.
    const [{ r: report }] = await as(w.lead, (q) => q<{ r: { rows: { date: string; noShow: number }[] } }>("select public.report_daily_activity($1,$2,$3) as r", [w.clinic, yesterday, yesterday]));
    expect(report.rows.find((x) => x.date === yesterday)?.noShow).toBe(1);

    // Running again changes nothing and writes no second audit row.
    const again = await as(w.assistant, (q) => q<R>("select public.close_service_day($1,$2,$3) as r", [op(), w.clinic, yesterday]));
    expect(again[0]!.r).toMatchObject({ ticketsLeft: 0, visitsUnserved: 0, noShows: 0, sessionsClosed: 0 });
    expect(await count("select count(*) n from private.audit_logs where action = 'day.closed' and clinic_id = $1 and after ->> 'date' = $2", [w.clinic, yesterday])).toBe(1);
    const [{ r: after }] = await as(w.assistant, (q) => q<{ r: { open: { serviceDate: string }[]; recentlyClosed: unknown[] } }>("select public.service_day_backlog($1) as r", [w.clinic]));
    expect(after.open.find((d) => d.serviceDate === yesterday)).toBeUndefined();
    expect(after.recentlyClosed.length).toBeGreaterThan(0);
  });

  it("the worker closes past days on its own, at most every ten minutes, and needs only its own role", async () => {
    const s = await mkSession(today);
    const k = await child();
    await as(w.assistant, (q) => q("select public.check_in($1,$2,$3,null,'walk-in')", [op(), w.clinic, k]));
    await backdate(s);
    await admin("delete from private.maintenance_runs");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("set local role cvsrs_outbox_worker");
      const first = (await client.query("select private.run_daily_maintenance() as r")).rows[0].r;
      const second = (await client.query("select private.run_daily_maintenance() as r")).rows[0].r;
      await client.query("commit");
      expect(first.daysClosed).toBeGreaterThanOrEqual(1);
      expect(second).toEqual({ skipped: true });
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
    expect((await admin<{ status: string }>("select status from public.clinic_sessions where id = $1", [s]))[0]!.status).toBe("closed");
    await expectCode(as(w.assistant, (q) => q("select private.run_daily_maintenance()")), "42501");
  });
});

describe("F41 / F42 staff bookings and sessions", () => {
  it("staff book for a family (assisted), see the child's bookings, and the family is told", async () => {
    const s = await mkSession(tomorrow);
    const k = await child(w.g2);
    const [{ r }] = await as(w.assistant, (q) => q<R>("select public.book_appointment($1,$2,$3,'phoned in','{}') as r", [op(), k, s]));
    // Booked by staff, so the 'assisted' channel even though the family also has an account.
    expect((await admin<{ channel: string }>("select channel from public.appointments where id = $1", [r.appointmentId]))[0]!.channel).toBe("assisted");
    const staffOnly = await child();
    const [{ r: assisted }] = await as(w.assistant, (q) => q<R>("select public.book_appointment($1,$2,$3,'phoned in','{}') as r", [op(), staffOnly, s]));
    const [{ r: list }] = await as(w.assistant, (q) => q<{ r: { appointmentId: string; channel: string; sessionStatus: string }[] }>("select public.list_child_appointments($1,$2) as r", [w.clinic, staffOnly]));
    expect(list.find((a) => a.appointmentId === assisted.appointmentId)).toMatchObject({ channel: "assisted", sessionStatus: "open" });
    await expectCode(as(w.g2, (q) => q("select public.list_child_appointments($1,$2)", [w.clinic, k])), "CV403");
    await expectCode(as(w.inventory, (q) => q("select public.list_child_appointments($1,$2)", [w.clinic, k])), "CV403");
    await deliver();
    expect(await messagesFor(w.g2.id, "Visit booked")).toBeGreaterThanOrEqual(1);
  });

  it("capacity changes never go below current bookings and need the current version; the roster lists who is booked", async () => {
    const s = await mkSession(tomorrow, { total: 4, online: 2, walkin: 2 });
    const k1 = await child(w.g1);
    const k2 = await child(w.g2);
    await as(w.g1, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), k1, s]));
    await as(w.g2, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), k2, s]));
    const version = (await admin<{ version: number }>("select version from public.clinic_sessions where id = $1", [s]))[0]!.version;
    await expectCode(as(w.assistant, (q) => q("select public.update_session_capacity($1,$2,$3,$4,4,1,2)", [op(), w.clinic, s, version])), "CV409");
    await expectCode(as(w.assistant, (q) => q("select public.update_session_capacity($1,$2,$3,$4,4,3,2)", [op(), w.clinic, s, version])), "CV422");
    await expectCode(as(w.inventory, (q) => q("select public.update_session_capacity($1,$2,$3,$4,6,4,2)", [op(), w.clinic, s, version])), "CV403");
    await as(w.assistant, (q) => q("select public.update_session_capacity($1,$2,$3,$4,6,4,2)", [op(), w.clinic, s, version]));
    await expectCode(as(w.assistant, (q) => q("select public.update_session_capacity($1,$2,$3,$4,8,6,2)", [op(), w.clinic, s, version])), "CV409");
    const [{ r: sessions }] = await as(w.assistant, (q) => q<{ r: { sessionId: string; onlineCapacity: number; version: number }[] }>("select public.list_sessions($1,$2,$3) as r", [w.clinic, tomorrow, tomorrow]));
    expect(sessions.find((x) => x.sessionId === s)).toMatchObject({ onlineCapacity: 4, version: version + 1 });
    const [{ r: roster }] = await as(w.assistant, (q) => q<{ r: { childId: string }[] }>("select public.list_session_roster($1,$2) as r", [w.clinic, s]));
    expect(roster.map((x) => x.childId).sort()).toEqual([k1, k2].sort());
  });
});

describe("F43 / F44 decisions that could get stuck", () => {
  it("a schedule under review can be sent back by a reviewer or withdrawn by its proposer, never by others", async () => {
    const draft = async (label: string) => {
      const [{ r }] = await as(w.clinician, (q) => q<R>("select public.import_schedule_draft($1,$2,$3) as r", [op(), w.clinic, JSON.stringify(demoSchedule(label))]));
      await as(w.clinician, (q) => q("select public.submit_schedule_for_review($1,$2,$3)", [op(), w.clinic, r.versionId]));
      return r.versionId as string;
    };
    const v1 = await draft("gaps-return-1");
    await expectCode(as(w.assistant, (q) => q("select public.return_schedule_to_draft($1,$2,$3,'wrong file')", [op(), w.clinic, v1])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.return_schedule_to_draft($1,$2,$3,'x')", [op(), w.clinic, v1])), "CV422");
    await as(w.lead, (q) => q("select public.return_schedule_to_draft($1,$2,$3,'wrong intervals for dose 2')", [op(), w.clinic, v1]));
    expect((await admin<{ status: string }>("select status from public.schedule_versions where id = $1", [v1]))[0]!.status).toBe("draft");
    await expectCode(as(w.lead2, (q) => q("select public.approve_schedule($1,$2,$3)", [op(), w.clinic, v1])), "CV409");
    await as(w.clinician, (q) => q("select public.discard_schedule_draft($1,$2,$3)", [op(), w.clinic, v1]));

    const v2 = await draft("gaps-return-2");
    await as(w.clinician, (q) => q("select public.return_schedule_to_draft($1,$2,$3,'uploaded the wrong file')", [op(), w.clinic, v2]));
    expect(await count("select count(*) n from private.audit_logs where action = 'schedule.withdrawn' and entity_id = $1", [v2])).toBe(1);
  });

  it("a stock count can be rejected by another approver, with a reason, and posts nothing", async () => {
    const [{ r: loc }] = await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,$3,'usable') as r", [op(), w.clinic, `Count fridge ${++seq}`]));
    const product = Object.values(w.products)[0]!;
    const [{ r: lot }] = await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5,'Maker') as r", [op(), w.clinic, product, `LOT-${seq}`, isoDaysFromToday(300)]));
    const [{ r: proposal }] = await as(w.inventory, (q) => q<R>("select public.propose_stock_adjustment($1,$2,$3,$4,5,'sheet 1','found extra boxes') as r", [op(), w.clinic, loc.locationId, lot.lotId]));
    expect(proposal.status).toBe("pending_approval");
    await expectCode(as(w.inventory, (q) => q("select public.reject_stock_adjustment($1,$2,$3,'miscount')", [op(), w.clinic, proposal.caseId])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.reject_stock_adjustment($1,$2,$3,'')", [op(), w.clinic, proposal.caseId])), "CV422");
    await as(w.lead, (q) => q("select public.reject_stock_adjustment($1,$2,$3,'boxes belonged to the next clinic')", [op(), w.clinic, proposal.caseId]));
    expect((await admin<{ status: string }>("select status from public.record_review_cases where id = $1", [proposal.caseId]))[0]!.status).toBe("rejected");
    expect(await count("select count(*) n from public.stock_balances where location_id = $1 and on_hand <> 0", [loc.locationId])).toBe(0);
    await expectCode(as(w.lead2, (q) => q("select public.approve_stock_adjustment($1,$2,$3)", [op(), w.clinic, proposal.caseId])), "CV409");
  });
});

describe("F45 / F46 families are told", () => {
  it("verification, a pause, a restore and an end of access each send the guardian one message", async () => {
    const g = await guardian("Notify Guardian");
    const k = await child(g);
    await deliver();
    expect(await messagesFor(g.id, "Access verified")).toBe(1);
    const rel = (await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians x on x.id = r.guardian_id where x.profile_id = $1 and r.child_id = $2", [g.id, k]))[0]!.id;
    await as(w.assistant, (q) => q("select public.set_relationship_status($1,$2,$3,'suspended','custody question')", [op(), w.clinic, rel]));
    await as(w.assistant, (q) => q("select public.set_relationship_status($1,$2,$3,'active','resolved in person')", [op(), w.clinic, rel]));
    await deliver();
    await deliver(); // a retried pass never duplicates
    expect(await messagesFor(g.id, "Access paused")).toBe(1);
    expect(await messagesFor(g.id, "Access restored")).toBe(1);
  });

  it("a declined link request, a reviewed edit request and a rejected reported vaccine are each explained", async () => {
    const g = await guardian("Request Guardian");
    const [{ r: link }] = await as(g, (q) => q<R>("select public.request_guardian_link($1,$2,$3,'mother') as r", [op(), w.clinic, JSON.stringify({ childName: "Nobody Here" })]));
    await as(w.assistant, (q) => q("select public.resolve_link_case($1,$2,'reject',null,'other','no matching record')", [op(), link.caseId]));
    const k = await child(g);
    await as(g, (q) => q("select public.request_child_edit($1,$2,$3,'typo')", [op(), k, JSON.stringify({ displayName: "Corrected Name" })]));
    const edit = (await admin<{ id: string }>("select id from public.record_review_cases where kind = 'identity_edit' and child_id = $1", [k]))[0]!.id;
    await as(w.assistant, (q) => q("select public.resolve_review_case($1,$2,'no_action','checked against the birth certificate')", [op(), edit]));
    const [{ r: dose }] = await as(g, (q) => q<R>("select public.report_outside_dose($1,$2,$3) as r", [op(), k, JSON.stringify({ productText: "private clinic shot", administeredOn: isoDaysFromToday(-10) })]));
    await as(w.clinician, (q) => q("select public.verify_outside_dose($1,$2,$3,'reject',null,null,'card unreadable')", [op(), w.clinic, dose.eventId]));
    await deliver();
    expect(await messagesFor(g.id, "Link request not approved")).toBe(1);
    expect(await messagesFor(g.id, "Change request reviewed")).toBe(1);
    expect(await messagesFor(g.id, "Reported vaccine not verified")).toBe(1);
  });

  it("reminds the family the day before a visit, once, and never for a cancelled one", async () => {
    const s = await mkSession(tomorrow);
    const g = await guardian("Reminder Guardian");
    const k = await child(g);
    const other = await child(g);
    await as(g, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), k, s]));
    const [{ r: cancelled }] = await as(g, (q) => q<R>("select public.book_appointment($1,$2,$3,null,'{}') as r", [op(), other, s]));
    await as(g, (q) => q("select public.cancel_appointment($1,$2,'change of plans')", [op(), cancelled.appointmentId]));
    await admin("select private.enqueue_daily_reminders(2000)");
    await admin("select private.enqueue_daily_reminders(2000)");
    await deliver();
    expect(await messagesFor(g.id, "Visit tomorrow")).toBe(1);
  });

  it("checks each child for a due vaccine once a day and reminds at most once a week", async () => {
    const g = await guardian("Due Guardian");
    const k = await child(g);
    await admin("delete from private.reminder_checks where child_id = $1", [k]);
    const first = (await admin<{ r: { childrenChecked: number } }>("select private.enqueue_daily_reminders(2000) as r"))[0]!.r;
    expect(first.childrenChecked).toBeGreaterThanOrEqual(1);
    const checked = await admin<{ checked_on: string }>("select checked_on::text from private.reminder_checks where child_id = $1", [k]);
    expect(checked[0]!.checked_on).toBe(today);
    const [{ r: schedule }] = await as(g, (q) => q<{ r: { requirements?: { status: string }[] } }>("select public.guardian_get_schedule($1) as r", [k]));
    const due = (schedule.requirements ?? []).some((x) => ["due_today", "due_now", "overdue"].includes(x.status));
    expect(await count("select count(*) n from private.outbox_jobs where job_type = 'dose.due' and aggregate_id = $1", [k])).toBe(due ? 1 : 0);
    await admin("select private.enqueue_daily_reminders(2000)");
    expect(await count("select count(*) n from private.outbox_jobs where job_type = 'dose.due' and aggregate_id = $1", [k])).toBe(due ? 1 : 0);
  });
});

describe("F47 / F48 / F49 accounts", () => {
  it("keeps the sign-up phone and language, and gives a nameless account a temporary name to fix", async () => {
    const id = randomUUID();
    await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `maria.${id.slice(0, 6)}@example.test`, JSON.stringify({ phone: "0917 123 4567", preferred_language: "fil" })]);
    const p = (await admin<{ display_name: string; needs_name: boolean; locale: string; signup_phone: string }>("select display_name, needs_name, locale, signup_phone from public.profiles where id = $1", [id]))[0]!;
    expect(p).toMatchObject({ display_name: `maria.${id.slice(0, 6)}`, needs_name: true, locale: "fil", signup_phone: "0917 123 4567" });
    const bad = randomUUID();
    await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [bad, `x${bad.slice(0, 6)}@example.test`, JSON.stringify({ display_name: "X", phone: "call me maybe" })]);
    expect((await admin<{ signup_phone: string | null }>("select signup_phone from public.profiles where id = $1", [bad]))[0]!.signup_phone).toBeNull();

    // The first child added creates the guardian with that phone, unverified.
    const actor = { id, aal: "aal2" as const };
    await as(actor, (q) => q("select public.create_child_provisional($1,$2,$3)", [op(), w.clinic, JSON.stringify({ displayName: `Phone Kid ${++seq}`, dob: isoDaysFromToday(-20) })]));
    const g = (await admin<{ contact_phone: string; contact_status: string; preferred_language: string }>("select contact_phone, contact_status, preferred_language from public.guardians where profile_id = $1", [id]))[0]!;
    expect(g).toEqual({ contact_phone: "0917 123 4567", contact_status: "unverified", preferred_language: "fil" });
  });

  it("people correct their own name and language; staff see the new name", async () => {
    const me = await newUser("Typo Nmae");
    await expectCode(as(me, (q) => q("select public.update_my_profile('  ', 'en')")), "CV422");
    await expectCode(as(me, (q) => q("select public.update_my_profile('Ana Reyes', 'es')")), "CV422");
    await expectCode(as(null, (q) => q("select public.update_my_profile('Ana Reyes', 'en')")), "42501");
    await as(me, (q) => q("select public.update_my_profile('Ana Reyes', 'fil')"));
    const [{ r }] = await as(me, (q) => q<{ r: { displayName: string; locale: string; needsName: boolean } }>("select public.get_my_context() as r"));
    expect(r).toMatchObject({ displayName: "Ana Reyes", locale: "fil", needsName: false });
    expect(await count("select count(*) n from private.audit_logs where action = 'profile.updated' and entity_id = $1", [me.id])).toBe(1);
  });

  it("an operator can deactivate an account, which removes every capability", async () => {
    const staff = await newUser("Leaving Staff");
    await admin("insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status, approved_by, requested_by) values ($1,$2,$3,'assistant','active',$4,$4)", [w.org, staff.id, w.clinic, w.lead.id]);
    await as(staff, (q) => q("select public.list_sessions($1)", [w.clinic]));
    await expectCode(as(staff, (q) => q("select private.set_profile_status($1,'deactivated','left the clinic')", [staff.id])), "42501");
    await admin("select private.set_profile_status($1,'deactivated','left the clinic')", [staff.id]);
    await expectCode(as(staff, (q) => q("select public.list_sessions($1)", [w.clinic])), "CV403");
    expect((await as(staff, (q) => q<{ r: unknown }>("select public.get_my_context() as r")))[0]!.r).toBeNull();
  });
});

describe("F50 real-world end states", () => {
  it("a child can be marked inactive and back; inactive children get no messages, bookings or follow-up", async () => {
    const s = await mkSession(tomorrow);
    const g = await guardian("Inactive Guardian");
    const k = await child(g);
    await as(g, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), k, s]));
    await expectCode(as(w.assistant, (q) => q("select public.set_child_record_status($1,$2,$3,'inactive','moved',null)", [op(), w.clinic, k])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.set_child_record_status($1,$2,$3,'inactive','other','')", [op(), w.clinic, k])), "CV422");
    await as(w.lead, (q) => q("select public.set_child_record_status($1,$2,$3,'inactive','moved','moved to the city')", [op(), w.clinic, k]));
    expect((await admin<{ record_status: string; inactive_reason: string }>("select record_status, inactive_reason from public.children where id = $1", [k]))[0]).toEqual({ record_status: "inactive", inactive_reason: "moved" });
    expect(await count("select count(*) n from public.appointments where child_id = $1 and status = 'confirmed'", [k])).toBe(0);
    expect((await admin<{ n: number }>("select private.notify_guardians($1,$2::uuid,'record','Test','Test body','inactive-test:' || $2::text) as n", [w.org, k]))[0]!.n).toBe(0);
    const s2 = await mkSession(isoDaysFromToday(2));
    await expectCode(as(g, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), k, s2])), "CV409");
    await as(w.lead, (q) => q("select public.set_child_record_status($1,$2,$3,'active',null,null)", [op(), w.clinic, k]));
    await as(g, (q) => q("select public.book_appointment($1,$2,$3,null,'{}')", [op(), k, s2]));
  });

  it("a guardian phone can be marked as not working, which stops text messages", async () => {
    const g = await guardian("Wrong Number", { phone: "0917 000 1111" });
    const k = await child(g);
    const gid = (await admin<{ id: string }>("select id from public.guardians where profile_id = $1", [g.id]))[0]!.id;
    await expectCode(as(w.inventory, (q) => q("select public.mark_guardian_contact_invalid($1,$2,$3,'no answer')", [op(), w.clinic, gid])), "CV403");
    await expectCode(as(w.assistant, (q) => q("select public.mark_guardian_contact_invalid($1,$2,$3,'')", [op(), w.clinic, gid])), "CV422");
    await as(w.assistant, (q) => q("select public.mark_guardian_contact_invalid($1,$2,$3,'number belongs to someone else')", [op(), w.clinic, gid]));
    expect((await admin<{ contact_status: string; sms_opt_in: boolean }>("select contact_status, sms_opt_in from public.guardians where id = $1", [gid]))[0]).toEqual({ contact_status: "invalid", sms_opt_in: false });
    expect(k).toBeTruthy();
  });

  it("an empty stock location can close; one holding stock cannot", async () => {
    const product = Object.values(w.products)[0]!;
    const [{ r: lot }] = await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5,'Maker') as r", [op(), w.clinic, product, `LOC-${++seq}`, isoDaysFromToday(300)]));
    const [{ r: empty }] = await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,$3,'usable') as r", [op(), w.clinic, `Old fridge ${seq}`]));
    const [{ r: full }] = await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,$3,'usable') as r", [op(), w.clinic, `Main fridge ${seq}`]));
    await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,10,'DR-1',true)", [op(), w.clinic, full.locationId, lot.lotId]));
    await expectCode(as(w.inventory, (q) => q("select public.close_stock_location($1,$2,$3,'retired')", [op(), w.clinic, full.locationId])), "CV409");
    await expectCode(as(w.assistant, (q) => q("select public.close_stock_location($1,$2,$3,'retired')", [op(), w.clinic, empty.locationId])), "CV403");
    await as(w.inventory, (q) => q("select public.close_stock_location($1,$2,$3,'fridge broke down')", [op(), w.clinic, empty.locationId]));
    expect((await admin<{ status: string }>("select status from public.stock_locations where id = $1", [empty.locationId]))[0]!.status).toBe("closed");
    await expectCode(as(w.inventory, (q) => q("select public.close_stock_location($1,$2,$3,'again')", [op(), w.clinic, empty.locationId])), "CV409");
  });
});
