import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";
import { admin, as, expectCode, grant, makeClinic, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let seq = 0;
type R = { r: Record<string, unknown> };
let today: string;
let tomorrow: string;

beforeEach(() => {
  // A long DB suite can cross clinic-local midnight after this module was imported.
  today = isoDaysFromToday(0);
  tomorrow = isoDaysFromToday(1);
});

const mkSession = async (over: Partial<{ date: string; total: number; online: number; walkin: number; start: string; end: string }> = {}, clinic = w.clinic, actor: Actor = w.assistant) => {
  const s = { serviceDate: over.date ?? today, startTime: over.start ?? "00:00", endTime: over.end ?? "23:59", totalCapacity: over.total ?? 10, onlineCapacity: over.online ?? 8, walkinCapacity: over.walkin ?? 2 };
  const [{ r }] = await as(actor, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), clinic, JSON.stringify(s)]));
  if (s.serviceDate === today && over.start === undefined && over.end === undefined) {
    // These fixtures intend an open session, including the last minute of the day.
    // Explicit clock-time and expired-session cases keep their original timestamps.
    await admin("update public.clinic_sessions set ends_at = greatest(ends_at, now() + interval '1 hour') where id = $1", [r.sessionId]);
  }
  return r.sessionId as string;
};

/** A clinic-enrolled, identity-confirmed child, optionally with a verified guardian account. */
async function child(guardian?: Actor, clinic = w.clinic, staff: Actor = w.assistant) {
  const name = `Visit Kid ${++seq}`;
  if (guardian) {
    const [{ r }] = await as(guardian, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), clinic, JSON.stringify({ displayName: name, dob: isoDaysFromToday(-40) })]));
    await as(staff, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), clinic, r.childId]));
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [guardian.id, r.childId]);
    await as(staff, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), clinic, rel[0]!.id]));
    return r.childId as string;
  }
  const [{ r }] = await as(staff, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), clinic, JSON.stringify({ displayName: name, dob: isoDaysFromToday(-40) })]));
  return r.childId as string;
}
const book = (a: Actor, childId: string, session: string, rules: string[] = []) => as(a, (q) => q<R>("select public.book_appointment($1,$2,$3,null,$4) as r", [op(), childId, session, rules]));
const checkIn = (childId: string, opts: { appt?: string; overflow?: string; clinic?: string; actor?: Actor } = {}) =>
  as(opts.actor ?? w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,$4,$5) as r", [op(), opts.clinic ?? w.clinic, childId, opts.appt ?? null, opts.overflow ?? null]));
const transition = (entry: string, version: number, to: string, extra: { station?: string; reason?: string; outcome?: string; actor?: Actor } = {}) =>
  as(extra.actor ?? w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,$4,$5,$6,$7,$8) as r", [op(), w.clinic, entry, to, version, extra.station ?? null, extra.reason ?? null, extra.outcome ?? null]));
const count = async (sql: string, p: unknown[]) => Number((await admin<{ n: string }>(sql, p))[0]!.n);

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "visits-v1");
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("queue authorization before locks", () => {
  it("denies an unauthorized transition without waiting for a child's row lock", async () => {
    const childId = await child();
    const [{ r }] = await checkIn(childId, { overflow: "authorization lock regression" });
    const blocker = new pg.Client({ connectionString: pool.options.connectionString });
    await blocker.connect();
    try {
      await blocker.query("begin");
      await blocker.query("select id from public.children where id=$1 for update", [childId]);
      await expectCode(as(w.g1, async (q) => {
        await q("set local lock_timeout = '100ms'");
        return q("select public.queue_transition($1,$2,$3,'called',1)", [op(), w.clinic, r.queueEntryId]);
      }), "CV403");
    } finally {
      await blocker.query("rollback");
      await blocker.end();
    }
  });
});

describe("sessions", () => {
  it("only appointment managers create sessions, and capacities must be consistent", async () => {
    await expectCode(mkSession({}, w.clinic, w.inventory), "CV403");
    await expectCode(mkSession({}, w.clinic, w.g1), "CV403");
    await expectCode(mkSession({}, w.clinic, w.otherClinicStaff), "CV403");
    await expectCode(mkSession({ total: 5, online: 4, walkin: 2 }), "CV422"); // 4 + 2 > 5
    await expectCode(mkSession({ start: "10:00", end: "09:00" }), "CV422");
    await expectCode(as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: "not-a-date", startTime: "08:00", endTime: "12:00", totalCapacity: 1, onlineCapacity: 1, walkinCapacity: 0 })])), "CV422");
    await mkSession({ total: 0, online: 0, walkin: 0 }); // a closed-capacity session is legal
  });
  it("session times are interpreted in the clinic's timezone", async () => {
    const id = await mkSession({ date: tomorrow, start: "08:00", end: "12:00" });
    const [row] = await admin<{ s: string; e: string }>("select (starts_at at time zone 'Asia/Manila')::text s, (ends_at at time zone 'Asia/Manila')::text e from public.clinic_sessions where id = $1", [id]);
    expect(row!.s.endsWith("08:00:00")).toBe(true);
    expect(row!.e.endsWith("12:00:00")).toBe(true);
  });
  it("returns the booked session clinic's timezone with an appointment", async () => {
    await admin("update public.clinics set timezone = 'Pacific/Honolulu' where id = $1", [w.clinic]);
    const id = await mkSession({ date: tomorrow, start: "08:00", end: "12:00" });
    const kid = await child(w.g1);
    await book(w.g1, kid, id);
    const [{ r }] = await as(w.g1, (q) => q<{ r: { sessionId: string; clinicTimezone: string }[] }>("select public.my_appointments() as r"));
    expect(r.find((a) => a.sessionId === id)?.clinicTimezone).toBe("Pacific/Honolulu");
    await admin("update public.clinics set timezone = 'Asia/Manila' where id = $1", [w.clinic]);
  });
  it("guardians can list open sessions with room but never see bookings; anon cannot", async () => {
    const id = await mkSession({ date: tomorrow, total: 2, online: 1, walkin: 1 });
    const list = await as(w.g1, (q) => q<{ r: { sessionId: string; hasRoom: boolean; booked?: number }[] }>("select public.guardian_list_sessions($1,$2,$3) as r", [w.clinic, tomorrow, tomorrow]));
    const row = list[0]!.r.find((x) => x.sessionId === id)!;
    expect(row.hasRoom).toBe(true);
    expect(Object.keys(row).sort()).toEqual(["endsAt", "hasRoom", "serviceCode", "serviceDate", "sessionId", "startsAt"]);
    await expectCode(as(null, (q) => q("select public.guardian_list_sessions($1)", [w.clinic])), "42501");
  });
});

describe("booking and capacity (T02)", () => {
  it("a verified guardian cannot book a child into a clinic where the child is not enrolled", async () => {
    const s = await mkSession({ date: tomorrow }, w.otherClinic, w.otherClinicStaff);
    const k = await child(w.g1);
    await expectCode(book(w.g1, k, s), "CV404");
  });
  it("two guardians racing for the last slot: exactly one confirmed, the other told the session is full", async () => {
    const s = await mkSession({ total: 1, online: 1, walkin: 0, date: tomorrow });
    const c1 = await child(w.g1);
    const c2 = await child(w.g2);
    const results = await Promise.allSettled([book(w.g1, c1, s), book(w.g2, c2, s)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(lost.reason.code).toBe("CV409");
    expect(await count("select count(*) n from public.appointments where session_id = $1 and status = 'confirmed'", [s])).toBe(1);
  });
  it("many simultaneous bookings never exceed capacity", async () => {
    const s = await mkSession({ total: 3, online: 3, walkin: 0, date: tomorrow });
    const kids = await Promise.all(Array.from({ length: 8 }, () => child(w.g1)));
    const results = await Promise.allSettled(kids.map((k) => book(w.g1, k, s)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    expect(await count("select count(*) n from public.appointments where session_id = $1 and status = 'confirmed'", [s])).toBe(3);
  });
  it("enforces who may book: verified guardian or scoped staff; strangers, unverified guardians and other clinics cannot", async () => {
    const s = await mkSession({ date: tomorrow });
    const mine = await child(w.g1);
    await expectCode(book(w.g2, mine, s), "CV404"); // someone else's child
    const unverified = await child(w.g2);
    const [{ r }] = await as(w.g2, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Not Yet Verified", dob: isoDaysFromToday(-30) })]));
    await expectCode(book(w.g2, r.childId as string, s), "CV404"); // provisional guardian access is identity-only
    await expectCode(book(w.otherClinicStaff, mine, s), "CV404");
    await expectCode(book(w.inventory, mine, s), "CV404");
    const staff = await book(w.assistant, unverified, s);
    expect(staff[0]!.r.channel).toBe("assisted");
    const guardian = await book(w.g1, mine, s);
    expect(guardian[0]!.r.channel).toBe("online");
    await expectCode(as(null, (q) => q("select public.book_appointment($1,$2,$3)", [op(), mine, s])), "42501");
  });
  it("blocks duplicates, closed, cancelled and already-finished sessions", async () => {
    const s = await mkSession({ date: tomorrow });
    const k = await child(w.g1);
    await book(w.g1, k, s);
    await expectCode(book(w.g1, k, s), "CV409");
    const [{ id: past }] = await admin<{ id: string }>(
      "insert into public.clinic_sessions (organization_id, clinic_id, service_date, starts_at, ends_at, total_capacity, online_capacity, walkin_capacity) values ($1,$2,current_date - 3, now() - interval '3 days', now() - interval '3 days' + interval '1 hour', 5, 5, 0) returning id", [w.org, w.clinic]);
    await expectCode(book(w.g1, await child(w.g1), past), "CV409");
    const closed = await mkSession({ date: tomorrow });
    await as(w.assistant, (q) => q("select public.cancel_session($1,$2,$3,'clinic closed for training')", [op(), w.clinic, closed]));
    await expectCode(book(w.g1, await child(w.g1), closed), "CV409");
  });
  it("optional schedule requirements must exist in the version in force; booking never implies clinical clearance", async () => {
    const s = await mkSession({ date: tomorrow });
    const k = await child(w.g1);
    await expectCode(book(w.g1, k, s, ["NOPE"]), "CV422");
    const ok = await book(w.g1, k, s, ["A1", "G1"]);
    const items = await admin("select 1 from public.appointment_items where appointment_id = $1", [ok[0]!.r.appointmentId]);
    expect(items).toHaveLength(2);
    // a child whose A1 is overdue/not eligible can still be booked: booking is capacity, not eligibility (BP17)
    const k2 = await child(w.g1);
    expect((await book(w.g1, k2, s, ["A2"]))[0]!.r.status).toBe("confirmed");
  });
  it("is idempotent under retry and concurrent duplicates (T05/T06)", async () => {
    const s = await mkSession({ date: tomorrow });
    const k = await child(w.g1);
    const key = op();
    const call = () => as(w.g1, (q) => q<R>("select public.book_appointment($1,$2,$3) as r", [key, k, s]));
    const rs = await Promise.all([call(), call(), call()]);
    expect(new Set(rs.map((x) => x[0]!.r.appointmentId)).size).toBe(1);
    expect(await count("select count(*) n from public.appointments where child_id = $1", [k])).toBe(1);
    expect(await count("select count(*) n from private.outbox_jobs where dedupe_key = $1", ["appt-confirm:" + rs[0]![0]!.r.appointmentId])).toBe(1);
    await expectCode(as(w.g1, (q) => q("select public.book_appointment($1,$2,$3,'different reason')", [key, k, s])), "CV409");
  });
});

describe("cancel and reschedule", () => {
  it("cancelling releases the slot for someone else and withdraws the unsent confirmation; only confirmed bookings can be cancelled", async () => {
    const s = await mkSession({ total: 1, online: 1, walkin: 0, date: tomorrow });
    const c1 = await child(w.g1);
    const c2 = await child(w.g2);
    const a = (await book(w.g1, c1, s))[0]!.r.appointmentId as string;
    await expectCode(book(w.g2, c2, s), "CV409");
    await expectCode(as(w.g2, (q) => q("select public.cancel_appointment($1,$2)", [op(), a])), "CV404");
    await as(w.g1, (q) => q("select public.cancel_appointment($1,$2,'change of plans')", [op(), a]));
    const out = await admin<{ status: string }>("select status from private.outbox_jobs where dedupe_key = $1", ["appt-confirm:" + a]);
    expect(out[0]!.status).toBe("cancelled"); // obsolete message withdrawn (T26 spirit)
    await book(w.g2, c2, s);
    await expectCode(as(w.g1, (q) => q("select public.cancel_appointment($1,$2)", [op(), a])), "CV409");
  });
  it("reschedule is atomic: when the new session is full the original stays booked", async () => {
    const a = await mkSession({ date: tomorrow, total: 5, online: 5, walkin: 0 });
    const full = await mkSession({ date: tomorrow, total: 1, online: 1, walkin: 0 });
    const k = await child(w.g1);
    const other = await child(w.g2);
    await book(w.g2, other, full);
    const appt = (await book(w.g1, k, a))[0]!.r.appointmentId as string;
    await expectCode(as(w.g1, (q) => q("select public.reschedule_appointment($1,$2,$3)", [op(), appt, full])), "CV409");
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [appt]))[0]!.status).toBe("confirmed");
    expect(await count("select count(*) n from public.appointments where child_id = $1", [k])).toBe(1);
  });
  it("a successful move links the new booking to the old, frees the old slot and queues one confirmation", async () => {
    const a = await mkSession({ date: tomorrow, total: 1, online: 1, walkin: 0 });
    const b = await mkSession({ date: tomorrow, total: 3, online: 3, walkin: 0 });
    const k = await child(w.g1);
    const appt = (await book(w.g1, k, a))[0]!.r.appointmentId as string;
    const moved = await as(w.g1, (q) => q<R>("select public.reschedule_appointment($1,$2,$3,'work shift') as r", [op(), appt, b]));
    expect(moved[0]!.r).toMatchObject({ status: "confirmed", sessionId: b, replaces: appt });
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [appt]))[0]!.status).toBe("rescheduled");
    await book(w.g2, await child(w.g2), a); // old slot is free again
    expect(await count("select count(*) n from private.outbox_jobs where dedupe_key = $1", ["appt-confirm:" + moved[0]!.r.appointmentId])).toBe(1);
    await expectCode(as(w.g1, (q) => q("select public.reschedule_appointment($1,$2,$3)", [op(), moved[0]!.r.appointmentId, b])), "CV422"); // same session
  });
  it("opposite simultaneous moves do not deadlock", async () => {
    const a = await mkSession({ date: tomorrow, total: 4, online: 4, walkin: 0 });
    const b = await mkSession({ date: tomorrow, total: 4, online: 4, walkin: 0 });
    const k1 = await child(w.g1);
    const k2 = await child(w.g2);
    const a1 = (await book(w.g1, k1, a))[0]!.r.appointmentId as string;
    const a2 = (await book(w.g2, k2, b))[0]!.r.appointmentId as string;
    const results = await Promise.allSettled([
      as(w.g1, (q) => q("select public.reschedule_appointment($1,$2,$3)", [op(), a1, b])),
      as(w.g2, (q) => q("select public.reschedule_appointment($1,$2,$3)", [op(), a2, a])),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
  });
  it("cancelling a session cancels its bookings, tells each family, and creates follow-up work to rebook (0037)", async () => {
    const s = await mkSession({ date: tomorrow });
    const k1 = await child(w.g1);
    const k2 = await child(w.g2);
    await book(w.g1, k1, s);
    await book(w.g2, k2, s);
    await expectCode(as(w.inventory, (q) => q("select public.cancel_session($1,$2,$3,'weather')", [op(), w.clinic, s])), "CV403");
    await expectCode(as(w.assistant, (q) => q("select public.cancel_session($1,$2,$3,'')", [op(), w.clinic, s])), "CV422");
    const res = await as(w.assistant, (q) => q<R>("select public.cancel_session($1,$2,$3,'typhoon warning') as r", [op(), w.clinic, s]));
    expect(res[0]!.r.affectedBookings).toBe(2);
    // Families were told the visit will not take place, so their bookings no longer show as booked (0037).
    expect(await count("select count(*) n from public.appointments where session_id = $1 and status = 'confirmed'", [s])).toBe(0);
    expect(await count("select count(*) n from public.appointments where session_id = $1 and status = 'cancelled' and reason like 'Session cancelled: typhoon%'", [s])).toBe(2);
    const [{ r: mine }] = await as(w.g1, (q) => q<{ r: { childId: string; status: string }[] }>("select public.my_appointments() as r"));
    expect(mine.find((x) => x.childId === k1)?.status).toBe("cancelled");
    expect(await count("select count(*) n from public.record_review_cases where kind = 'appointment' and evidence ->> 'sessionId' = $1 and status = 'open'", [s])).toBe(2);
    expect(await count("select count(*) n from private.outbox_jobs where job_type = 'appointment.session_cancelled' and payload ->> 'sessionId' = $1", [s])).toBe(2);
  });
});

describe("check-in and ticket allocation (T-queue)", () => {
  it("serializes two last-slot walk-ins before either allocates a ticket", async () => {
    const clinic = await makeClinic(w.org, `Capacity race ${++seq}`);
    await grant(w.org, clinic, w.assistant, "assistant");
    await mkSession({ date: today, total: 1, online: 0, walkin: 1 }, clinic, w.assistant);
    const c1 = await child(undefined, clinic, w.assistant);
    const c2 = await child(undefined, clinic, w.assistant);
    const blocker = new pg.Client({ connectionString: pool.options.connectionString });
    await blocker.connect();
    try {
      await blocker.query("begin");
      await blocker.query("insert into private.queue_counters (clinic_id,service_date,next_no) values ($1,$2,1) on conflict do nothing", [clinic, today]);
      await blocker.query("select 1 from private.queue_counters where clinic_id = $1 and service_date = $2 for update", [clinic, today]);
      const calls = [checkIn(c1, { clinic }), checkIn(c2, { clinic })];
      // Both calls must reach their blocked lock before the counter is released.
      let blocked = 0;
      for (let n = 0; n < 100; n++) {
        blocked = Number((await admin<{ n: string }>("select count(*) n from pg_stat_activity where query like 'select public.check_in(%' and wait_event_type = 'Lock'"))[0]!.n);
        if (blocked >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBeGreaterThanOrEqual(2);
      await blocker.query("commit");
      const settled = await Promise.allSettled(calls);
      expect(settled.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect((settled.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.code).toBe("CV409");
      expect(await count("select count(*) n from public.queue_entries where clinic_id = $1 and service_date = $2 and walk_in", [clinic, today])).toBe(1);
    } finally {
      await blocker.query("rollback").catch(() => undefined);
      await blocker.end();
    }
  });
  it("rejects arrival against a cancelled session and keeps the booking on record as cancelled", async () => {
    const s = await mkSession({ date: today });
    const k = await child(w.g1);
    const a = (await book(w.g1, k, s))[0]!.r.appointmentId;
    await as(w.assistant, (q) => q("select public.cancel_session($1,$2,$3,'clinic closure')", [op(), w.clinic, s]));
    await expectCode(checkIn(k, { appt: a as string }), "CV409");
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [a]))[0]!.status).toBe("cancelled");
  });
  it("replays a successful arrival after the session is cancelled", async () => {
    const s = await mkSession({ date: today });
    const k = await child(w.g1);
    const a = (await book(w.g1, k, s))[0]!.r.appointmentId;
    const key = op();
    const arrive = () => as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,$4) as r", [key, w.clinic, k, a]));
    const first = (await arrive())[0]!.r;
    await as(w.assistant, (q) => q("select public.cancel_session($1,$2,$3,'clinic closure')", [op(), w.clinic, s]));
    expect((await arrive())[0]!.r).toEqual(first);
  });
  it("an appointment can be checked in only today, once, and only at its own clinic", async () => {
    const sToday = await mkSession({ date: today });
    const sTomorrow = await mkSession({ date: tomorrow });
    const k = await child(w.g1);
    const future = (await book(w.g1, k, sTomorrow))[0]!.r.appointmentId as string;
    await expectCode(checkIn(k, { appt: future }), "CV409");
    const k2 = await child(w.g1);
    const appt = (await book(w.g1, k2, sToday))[0]!.r.appointmentId as string;
    await expectCode(checkIn(k2, { appt, actor: w.otherClinicStaff, clinic: w.otherClinic }), "CV404");
    const t = await checkIn(k2, { appt });
    expect(t[0]!.r).toMatchObject({ walkIn: false, status: "waiting" });
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [appt]))[0]!.status).toBe("checked_in");
    await expectCode(checkIn(k2, { appt }), "CV409"); // already queued today
    await expectCode(checkIn(k, { actor: w.inventory }), "CV403");
  });

  it("allocates unique, gapless ticket numbers under concurrency; each clinic and day has its own counter", async () => {
    const w2 = await clinicalWorld();
    const s = await (async () => {
      const [{ r }] = await as(w2.assistant, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), w2.clinic, JSON.stringify({ serviceDate: today, startTime: "00:00", endTime: "23:59", totalCapacity: 20, onlineCapacity: 0, walkinCapacity: 20 })]));
      return r.sessionId;
    })();
    expect(s).toBeTruthy();
    const kids: string[] = [];
    for (let i = 0; i < 10; i++) {
      const [{ r }] = await as(w2.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w2.clinic, JSON.stringify({ displayName: `Ticket Kid ${i} ${++seq}`, dob: isoDaysFromToday(-50) })]));
      kids.push(r.childId as string);
    }
    const results = await Promise.all(kids.map((k) => as(w2.assistant, (q) => q<R>("select public.check_in($1,$2,$3) as r", [op(), w2.clinic, k]))));
    const nos = results.map((x) => x[0]!.r.ticketNo as number).sort((a, b) => a - b);
    expect(nos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // the first clinic still starts at its own counter
    const k = await child();
    await mkSession({ date: today, walkin: 5, online: 0, total: 5 });
    const own = await checkIn(k);
    expect(own[0]!.r.ticketNo).toBeLessThan(10);
  });

  it("walk-ins draw on the reserved allocation; overflow needs a recorded reason; numbers are never reused", async () => {
    const w3 = await clinicalWorld();
    const mk = async (i: number) => (await as(w3.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w3.clinic, JSON.stringify({ displayName: `Walkin ${i} ${++seq}`, dob: isoDaysFromToday(-60) })])))[0]!.r.childId as string;
    const ci = (c: string, overflow?: string) => as(w3.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,$4) as r", [op(), w3.clinic, c, overflow ?? null]));
    const [a, b, c, d] = [await mk(1), await mk(2), await mk(3), await mk(4)];
    await expectCode(ci(a), "CV409"); // no open session today -> nothing reserved
    await as(w3.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w3.clinic, JSON.stringify({ serviceDate: today, startTime: "00:00", endTime: "23:59", totalCapacity: 4, onlineCapacity: 2, walkinCapacity: 2 })]));
    const t1 = await ci(a);
    const t2 = await ci(b);
    expect([t1[0]!.r.ticketNo, t2[0]!.r.ticketNo]).toEqual([1, 2]);
    await expectCode(ci(c), "CV409"); // allocation used up
    await expectCode(ci(c, "x"), "CV409"); // reason too short
    const t3 = await ci(c, "family travelled far; clinic lead agreed");
    expect(t3[0]!.r.ticketNo).toBe(3);
    // cancel a ticket: its number is not reused
    const entry = await admin<{ id: string; version: number }>("select id, version from public.queue_entries where child_id = $1", [a]);
    await as(w3.assistant, (q) => q("select public.queue_transition($1,$2,$3,'cancelled',$4,null,'family went home')", [op(), w3.clinic, entry[0]!.id, entry[0]!.version]));
    const t4 = await ci(d, "overflow again, approved by lead");
    expect(t4[0]!.r.ticketNo).toBe(4);
    const audit = await admin("select 1 from private.audit_logs where action = 'queue.checked_in' and reason like 'family travelled%'");
    expect(audit).toHaveLength(1);
  });

  it("refuses children of another clinic and merged records resolve to the survivor", async () => {
    await mkSession({ date: today, walkin: 3, online: 0, total: 3 });
    const foreign = await child(undefined, w.otherClinic, w.otherClinicStaff);
    await expectCode(checkIn(foreign), "CV404");
    const a = await child();
    const b = await child();
    await as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'same child confirmed by parent')", [op(), w.clinic, a, b]));
    const t = await checkIn(b); // the merged alias checks in as the survivor
    const row = await admin<{ child_id: string }>("select child_id from public.queue_entries where id = $1", [t[0]!.r.queueEntryId]);
    expect(row[0]!.child_id).toBe(a);
  });
});

describe("queue state machine and encounters", () => {
  it("runs the legal path, creates the encounter at service start and closes appointment as fulfilled with an outcome", async () => {
    const s = await mkSession({ date: today });
    expect(s).toBeTruthy();
    const k = await child(w.g1);
    const appt = (await book(w.g1, k, s))[0]!.r.appointmentId as string;
    const ci = (await checkIn(k, { appt }))[0]!.r;
    const id = ci.queueEntryId as string;
    let v = ci.version as number;
    const called = await transition(id, v, "called", { station: "Station 1" });
    v = called[0]!.r.version as number;
    const started = await transition(id, v, "in_service");
    v = started[0]!.r.version as number;
    const encounterId = started[0]!.r.encounterId as string;
    expect(encounterId).toBeTruthy();
    expect((await admin<{ status: string }>("select status from public.encounters where id = $1", [encounterId]))[0]!.status).toBe("open");
    await expectCode(transition(id, v, "completed"), "CV422"); // outcome is required
    const done = await transition(id, v, "completed", { outcome: "vaccinated" });
    expect(done[0]!.r.status).toBe("completed");
    const enc = await admin<{ status: string; outcome: string; ended_at: string | null }>("select status, outcome, ended_at from public.encounters where id = $1", [encounterId]);
    expect(enc[0]).toMatchObject({ status: "completed", outcome: "vaccinated" });
    expect(enc[0]!.ended_at).toBeTruthy();
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [appt]))[0]!.status).toBe("fulfilled");
    const events = await admin<{ to_status: string }>("select to_status from public.queue_events where queue_entry_id = $1 order by occurred_at, id", [id]);
    expect(events.map((e) => e.to_status)).toEqual(["waiting", "called", "in_service", "completed"]);
    await expect(admin("update public.queue_events set to_status = 'waiting' where queue_entry_id = $1", [id])).rejects.toMatchObject({ code: "CV403" });
    // a fulfilled ticket is terminal
    await expectCode(transition(id, done[0]!.r.version as number, "waiting"), "CV409");
  });

  it("rejects illegal transitions, stale versions and missing reasons; deferral is a fulfilled outcome, not a vaccination", async () => {
    await mkSession({ date: today, walkin: 6, online: 0, total: 6 });
    const k = await child();
    const ci = (await checkIn(k))[0]!.r;
    const id = ci.queueEntryId as string;
    const v = ci.version as number;
    await expectCode(transition(id, v, "completed", { outcome: "vaccinated" }), "CV409"); // waiting -> completed is not allowed
    await expectCode(transition(id, v, "in_service"), "CV409"); // must be called first
    await expectCode(transition(id, 999, "called"), "CV409"); // stale
    await expectCode(transition(id, v, "left"), "CV422"); // reason required
    const called = await transition(id, v, "called", { station: "S2" });
    const recalled = await transition(id, called[0]!.r.version as number, "called", { station: "S2" }); // re-call is an event
    const held = await transition(id, recalled[0]!.r.version as number, "held", { reason: "did not respond to two calls" });
    const back = await transition(id, held[0]!.r.version as number, "waiting");
    const c2 = await transition(id, back[0]!.r.version as number, "called");
    const s2 = await transition(id, c2[0]!.r.version as number, "in_service");
    await expectCode(transition(id, s2[0]!.r.version as number, "deferred", { outcome: "vaccinated" }), "CV422"); // deferral cannot claim vaccination
    const def = await transition(id, s2[0]!.r.version as number, "deferred", { outcome: "deferred" });
    expect(def[0]!.r.status).toBe("deferred");
    expect((await admin<{ outcome: string }>("select outcome from public.encounters where id = $1", [s2[0]!.r.encounterId]))[0]!.outcome).toBe("deferred");
    const ev = await admin("select 1 from public.queue_events where queue_entry_id = $1", [id]);
    expect(ev.length).toBe(8);
  });

  it("a ticket that leaves returns its appointment to 'confirmed' so the family can be checked in again", async () => {
    const s = await mkSession({ date: today });
    const k = await child(w.g1);
    const appt = (await book(w.g1, k, s))[0]!.r.appointmentId as string;
    const ci = (await checkIn(k, { appt }))[0]!.r;
    await transition(ci.queueEntryId as string, ci.version as number, "left", { reason: "child fell asleep; going home" });
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [appt]))[0]!.status).toBe("confirmed");
    const again = await checkIn(k, { appt });
    expect(again[0]!.r.ticketNo).toBeGreaterThan(ci.ticketNo as number);
  });

  it("call_next serves priority first, then longest waiting; two stations never get the same patient; empty queue reports nobody", async () => {
    const w4 = await clinicalWorld();
    await as(w4.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w4.clinic, JSON.stringify({ serviceDate: today, startTime: "00:00", endTime: "23:59", totalCapacity: 10, onlineCapacity: 0, walkinCapacity: 10 })]));
    const ids: { entry: string; version: number; ticketNo: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const [{ r: ch }] = await as(w4.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w4.clinic, JSON.stringify({ displayName: `Calling ${i} ${++seq}`, dob: isoDaysFromToday(-45) })]));
      const [{ r }] = await as(w4.assistant, (q) => q<R>("select public.check_in($1,$2,$3) as r", [op(), w4.clinic, ch.childId]));
      ids.push({ entry: r.queueEntryId as string, version: r.version as number, ticketNo: r.ticketNo as number });
    }
    await expectCode(as(w4.assistant, (q) => q("select public.set_queue_priority($1,$2,$3,'priority','')", [op(), w4.clinic, ids[2]!.entry])), "CV422");
    await as(w4.assistant, (q) => q("select public.set_queue_priority($1,$2,$3,'priority','frail infant, per nurse')", [op(), w4.clinic, ids[2]!.entry]));
    const first = await as(w4.assistant, (q) => q<R>("select public.call_next($1,$2,'Station 1') as r", [op(), w4.clinic]));
    expect(first[0]!.r.ticket).toMatch(/-003$/); // the prioritised ticket
    const both = await Promise.all([
      as(w4.assistant, (q) => q<R>("select public.call_next($1,$2,'Station 1') as r", [op(), w4.clinic])),
      as(w4.clinician, (q) => q<R>("select public.call_next($1,$2,'Station 2') as r", [op(), w4.clinic])),
    ]);
    expect(new Set(both.map((x) => x[0]!.r.queueEntryId)).size).toBe(2);
    const last = await as(w4.assistant, (q) => q<R>("select public.call_next($1,$2,'Station 1') as r", [op(), w4.clinic]));
    expect(last[0]!.r.called).toBe(true);
    const none = await as(w4.assistant, (q) => q<R>("select public.call_next($1,$2,'Station 1') as r", [op(), w4.clinic]));
    expect(none[0]!.r).toEqual({ called: false });
    const audited = await admin("select 1 from private.audit_logs where action = 'queue.priority_changed'");
    expect(audited.length).toBeGreaterThan(0);
  });
});

describe("merge integrity", () => {
  it("resolves same-session booking collisions with an auditable cancellation", async () => {
    const survivor = await child();
    const duplicate = await child();
    const s = await mkSession({ date: tomorrow });
    const keep = (await book(w.assistant, survivor, s))[0]!.r.appointmentId;
    const lose = (await book(w.assistant, duplicate, s))[0]!.r.appointmentId;
    await as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed duplicate identity')", [op(), w.clinic, survivor, duplicate]));
    expect((await admin<{ id: string }>("select id from public.appointments where id = $1 and child_id = $2 and status = 'confirmed'", [keep, survivor]))).toHaveLength(1);
    expect((await admin<{ status: string }>("select status from public.appointments where id = $1", [lose]))[0]!.status).toBe("cancelled");
    expect(await count("select count(*) n from private.audit_logs where action = 'appointment.merge_collision' and entity_id = $1", [lose])).toBe(1);
  });

  it("refuses a merge while either child has an open encounter", async () => {
    const survivor = await child();
    const duplicate = await child();
    const ticket = (await checkIn(duplicate, { overflow: "extra arrivals" }))[0]!.r;
    const called = (await transition(ticket.queueEntryId as string, ticket.version as number, "called"))[0]!.r;
    await transition(ticket.queueEntryId as string, called.version as number, "in_service");
    await expectCode(as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed duplicate identity')", [op(), w.clinic, survivor, duplicate])), "CV409");
  });
  it("moves the duplicate's confirmed booking and live ticket to the surviving child", async () => {
    const survivor = await child();
    const duplicate = await child();
    const s = await mkSession({ date: tomorrow });
    const appt = (await book(w.assistant, duplicate, s))[0]!.r.appointmentId;
    const ticket = (await checkIn(duplicate, { overflow: "extra arrivals" }))[0]!.r.queueEntryId;
    await as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed duplicate identity')", [op(), w.clinic, survivor, duplicate]));
    expect((await admin<{ child_id: string }>("select child_id from public.appointments where id = $1", [appt]))[0]!.child_id).toBe(survivor);
    expect((await admin<{ child_id: string }>("select child_id from public.queue_entries where id = $1", [ticket]))[0]!.child_id).toBe(survivor);
  });

  it("refuses a merge when both records have live tickets for the same clinic day", async () => {
    const survivor = await child();
    const duplicate = await child();
    await checkIn(survivor, { overflow: "extra arrivals" });
    await checkIn(duplicate, { overflow: "extra arrivals" });
    await expectCode(as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed duplicate identity')", [op(), w.clinic, survivor, duplicate])), "CV409");
  });
});

describe("views and privacy", () => {
  it("staff see names; only queue/appointment staff may list; direct table access is denied", async () => {
    await mkSession({ date: today, walkin: 3, online: 0, total: 3 });
    const k = await child();
    await checkIn(k);
    const q = await as(w.assistant, (x) => x<{ r: { childName: string }[] }>("select public.list_queue($1) as r", [w.clinic]));
    expect(q[0]!.r.some((e) => e.childName.startsWith("Visit Kid"))).toBe(true);
    await expectCode(as(w.inventory, (x) => x("select public.list_queue($1)", [w.clinic])), "CV403");
    await expectCode(as(w.otherClinicStaff, (x) => x("select public.list_queue($1)", [w.clinic])), "CV403");
    await expectCode(as(w.g1, (x) => x("select public.list_appointments($1)", [w.clinic])), "CV403");
    for (const t of ["clinic_sessions", "appointments", "queue_entries", "queue_events", "encounters"]) await expectCode(as(w.assistant, (x) => x(`select * from public.${t}`)), "42501");
  });

  it("the waiting-room display exposes ticket numbers and stations only", async () => {
    const w5 = await clinicalWorld();
    await as(w5.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w5.clinic, JSON.stringify({ serviceDate: today, startTime: "00:00", endTime: "23:59", totalCapacity: 5, onlineCapacity: 0, walkinCapacity: 5 })]));
    const [{ r: ch }] = await as(w5.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w5.clinic, JSON.stringify({ displayName: "Zebulon Secretname", dob: isoDaysFromToday(-30) })]));
    await as(w5.assistant, (q) => q("select public.check_in($1,$2,$3)", [op(), w5.clinic, ch.childId]));
    await as(w5.assistant, (q) => q("select public.call_next($1,$2,'Station 9')", [op(), w5.clinic]));
    await as(w5.assistant, (q) => q("select public.register_child_staff($1,$2,$3,null,true,true)", [op(), w5.clinic, JSON.stringify({ displayName: "Other Person", dob: isoDaysFromToday(-31) })]));
    const disp = await as(null, (q) => q<{ r: { nowCalling: { ticket: string; station: string }[]; waiting: string[] } }>("select public.public_queue_display($1) as r", [w5.clinic]));
    expect(disp[0]!.r.nowCalling).toHaveLength(1);
    expect(disp[0]!.r.nowCalling[0]!.station).toBe("Station 9");
    const text = JSON.stringify(disp[0]!.r);
    expect(text).not.toMatch(/Zebulon|Secretname|Other Person|dob|record/i);
    expect((await as(null, (q) => q<{ r: unknown }>("select public.public_queue_display($1) as r", [crypto.randomUUID()])))[0]!.r).toBeNull();
  });

  it("guardians see only their own child's ticket with people ahead; others and anonymous get nothing", async () => {
    const w6 = await clinicalWorld();
    await as(w6.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w6.clinic, JSON.stringify({ serviceDate: today, startTime: "00:00", endTime: "23:59", totalCapacity: 9, onlineCapacity: 0, walkinCapacity: 9 })]));
    const mine = await child(w6.g1, w6.clinic, w6.assistant);
    for (let i = 0; i < 2; i++) {
      const [{ r: ch }] = await as(w6.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w6.clinic, JSON.stringify({ displayName: `Ahead ${i} ${++seq}`, dob: isoDaysFromToday(-30) })]));
      await as(w6.assistant, (q) => q("select public.check_in($1,$2,$3)", [op(), w6.clinic, ch.childId]));
    }
    await as(w6.assistant, (q) => q("select public.check_in($1,$2,$3)", [op(), w6.clinic, mine]));
    const st = await as(w6.g1, (q) => q<{ r: { peopleAhead: number; status: string; ticket: string } }>("select public.guardian_queue_status($1) as r", [mine]));
    expect(st[0]!.r).toMatchObject({ status: "waiting", peopleAhead: 2 });
    expect((await as(w6.g2, (q) => q<{ r: unknown }>("select public.guardian_queue_status($1) as r", [mine])))[0]!.r).toBeNull();
    await expectCode(as(null, (q) => q("select public.guardian_queue_status($1)", [mine])), "42501");
    const other = await newUser("strangerq");
    await grant(w6.org, w6.clinic, other, "assistant");
    expect((await as(other, (q) => q<{ r: unknown }>("select public.guardian_queue_status($1) as r", [mine])))[0]!.r).toBeNull(); // staff role gives no guardian view
  });
});
