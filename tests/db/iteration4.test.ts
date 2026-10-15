import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";
import { loadRpcAllowlist } from "../../scripts/build-supabase-install";

// Migration 0040 (docs/engineering/audit.md "Iteration 4"): I4-03 last-holder guard, I4-04 unused commands revoked,
// I4-05 stable duplicate-booking hint, I4-06 staff-application escalation probes.

type R = { r: Record<string, unknown> };
const revoke = (actor: Actor, id: string, key = op(), reason = "left the health center") =>
  as(actor, (q) => q<{ r: { membershipId: string; status: string } }>("select public.revoke_staff_membership($1,$2,$3) as r", [key, id, reason])).then((x) => x[0].r);
const status = async (id: string) => (await admin<{ status: string }>("select status from public.staff_memberships where id = $1", [id]))[0].status;
/** Rejection with SQLSTATE and hint, for asserting the stable hint the application branches on. */
async function failure(p: Promise<unknown>): Promise<{ code?: string; hint?: string; message: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code?: string; hint?: string; message: string };
  }
  throw new Error("expected the call to fail, but it succeeded");
}

afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("I4-03 a revoke cannot leave a health center unable to grant access", () => {
  let org: string;
  const STAFF = /without two different people who can request and approve staff access/i;
  const CLINICAL = /without two different people who can request and approve clinical access/i;
  beforeAll(async () => {
    org = await makeOrg("Last holder org");
  });
  /** Concurrent transaction as an API user, held open until the caller commits or rolls back. */
  const open = async (actor: Actor) => {
    const c = await pool.connect();
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: actor.id, role: "authenticated", aal: "aal2" })]);
    return c;
  };

  it("revoking one of two access administrators is allowed while a different person can still request; the last approver is refused", async () => {
    const clinic = await makeClinic(org, "Two admins");
    const [a, b, lead] = await Promise.all(["lh-admin-a", "lh-admin-b", "lh-admin-lead"].map(newUser));
    const ma = await grant(org, clinic, a, "tech_admin");
    const mb = await grant(org, clinic, b, "tech_admin");
    await grant(org, clinic, lead, "clinical_lead");
    const key = op();
    expect((await revoke(a, mb, key)).status).toBe("revoked"); // A approves, the lead requests: still possible
    // A is now the only holder of admin.users: nobody else could approve a non-clinical grant, so A's own revoke is refused.
    const e = await failure(revoke(a, ma));
    expect(e.code).toBe("CV409");
    expect(e.hint).toBe("cvsrs:last_access_holder");
    expect(e.message).toMatch(STAFF);
    expect(await status(ma)).toBe("active");
    // Replaying the earlier successful revoke returns the stored result; the guard does not change idempotent replay.
    expect(await revoke(a, mb, key)).toEqual({ membershipId: mb, status: "revoked" });
    expect(await admin("select 1 from private.audit_logs where action = 'staff_membership.revoked' and entity_id = $1", [ma])).toHaveLength(0);
  });

  it("two distinct access administrators and two distinct clinical approvers: revoking one of each is allowed", async () => {
    const clinic = await makeClinic(org, "Full house");
    const [a1, a2, l1, l2] = await Promise.all(["lh-fh-a1", "lh-fh-a2", "lh-fh-l1", "lh-fh-l2"].map(newUser));
    await grant(org, clinic, a1, "tech_admin");
    const ma2 = await grant(org, clinic, a2, "tech_admin");
    await grant(org, clinic, l1, "clinical_lead");
    const ml2 = await grant(org, clinic, l2, "clinical_lead");
    expect((await revoke(a1, ma2)).status).toBe("revoked");
    expect((await revoke(l1, ml2)).status).toBe("revoked");
  });

  it("the last clinical approver is protected the same way; an explicit capability makes a replacement", async () => {
    const clinic = await makeClinic(org, "Two leads");
    const [l1, l2, admin1] = await Promise.all(["lh-lead-1", "lh-lead-2", "lh-admin"].map(newUser));
    const m1 = await grant(org, clinic, l1, "clinical_lead");
    const m2 = await grant(org, clinic, l2, "clinical_lead");
    await grant(org, clinic, admin1, "tech_admin");
    expect((await revoke(l1, m2)).status).toBe("revoked");
    const e = await failure(revoke(l1, m1));
    expect(e).toMatchObject({ code: "CV409", hint: "cvsrs:last_access_holder" });
    expect(e.message).toMatch(CLINICAL);
    const helper = await newUser("lh-clinical-helper");
    await grant(org, clinic, helper, "assistant", ["grant.approve.clinical"]);
    expect((await revoke(l1, m1)).status).toBe("revoked");
  });

  it("counts people, not memberships: one person holding both capabilities cannot be left alone (extra capability)", async () => {
    // Reviewer's case: A is tech_admin with an extra grant.approve.clinical, L is clinical lead. Without L, A would hold every
    // capability but could approve nothing (the approver must differ from the requester and the grantee).
    const clinic = await makeClinic(org, "One person, extra capability");
    const [a, l] = await Promise.all(["lh-extra-a", "lh-extra-l"].map(newUser));
    await grant(org, clinic, a, "tech_admin", ["grant.approve.clinical"]);
    const ml = await grant(org, clinic, l, "clinical_lead");
    expect(await failure(revoke(a, ml))).toMatchObject({ code: "CV409", hint: "cvsrs:last_access_holder" });
    expect(await status(ml)).toBe("active");
  });

  it("counts people, not memberships: one person with two memberships cannot be left alone, but may drop one of their own", async () => {
    const clinic = await makeClinic(org, "One person, two memberships");
    const [a, l] = await Promise.all(["lh-two-a", "lh-two-l"].map(newUser));
    await grant(org, clinic, a, "tech_admin");
    const maLead = await grant(org, clinic, a, "clinical_lead");
    const ml = await grant(org, clinic, l, "clinical_lead");
    expect(await failure(revoke(a, ml))).toMatchObject({ code: "CV409", hint: "cvsrs:last_access_holder" });
    expect(await status(ml)).toBe("active");
    // A dropping their own clinical lead role keeps both paths: A approves technical grants (L requests), L approves clinical ones.
    expect((await revoke(a, maLead)).status).toBe("revoked");
  });

  it("pending, suspended, expired and suspended-account memberships are not counted; a health center that already cannot grant is not blocked", async () => {
    const clinic = await makeClinic(org, "Only one real admin");
    const [a, lead, pendingHire, suspendedAdmin, expiredAdmin, lockedAdmin] = await Promise.all(
      ["lh-only", "lh-only-lead", "lh-pending", "lh-susp", "lh-expired", "lh-locked"].map(newUser));
    const ma = await grant(org, clinic, a, "tech_admin");
    await grant(org, clinic, lead, "clinical_lead");
    const ms = await grant(org, clinic, suspendedAdmin, "tech_admin");
    await admin("update public.staff_memberships set status = 'suspended' where id = $1", [ms]);
    const me = await grant(org, clinic, expiredAdmin, "tech_admin");
    await admin("update public.staff_memberships set valid_from = now() - interval '2 days', valid_until = now() - interval '1 day' where id = $1", [me]);
    await grant(org, clinic, lockedAdmin, "tech_admin");
    await admin("update public.profiles set status = 'suspended' where id = $1", [lockedAdmin.id]);
    const [{ r }] = await as(a, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'tech_admin') as r", [op(), clinic, pendingHire.id]));
    expect(await failure(revoke(a, ma))).toMatchObject({ code: "CV409" }); // none of the four other admins counts
    // Closing a pending request or a suspended membership is still allowed (they hold nothing).
    expect((await revoke(a, r.membershipId)).status).toBe("revoked");
    expect((await revoke(a, ms)).status).toBe("revoked");
    expect(await status(ma)).toBe("active");

    // A health center with a single administrator and nobody else already cannot grant anything: the revoke makes nothing worse.
    const lonely = await makeClinic(org, "Already stuck");
    const solo = await newUser("lh-solo");
    const mSolo = await grant(org, lonely, solo, "tech_admin");
    expect((await revoke(solo, mSolo)).status).toBe("revoked");
  });

  it("two concurrent revokes that are each allowed alone cannot together leave the health center unable to grant", async () => {
    // L (clinical lead) revokes T1 and T2, the only admin.users holders (assistants with explicit admin.users plus a clinical
    // capability, so revoking them needs L). Either alone is fine; both would leave no approver for technical grants.
    const clinic = await makeClinic(org, "Concurrent pair");
    const [l, t1, t2] = await Promise.all(["lh-pair-l", "lh-pair-t1", "lh-pair-t2"].map(newUser));
    await grant(org, clinic, l, "clinical_lead");
    const m1 = await grant(org, clinic, t1, "assistant", ["admin.users", "evidence.verify"]);
    const m2 = await grant(org, clinic, t2, "assistant", ["admin.users", "evidence.verify"]);
    const c1 = await open(l);
    const c2 = await open(l);
    try {
      await c1.query("select public.revoke_staff_membership($1,$2,'pair test')", [op(), m1]);
      let settled = false;
      const second = c2.query("select public.revoke_staff_membership($1,$2,'pair test')", [op(), m2]).then(
        () => ({ ok: true as const, code: "" }),
        (e: { code?: string; hint?: string }) => ({ ok: false as const, code: `${e.code}:${e.hint}` }),
      ).finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false); // serialized on the clinic row
      await c1.query("commit");
      expect(await second).toEqual({ ok: false, code: "CV409:cvsrs:last_access_holder" }); // re-evaluated after T1's revoke committed
      await c2.query("rollback");
    } finally {
      await c1.query("rollback").catch(() => undefined);
      await c2.query("rollback").catch(() => undefined);
      c1.release();
      c2.release();
    }
    expect([await status(m1), await status(m2)]).toEqual(["revoked", "active"]);
  });

  it("two administrators revoking each other at the same moment cannot both succeed", async () => {
    const clinic = await makeClinic(org, "Mutual revoke");
    const [a, b, lead] = await Promise.all(["lh-mutual-a", "lh-mutual-b", "lh-mutual-lead"].map(newUser));
    const ma = await grant(org, clinic, a, "tech_admin");
    const mb = await grant(org, clinic, b, "tech_admin");
    await grant(org, clinic, lead, "clinical_lead"); // so that either revoke alone is allowed
    const c1 = await open(b);
    const c2 = await open(a);
    try {
      await c1.query("select public.revoke_staff_membership($1,$2,'mutual test')", [op(), ma]);
      let settled = false;
      const second = c2.query("select public.revoke_staff_membership($1,$2,'mutual test')", [op(), mb]).then(
        () => ({ ok: true as const }),
        (e: { code?: string }) => ({ ok: false as const, code: e.code }),
      ).finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 400));
      expect(settled).toBe(false);
      await c1.query("commit");
      const out = await second;
      expect(out.ok).toBe(false);
      // A lost their own access when B's revoke committed, so the re-check after the wait refuses (CV403); either refusal is safe.
      expect(["CV403", "CV409"]).toContain(out.ok ? "" : out.code);
      await c2.query("rollback");
    } finally {
      await c1.query("rollback").catch(() => undefined);
      await c2.query("rollback").catch(() => undefined);
      c1.release();
      c2.release();
    }
    expect([await status(ma), await status(mb)].sort()).toEqual(["active", "revoked"]);
  });

  it("revoking an ordinary staff member is unaffected", async () => {
    const clinic = await makeClinic(org, "Ordinary staff");
    const [a, lead, nurse] = await Promise.all(["lh-ord-admin", "lh-ord-lead", "lh-ord-nurse"].map(newUser));
    await grant(org, clinic, a, "tech_admin");
    await grant(org, clinic, lead, "clinical_lead");
    const mn = await grant(org, clinic, nurse, "clinical_staff");
    expect((await revoke(lead, mn)).status).toBe("revoked");
  });
});

describe("I4-04 superseded commands are not executable by API roles", () => {
  it("acknowledge_privacy_notice and record_report_export are revoked from anon and authenticated", async () => {
    for (const sig of ["public.acknowledge_privacy_notice(uuid,uuid,text,text)", "public.record_report_export(uuid,uuid,text,date,date)"]) {
      const [row] = await admin<{ a: boolean; n: boolean; s: boolean }>(
        "select has_function_privilege('authenticated', $1, 'execute') a, has_function_privilege('anon', $1, 'execute') n, has_function_privilege('service_role', $1, 'execute') s", [sig]);
      expect(row).toEqual({ a: false, n: false, s: false });
    }
    const u = await newUser("i4-04");
    await expectCode(as(u, (q) => q("select public.acknowledge_privacy_notice($1,$2,'v1')", [op(), randomUUID()])), "42501");
    await expectCode(as(u, (q) => q("select public.record_report_export($1,$2,'daily_activity',current_date,current_date)", [op(), randomUUID()])), "42501");
  });

  it("the public functions executable by authenticated are exactly the application's RPC allowlist", async () => {
    const rows = await admin<{ proname: string }>(
      `select distinct p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`);
    expect(rows.map((r) => r.proname).sort()).toEqual(loadRpcAllowlist());
  });
});

describe("I4-05 duplicate-session booking carries a stable hint", () => {
  let w: ClinicalWorld;
  const session = async (date: string) => {
    const [{ r }] = await as(w.assistant, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), w.clinic,
      JSON.stringify({ serviceDate: date, startTime: "08:00", endTime: "12:00", totalCapacity: 10, onlineCapacity: 8, walkinCapacity: 2 })]));
    return r.sessionId as string;
  };
  beforeAll(async () => {
    w = await clinicalWorld();
  });

  it("booking the same child twice into one session, or moving into a session it is already booked in", async () => {
    const [{ r: kid }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r",
      [op(), w.clinic, JSON.stringify({ displayName: "Hint Kid", dob: isoDaysFromToday(-40) })]));
    const s1 = await session(isoDaysFromToday(2));
    const s2 = await session(isoDaysFromToday(3));
    const book = (s: string) => as(w.assistant, (q) => q<R>("select public.book_appointment($1,$2,$3) as r", [op(), kid.childId, s])).then((x) => x[0].r);
    const first = await book(s1);
    const dup = await failure(book(s1));
    expect(dup).toMatchObject({ code: "CV409", hint: "cvsrs:duplicate_session_booking" });
    await book(s2);
    const move = await failure(as(w.assistant, (q) => q("select public.reschedule_appointment($1,$2,$3)", [op(), first.appointmentId, s2])));
    expect(move).toMatchObject({ code: "CV409", hint: "cvsrs:duplicate_session_booking" });
    // Other conflicts keep no hint (the application words them as ordinary conflicts).
    await admin("update public.clinic_sessions set online_capacity = 0 where id = $1", [s1]);
    const [{ r: kid2 }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r",
      [op(), w.clinic, JSON.stringify({ displayName: "Hint Kid Two", dob: isoDaysFromToday(-40) })]));
    const full = await failure(as(w.assistant, (q) => q("select public.book_appointment($1,$2,$3)", [op(), kid2.childId, s1])));
    expect(full.code).toBe("CV409");
    expect(full.hint).toBeUndefined();
  });
});

describe("I4-06 staff applications and access requests cannot escalate", () => {
  let org: string, otherOrg: string, clinic: string, foreignClinic: string;
  let t1: Actor, t2: Actor, lead: Actor, foreignAdmin: Actor;
  const submit = (u: Actor, c: string, role: string) =>
    as(u, (q) => q<{ r: { applicationId: string } }>("select public.submit_staff_application($1,$2,$3,null,null) as r", [op(), c, role])).then((x) => x[0].r.applicationId);
  const version = async (id: string) => (await admin<{ version: number }>("select version from public.staff_applications where id = $1", [id]))[0].version;
  const accept = (actor: Actor, c: string, id: string, v: number, role: string | null = null, caps: string[] = []) =>
    as(actor, (q) => q<{ r: { membershipId: string; requiresClinicalApproval: boolean } }>("select public.accept_staff_application($1,$2,$3,$4,$5,$6) as r", [op(), c, id, v, role, caps])).then((x) => x[0].r);
  const approve = (actor: Actor, membershipId: string) => as(actor, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), membershipId]));

  beforeAll(async () => {
    org = await makeOrg("Escalation org");
    otherOrg = await makeOrg("Other escalation org");
    clinic = await makeClinic(org, "Escalation clinic");
    foreignClinic = await makeClinic(otherOrg, "Foreign clinic");
    [t1, t2, lead, foreignAdmin] = await Promise.all(["esc-t1", "esc-t2", "esc-lead", "esc-foreign"].map(newUser));
    await grant(org, clinic, t1, "tech_admin");
    await grant(org, clinic, t2, "tech_admin");
    await grant(org, clinic, lead, "clinical_lead");
    await grant(otherOrg, foreignClinic, foreignAdmin, "tech_admin");
  });

  it("applying for a privileged role is allowed by design, but access still needs two other people", async () => {
    for (const role of ["tech_admin", "clinical_lead"]) {
      const u = await newUser(`esc-applicant-${role}`);
      const id = await submit(u, clinic, role);
      // The applicant has no capability anywhere, so cannot decide the application or approve anything.
      await expectCode(accept(u, clinic, id, await version(id)), "CV403");
      const r = await accept(t1, clinic, id, await version(id));
      await expectCode(approve(u, r.membershipId), "CV403"); // the grantee
      await expectCode(approve(t1, r.membershipId), "CV403"); // the requester (the accepting administrator)
      if (role === "clinical_lead") {
        expect(r.requiresClinicalApproval).toBe(true);
        await expectCode(approve(t2, r.membershipId), "CV403"); // a technical administrator cannot approve clinical access
        await approve(lead, r.membershipId);
      } else {
        expect(r.requiresClinicalApproval).toBe(false);
        await approve(t2, r.membershipId);
      }
      expect((await admin<{ status: string; requested_by: string; approved_by: string }>("select status, requested_by, approved_by from public.staff_memberships where id = $1", [r.membershipId]))[0])
        .toMatchObject({ status: "active", requested_by: t1.id });
    }
  });

  it("an administrator who files a request for their own access cannot approve it", async () => {
    const clinic2 = await makeClinic(org, "Self request clinic");
    await grant(org, clinic2, t1, "tech_admin");
    await grant(org, clinic2, t2, "tech_admin");
    const [{ r }] = await as(t1, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'inventory') as r", [op(), clinic2, t1.id]));
    await expectCode(approve(t1, r.membershipId), "CV403");
    await approve(t2, r.membershipId);
  });

  it("capabilities added when accepting cannot skip the clinical approver", async () => {
    const u = await newUser("esc-caps");
    const id = await submit(u, clinic, "assistant");
    const r = await accept(t1, clinic, id, await version(id), "assistant", ["grant.approve.clinical", "admin.users"]);
    expect(r.requiresClinicalApproval).toBe(true);
    await expectCode(approve(t2, r.membershipId), "CV403");
    await approve(lead, r.membershipId);
  });

  it("the applicant's own command and the sign-up metadata cannot carry capabilities, a status or another organization", async () => {
    const [{ args }] = await admin<{ args: string }>("select pg_get_function_identity_arguments('public.submit_staff_application'::regproc) args");
    expect(args).toBe("p_operation_key uuid, p_clinic_id uuid, p_role text, p_position_title text, p_note text");
    const id = randomUUID();
    await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `esc-meta-${id.slice(0, 8)}@example.test`, JSON.stringify({
      display_name: "Meta Applicant",
      staff_application: { clinic_id: clinic, role: "assistant", capabilities: ["admin.users"], status: "accepted", organization_id: otherOrg, membership_status: "active" },
    })]);
    const apps = await admin<{ status: string; requested_role: string; organization_id: string; membership_id: string | null }>(
      "select status, requested_role, organization_id, membership_id from public.staff_applications where profile_id = $1", [id]);
    expect(apps).toEqual([{ status: "pending", requested_role: "assistant", organization_id: org, membership_id: null }]);
    expect(await admin("select 1 from public.staff_memberships where profile_id = $1", [id])).toHaveLength(0);
  });

  it("applications to another organization's clinic are decided only there; closed clinics refuse applications", async () => {
    const u = await newUser("esc-cross-org");
    const id = await submit(u, foreignClinic, "assistant"); // every active clinic is in the public directory
    expect((await admin<{ organization_id: string }>("select organization_id from public.staff_applications where id = $1", [id]))[0].organization_id).toBe(otherOrg);
    await expectCode(accept(t1, foreignClinic, id, await version(id)), "CV403");
    await expectCode(accept(t1, clinic, id, await version(id)), "CV404");
    await expectCode(as(t1, (q) => q("select public.request_staff_membership($1,$2,$3,'assistant')", [op(), foreignClinic, u.id])), "CV403");
    const r = await accept(foreignAdmin, foreignClinic, id, await version(id));
    expect((await admin<{ organization_id: string; clinic_id: string }>("select organization_id, clinic_id from public.staff_memberships where id = $1", [r.membershipId]))[0])
      .toEqual({ organization_id: otherOrg, clinic_id: foreignClinic });
    const closed = await makeClinic(org, "Closed clinic");
    await admin("update public.clinics set status = 'closed' where id = $1", [closed]);
    await expectCode(submit(await newUser("esc-closed"), closed, "assistant"), "CV404");
  });
});

describe("I4-12 rows created in one transaction come back in a stable, id-ordered sequence", () => {
  it("list_review_cases orders equal timestamps by id, the same way on every call, including at the limit", async () => {
    const org = await makeOrg("Ordering org");
    const clinic = await makeClinic(org, "Ordering clinic");
    const lead = await newUser("order-lead");
    await grant(org, clinic, lead, "clinical_lead");
    // One statement, one transaction: every row gets the same created_at (now()), like cancel_session's cases.
    await admin(`insert into public.record_review_cases (organization_id, clinic_id, kind, reason)
                 select $1, $2, 'stock', 'tie ' || g from generate_series(1, 8) g`, [org, clinic]);
    const ids = (await admin<{ id: string }>("select id from public.record_review_cases where clinic_id = $1 order by id", [clinic])).map((r) => r.id);
    expect(new Set((await admin<{ t: string }>("select created_at::text t from public.record_review_cases where clinic_id = $1", [clinic])).map((r) => r.t)).size).toBe(1);
    const list = (limit: number) => as(lead, (q) => q<{ r: { caseId: string }[] }>("select public.list_review_cases($1,'open',$2) as r", [clinic, limit])).then((x) => x[0].r.map((c) => c.caseId));
    for (let i = 0; i < 3; i++) expect(await list(50)).toEqual(ids);
    expect(await list(3)).toEqual(ids.slice(0, 3));
  });

  it("my_messages orders equal timestamps by id descending, the same way on every call, including at the limit", async () => {
    const org = await makeOrg("Ordering inbox org");
    const u = await newUser("order-inbox");
    await admin(`insert into public.messages (organization_id, recipient_profile_id, child_id, kind, title, body, dedupe_key)
                 select $1, $2, null, 'staff_application', 'Tie ' || g, 'Body ' || g, 'order-tie:' || g from generate_series(1, 8) g`, [org, u.id]);
    const ids = (await admin<{ id: string }>("select id from public.messages where recipient_profile_id = $1 order by id desc", [u.id])).map((r) => r.id);
    const inbox = (limit: number) => as(u, (q) => q<{ r: { items: { id: string }[] } }>("select public.my_messages($1) as r", [limit])).then((x) => x[0].r.items.map((m) => m.id));
    for (let i = 0; i < 3; i++) expect(await inbox(50)).toEqual(ids);
    expect(await inbox(3)).toEqual(ids.slice(0, 3));
  });
});

describe("I4-18 operator break-glass restores an approver only where the app can no longer grant", () => {
  const SIG = "private.restore_clinic_approver(uuid,text,text,text)";
  const email = async (u: Actor) => (await admin<{ email: string }>("select email from auth.users where id = $1", [u.id]))[0].email;
  const restore = (clinic: string, mail: string, role: string, reason = "both approvers unavailable, operator ticket OPS-1") =>
    admin<{ r: { membershipId: string; role: string; clinicId: string } }>("select private.restore_clinic_approver($1,$2,$3,$4) as r", [clinic, mail, role, reason]).then((x) => x[0].r);
  let org: string;
  beforeAll(async () => {
    org = await makeOrg("Break-glass org");
  });

  it("is executable by no API role", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await admin<{ x: boolean }>(`select has_function_privilege('${role}', '${SIG}', 'execute') as x`))[0].x, role).toBe(false);
    }
    const [{ x: pub }] = await admin<{ x: boolean }>(
      `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${SIG}'::regprocedure and a.grantee = 0) as x`);
    expect(pub).toBe(false);
    const u = await newUser("bg-api");
    await expectCode(as(u, (q) => q("select private.restore_clinic_approver($1,'x@example.test','tech_admin','some long reason')", [randomUUID()])), "42501");
    await expectCode(as(null, (q) => q("select private.restore_clinic_approver($1,'x@example.test','tech_admin','some long reason')", [randomUUID()])), "42501");
  });

  it("refuses while the health center can still grant that kind of access, and validates its input", async () => {
    const clinic = await makeClinic(org, "Working clinic");
    const [a, l, spare] = await Promise.all(["bg-ok-a", "bg-ok-l", "bg-ok-spare"].map(newUser));
    await grant(org, clinic, a, "tech_admin");
    await grant(org, clinic, l, "clinical_lead");
    for (const role of ["tech_admin", "clinical_lead"]) {
      const e = await restore(clinic, await email(spare), role).then(() => null, (x: { code?: string; message: string }) => x);
      expect(e?.code).toBe("CV409");
      expect(e?.message).toMatch(/can still approve access through the app; use the normal two-person request/);
    }
    await expectCode(restore(clinic, await email(spare), "assistant"), "CV422");
    await expectCode(restore(clinic, await email(spare), "tech_admin", "too short"), "CV422");
    await expectCode(restore(randomUUID(), await email(spare), "tech_admin"), "CV404");
    expect(await admin("select 1 from public.staff_memberships where profile_id = $1", [spare.id])).toHaveLength(0);
  });

  it("after the emergency suspension of the only clinical lead: restores a confirmed lead, audited, and the normal two-person path works again", async () => {
    const clinic = await makeClinic(org, "Emergency clinic");
    const [a, l, newLead, nurse] = await Promise.all(["bg-em-a", "bg-em-l", "bg-em-newlead", "bg-em-nurse"].map(newUser));
    await grant(org, clinic, a, "tech_admin");
    await grant(org, clinic, l, "clinical_lead");
    await admin("select private.set_profile_status($1,'suspended','account compromised, operator emergency')", [l.id]);
    // The technical path is also closed now (A approves, but nobody else can request), so tech_admin could be restored too;
    // restoring the clinical lead reopens both: A requests, the new lead approves (and vice versa).
    const r = await restore(clinic, (await email(newLead)).toUpperCase(), "clinical_lead");
    expect(r).toMatchObject({ role: "clinical_lead", clinicId: clinic });
    const [m] = await admin<{ status: string; approved_by: string | null; requested_by: string | null; operator_restored_at: string | null; profile_id: string }>(
      "select status, approved_by, requested_by, operator_restored_at, profile_id from public.staff_memberships where id = $1", [r.membershipId]);
    expect(m).toMatchObject({ status: "active", approved_by: null, requested_by: null, profile_id: newLead.id });
    expect(m.operator_restored_at).toBeTruthy();
    const [audit] = await admin<{ actor_id: string | null; system_job_id: string; reason: string; after: Record<string, unknown> }>(
      "select actor_id, system_job_id, reason, after from private.audit_logs where action = 'staff_membership.restored_by_operator' and entity_id = $1", [r.membershipId]);
    expect(audit).toMatchObject({ actor_id: null, system_job_id: "system", reason: "both approvers unavailable, operator ticket OPS-1" });
    expect(audit.after).toMatchObject({ role: "clinical_lead", profile: newLead.id, emailDomain: "example.test", dbUser: "postgres", reusedMembership: false });
    expect(JSON.stringify(audit.after)).not.toContain("bg-em-newlead"); // no full email in the audit payload
    // Normal commands again: A requests a nurse, the restored lead approves.
    const [{ r: req }] = await as(a, (q) => q<{ r: { membershipId: string; requiresClinicalApproval: boolean } }>("select public.request_staff_membership($1,$2,$3,'clinical_staff') as r", [op(), clinic, nurse.id]));
    expect(req.requiresClinicalApproval).toBe(true);
    await as(newLead, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), req.membershipId]));
    expect(await status(req.membershipId)).toBe("active");
    // A second restore is refused: the clinic can grant again, and the person already holds the role.
    await expectCode(restore(clinic, await email(newLead), "clinical_lead"), "CV409");
  });

  it("reuses a pending request of that person for that role, and never reactivates a revoked membership", async () => {
    const clinic = await makeClinic(org, "Reuse clinic");
    const [a, candidate] = await Promise.all(["bg-re-a", "bg-re-cand"].map(newUser));
    await grant(org, clinic, a, "tech_admin");
    const [{ r: pending }] = await as(a, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'clinical_lead') as r", [op(), clinic, candidate.id]));
    const restored = await restore(clinic, await email(candidate), "clinical_lead");
    expect(restored.membershipId).toBe(pending.membershipId);
    expect(await status(pending.membershipId)).toBe("active");
    const [{ after }] = await admin<{ after: { reusedMembership: boolean } }>("select after from private.audit_logs where action = 'staff_membership.restored_by_operator' and entity_id = $1", [pending.membershipId]);
    expect(after.reusedMembership).toBe(true);
    // A revoked tech_admin row stays revoked; a restore adds a new row.
    const lonely = await makeClinic(org, "Reuse lonely");
    const solo = await newUser("bg-re-solo");
    const old = await grant(org, lonely, solo, "tech_admin");
    await admin("update public.staff_memberships set status = 'revoked' where id = $1", [old]);
    const fresh = await restore(lonely, await email(solo), "tech_admin");
    expect(fresh.membershipId).not.toBe(old);
    expect(await status(old)).toBe("revoked");
  });

  it("refuses an account whose email address is not confirmed (Supabase auth.users.email_confirmed_at)", async () => {
    const clinic = await makeClinic(org, "Unconfirmed clinic");
    const client = await pool.connect();
    try {
      await client.query("begin");
      // The local auth stand-in has no confirmation column; add it inside this transaction only, as Supabase has it.
      await client.query("alter table auth.users add column email_confirmed_at timestamptz");
      const id = randomUUID();
      const mail = `bg-unconfirmed-${id.slice(0, 8)}@example.test`;
      await client.query("insert into auth.users (id, email) values ($1, $2)", [id, mail]);
      const err = await client.query("select private.restore_clinic_approver($1,$2,'tech_admin','nobody left, operator ticket OPS-2')", [clinic, mail]).then(() => null, (e: { code?: string; message: string }) => e);
      expect(err?.code).toBe("CV422");
      expect(err?.message).toMatch(/confirm their email address/);
    } finally {
      await client.query("rollback").catch(() => undefined);
      client.release();
    }
  });
});

describe("QA-02 capacity conflict wording counts families correctly", () => {
  it("says '1 family is already booked' for one booking and '2 families are already booked' for two", async () => {
    const w = await clinicalWorld();
    const [{ r: s }] = await as(w.assistant, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), w.clinic,
      JSON.stringify({ serviceDate: isoDaysFromToday(4), startTime: "08:00", endTime: "12:00", totalCapacity: 10, onlineCapacity: 8, walkinCapacity: 2 })]));
    const kid = async (n: number) => (await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r",
      [op(), w.clinic, JSON.stringify({ displayName: `Capacity Kid ${n}`, dob: isoDaysFromToday(-40) })])))[0].r.childId as string;
    const book = async (n: number) => {
      const child = await kid(n);
      await as(w.assistant, (q) => q("select public.book_appointment($1,$2,$3)", [op(), child, s.sessionId]));
    };
    const shrink = async (online: number) => {
      const [{ version }] = await admin<{ version: number }>("select version from public.clinic_sessions where id = $1", [s.sessionId]);
      return failure(as(w.assistant, (q) => q("select public.update_session_capacity($1,$2,$3,$4,10,$5,2)", [op(), w.clinic, s.sessionId, version, online])));
    };
    await book(1);
    expect(await shrink(0)).toMatchObject({ code: "CV409", message: "1 family is already booked; bookable places cannot go below that" });
    await book(2);
    expect(await shrink(1)).toMatchObject({ code: "CV409", message: "2 families are already booked; bookable places cannot go below that" });
  });
});

describe("QA-03 the operator adds a second health center, seeds its first staff, and it works as a transfer target", () => {
  const SIG = "private.add_clinic(uuid,text,text,text)";
  const add = (org: string, name: string, tz = "Asia/Manila", reason = "new barangay health station opened, OPS-3") =>
    admin<{ r: { clinicId: string; name: string; timezone: string } }>("select private.add_clinic($1,$2,$3,$4) as r", [org, name, tz, reason]).then((x) => x[0].r);
  const email = async (u: Actor) => (await admin<{ email: string }>("select email from auth.users where id = $1", [u.id]))[0].email;
  const seed = (clinic: string, mail: string, role: string) =>
    admin<{ r: { membershipId: string } }>("select private.restore_clinic_approver($1,$2,$3,'first staff of a new health center')", [clinic, mail, role]).then((x) => x[0].r);

  it("is executable by no API role", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await admin<{ x: boolean }>(`select has_function_privilege('${role}', '${SIG}', 'execute') as x`))[0].x, role).toBe(false);
    }
    const [{ x: pub }] = await admin<{ x: boolean }>(
      `select exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = '${SIG}'::regprocedure and a.grantee = 0) as x`);
    expect(pub).toBe(false);
    const u = await newUser("qa03-api");
    await expectCode(as(u, (q) => q("select private.add_clinic($1,'Sneaky clinic','Asia/Manila','a long enough reason')", [randomUUID()])), "42501");
    await expectCode(as(null, (q) => q("select private.add_clinic($1,'Sneaky clinic','Asia/Manila','a long enough reason')", [randomUUID()])), "42501");
  });

  it("validates the organization, name, time zone and reason", async () => {
    const org = await makeOrg("QA-03 validation org");
    const first = await add(org, "  Riverside Health Station  ");
    expect(first).toMatchObject({ name: "Riverside Health Station", timezone: "Asia/Manila" });
    await expectCode(add(org, "RIVERSIDE health station"), "CV409"); // case-insensitive duplicate within the organization
    expect((await add(await makeOrg("QA-03 other org"), "Riverside Health Station")).name).toBe("Riverside Health Station"); // other org: fine
    await expectCode(add(org, "Hilltop", "Mars/Olympus_Mons"), "CV422");
    await expectCode(add(org, "ab"), "CV422");
    await expectCode(add(org, "x".repeat(121)), "CV422");
    await expectCode(add(org, "Hilltop", "Asia/Manila", "too short"), "CV422");
    await expectCode(add(randomUUID(), "Hilltop"), "CV404");
    const suspended = await makeOrg("QA-03 suspended org");
    await admin("update public.organizations set status = 'suspended' where id = $1", [suspended]);
    await expectCode(add(suspended, "Hilltop"), "CV409");
    const [audit] = await admin<{ actor_id: string | null; system_job_id: string; reason: string; after: Record<string, unknown> }>(
      "select actor_id, system_job_id, reason, after from private.audit_logs where action = 'clinic.added_by_operator' and entity_id = $1", [first.clinicId]);
    expect(audit).toMatchObject({ actor_id: null, system_job_id: "system", reason: "new barangay health station opened, OPS-3" });
    expect(audit.after).toMatchObject({ organization: org, name: "Riverside Health Station", timezone: "Asia/Manila", dbUser: "postgres" });
  });

  it("seeds an administrator and a clinical lead with no prior memberships, who then grant a nurse through the normal commands; the clinic is a record and stock transfer target", async () => {
    const w = await clinicalWorld();
    const added = await add(w.org, "Second Health Center", "Asia/Manila");
    const [admin2, lead2, nurse2] = await Promise.all(["qa03-admin", "qa03-lead", "qa03-nurse"].map(newUser));
    await seed(added.clinicId, await email(admin2), "tech_admin");
    await seed(added.clinicId, await email(lead2), "clinical_lead");
    // Both paths work now, so a third restore is refused.
    await expectCode(seed(added.clinicId, await email(nurse2), "tech_admin"), "CV409");
    const [{ r: req }] = await as(admin2, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'clinical_staff') as r", [op(), added.clinicId, nurse2.id]));
    await expectCode(as(admin2, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), req.membershipId])), "CV403");
    await as(lead2, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), req.membershipId]));
    expect(await status(req.membershipId)).toBe("active");

    // Listed publicly (sign-up and the clinic directory).
    const [{ r: listed }] = await as(null, (q) => q<{ r: { id: string; name: string }[] }>("select public.list_public_clinics() as r"));
    expect(listed.some((c) => c.id === added.clinicId && c.name === "Second Health Center")).toBe(true);

    // Record transfer: the first clinic sends a child's record to the new one.
    // (A transfer needs a verified guardian, as in record-transfer.test.ts.)
    const [{ r: kid }] = await as(w.g1, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r",
      [op(), w.clinic, JSON.stringify({ displayName: "QA-03 Transfer Kid", dob: isoDaysFromToday(-60) })]));
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, kid.childId]));
    const [rel] = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians g on g.id = r.guardian_id where g.profile_id = $1 and r.child_id = $2", [w.g1.id, kid.childId]);
    await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel.id]));
    const [{ r: transfer }] = await as(w.lead, (q) => q<R>("select public.initiate_record_transfer_out($1,$2,$3,$4,'family is moving') as r", [op(), w.clinic, kid.childId, added.clinicId]));
    const [row] = await admin<{ to_clinic_id: string }>("select to_clinic_id from public.record_transfers where id = $1", [transfer.transferId]);
    expect(row.to_clinic_id).toBe(added.clinicId);

    // Stock transfer: the first clinic ships a lot to the new one.
    const [{ r: loc }] = await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,'QA-03 fridge','usable') as r", [op(), w.clinic]));
    const [{ r: lot }] = await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'QA03-LOT',$4) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], "2099-12-31"]));
    await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,5,'DR-QA03')", [op(), w.clinic, loc.locationId, lot.lotId]));
    const [{ r: shipped }] = await as(w.inventory, (q) => q<R>("select public.send_stock_transfer($1,$2,$3,$4,$5,2,'to the new health center') as r",
      [op(), w.clinic, added.clinicId, loc.locationId, lot.lotId]));
    expect(shipped.status).toBe("in_transit");
    expect((await admin<{ to_clinic_id: string }>("select to_clinic_id from public.stock_transfers where id = $1", [shipped.transferId]))[0].to_clinic_id).toBe(added.clinicId);
  });
});
