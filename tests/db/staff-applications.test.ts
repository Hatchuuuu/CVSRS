import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

// 0035 staff applications: apply (at sign-up or later) -> an access administrator accepts or rejects -> acceptance files the ordinary
// membership request, which still needs a DIFFERENT person's approval (0002). Applications never grant access by themselves.

let org: string, clinicA: string, clinicB: string;
let lead: Actor, techAdmin: Actor, techAdmin2: Actor, assistant: Actor, adminB: Actor;

type App = { applicationId: string; status: string; version: number; email: string; requestedRole: string; membershipStatus: string | null; decisionReason: string | null; profileId: string };
const list = (actor: Actor, clinic: string, view = "pending") =>
  as(actor, (q) => q<{ r: App[] }>("select public.list_staff_applications($1, $2) as r", [clinic, view])).then((r) => r[0].r);
const submit = (actor: Actor, clinic: string, role = "clinical_staff", title: string | null = "Midwife", key = op()) =>
  as(actor, (q) => q<{ r: { applicationId: string; status: string } }>("select public.submit_staff_application($1,$2,$3,$4,null) as r", [key, clinic, role, title])).then((r) => r[0].r);
const mine = (actor: Actor) => as(actor, (q) => q<{ r: App[] }>("select public.my_staff_applications() as r")).then((r) => r[0].r);

beforeAll(async () => {
  org = await makeOrg("Applications org");
  clinicA = await makeClinic(org, "Application Clinic A");
  clinicB = await makeClinic(org, "Application Clinic B");
  [lead, techAdmin, techAdmin2, assistant, adminB] = await Promise.all(["app-lead", "app-admin", "app-admin2", "app-assistant", "app-adminB"].map(newUser));
  await grant(org, clinicA, lead, "clinical_lead");
  await grant(org, clinicA, techAdmin, "tech_admin");
  await grant(org, clinicA, techAdmin2, "tech_admin");
  await grant(org, clinicA, assistant, "assistant");
  await grant(org, clinicB, adminB, "tech_admin");
});
afterAll(() => pool.end());

describe("applying from the staff sign-up", () => {
  it("records the application carried in the new account's metadata", async () => {
    const id = randomUUID();
    await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `signup-${id.slice(0, 8)}@example.test`,
      JSON.stringify({ display_name: "Ana Reyes", staff_application: { clinic_id: clinicA, role: "clinical_staff", position_title: "Public health nurse", note: "Starting Monday" } })]);
    const [row] = await admin<{ status: string; requested_role: string; position_title: string; note: string }>(
      "select status, requested_role, position_title, note from public.staff_applications where profile_id = $1", [id]);
    expect(row).toEqual({ status: "pending", requested_role: "clinical_staff", position_title: "Public health nurse", note: "Starting Monday" });
    const audit = await admin("select 1 from private.audit_logs where action = 'staff_application.submitted' and after ->> 'profile' = $1", [id]);
    expect(audit).toHaveLength(1);
  });

  it("still creates the account when the application detail is unusable, and records no application", async () => {
    for (const app of [{ clinic_id: randomUUID(), role: "clinical_staff" }, { clinic_id: "not-a-uuid", role: "assistant" }, { clinic_id: clinicA, role: "superuser" }]) {
      const id = randomUUID();
      await admin("insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)", [id, `bad-${id.slice(0, 8)}@example.test`, JSON.stringify({ display_name: "X", staff_application: app })]);
      expect(await admin("select 1 from public.profiles where id = $1", [id])).toHaveLength(1);
      expect(await admin("select 1 from public.staff_applications where profile_id = $1", [id])).toHaveLength(0);
    }
  });

  it("a family sign-up (no application in the metadata) creates no application", async () => {
    const family = await newUser("family-signup");
    expect(await admin("select 1 from public.staff_applications where profile_id = $1", [family.id])).toHaveLength(0);
  });
});

describe("applicant commands", () => {
  it("applies, refuses a duplicate, withdraws, and can apply again", async () => {
    const u = await newUser("applicant-1");
    const r = await submit(u, clinicA, "assistant", null);
    expect(r.status).toBe("pending");
    await expectCode(submit(u, clinicA, "assistant", null), "CV409");
    await as(u, (q) => q("select public.withdraw_staff_application($1,$2)", [op(), r.applicationId]));
    expect((await mine(u))[0].status).toBe("withdrawn");
    await expectCode(as(u, (q) => q("select public.withdraw_staff_application($1,$2)", [op(), r.applicationId])), "CV409");
    expect((await submit(u, clinicA, "assistant", null)).status).toBe("pending");
  });

  it("validates role, clinic and length on the server", async () => {
    const u = await newUser("applicant-2");
    await expectCode(submit(u, clinicA, "superuser"), "CV422");
    await expectCode(submit(u, randomUUID()), "CV404");
    await expectCode(submit(u, clinicA, "assistant", "x".repeat(81)), "CV422");
    await expectCode(as(null, (q) => q("select public.submit_staff_application($1,$2,'assistant',null,null)", [op(), clinicA])), "42501");
  });

  it("refuses an application where the person already works", async () => {
    await expectCode(submit(assistant, clinicA, "clinical_staff"), "CV409");
  });

  it("lists only the caller's own applications, and nobody else can withdraw them", async () => {
    const u = await newUser("applicant-3");
    const other = await newUser("applicant-3-other");
    const r = await submit(u, clinicB, "bhw", null);
    expect((await mine(other)).find((a) => a.applicationId === r.applicationId)).toBeUndefined();
    await expectCode(as(other, (q) => q("select public.withdraw_staff_application($1,$2)", [op(), r.applicationId])), "CV404");
    await expectCode(as(techAdmin, (q) => q("select public.withdraw_staff_application($1,$2)", [op(), r.applicationId])), "CV404");
  });
});

describe("administrator review", () => {
  it("shows pending applications with the applicant's email only to that clinic's access administrators", async () => {
    const u = await newUser("applicant-review");
    await submit(u, clinicA, "clinical_staff");
    const rows = await list(techAdmin, clinicA);
    const row = rows.find((a) => a.profileId === u.id)!;
    expect(row.email).toMatch(/@example\.test$/);
    expect(row.requestedRole).toBe("clinical_staff");
    expect((await list(lead, clinicA)).some((a) => a.profileId === u.id)).toBe(true);
    await expectCode(list(assistant, clinicA), "CV403");
    await expectCode(list(adminB, clinicA), "CV403");
    await expectCode(list(u, clinicA), "CV403");
    await expectCode(as(techAdmin, (q) => q("select public.list_staff_applications($1,'everything')", [clinicA])), "CV422");
  });

  it("accepting files a pending request that the SAME administrator cannot approve, and a second administrator can", async () => {
    const u = await newUser("applicant-accept");
    const { applicationId } = await submit(u, clinicA, "assistant", null);
    const app = (await list(techAdmin, clinicA)).find((a) => a.applicationId === applicationId)!;
    const key = op();
    const [{ r }] = await as(techAdmin, (q) => q<{ r: { membershipId: string; status: string; requiresClinicalApproval: boolean } }>(
      "select public.accept_staff_application($1,$2,$3,$4,null) as r", [key, clinicA, applicationId, app.version]));
    expect(r.status).toBe("accepted");
    expect(r.requiresClinicalApproval).toBe(false);
    // Idempotent replay returns the same result and files nothing new.
    const [{ r: again }] = await as(techAdmin, (q) => q<{ r: { membershipId: string } }>("select public.accept_staff_application($1,$2,$3,$4,null) as r", [key, clinicA, applicationId, app.version]));
    expect(again.membershipId).toBe(r.membershipId);
    expect(await admin("select 1 from public.staff_memberships where profile_id = $1", [u.id])).toHaveLength(1);
    // The applicant is told once in their inbox, even when the command is replayed.
    const inbox = await as(u, (q) => q<{ r: { items: { kind: string; title: string; body: string; childId: string | null }[] } }>("select public.my_messages() as r"));
    expect(inbox[0].r.items).toHaveLength(1);
    expect(inbox[0].r.items[0]).toMatchObject({ kind: "staff_application", title: "Your staff application was accepted", childId: null });
    expect(inbox[0].r.items[0].body).toContain("Application Clinic A");
    expect(inbox[0].r.items[0].body).toContain("Registration assistant");

    const [m] = await admin<{ status: string; requested_by: string; role_code: string; version: number }>(
      "select status, requested_by, role_code, version from public.staff_memberships where id = $1", [r.membershipId]);
    expect(m).toMatchObject({ status: "pending_approval", requested_by: techAdmin.id, role_code: "assistant" });
    // Two-person rule: the accepting administrator is the requester, so cannot approve.
    await expectCode(as(techAdmin, (q) => q("select public.approve_staff_membership($1,$2,$3)", [op(), r.membershipId, m.version])), "CV403");
    await as(techAdmin2, (q) => q("select public.approve_staff_membership($1,$2,$3)", [op(), r.membershipId, m.version]));
    const ctx = await as(u, (q) => q<{ c: { memberships: { status: string }[] } }>("select public.get_my_context() as c"));
    expect(ctx[0].c.memberships.map((x) => x.status)).toEqual(["active"]);
    const [applicantView] = await mine(u);
    expect(applicantView).toMatchObject({ status: "accepted", membershipStatus: "active" });
  });

  it("a clinical role accepted by a technical administrator needs a clinical lead's approval", async () => {
    const u = await newUser("applicant-clinical");
    const { applicationId } = await submit(u, clinicA, "clinical_staff");
    const app = (await list(techAdmin, clinicA)).find((a) => a.applicationId === applicationId)!;
    const [{ r }] = await as(techAdmin, (q) => q<{ r: { membershipId: string; requiresClinicalApproval: boolean } }>(
      "select public.accept_staff_application($1,$2,$3,$4,'clinical_staff') as r", [op(), clinicA, applicationId, app.version]));
    expect(r.requiresClinicalApproval).toBe(true);
    await expectCode(as(techAdmin2, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId])), "CV403");
    await as(lead, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId]));
    expect((await admin<{ status: string }>("select status from public.staff_memberships where id = $1", [r.membershipId]))[0].status).toBe("active");
  });

  it("an administrator may accept for a different role than the one applied for", async () => {
    const u = await newUser("applicant-role-change");
    const { applicationId } = await submit(u, clinicA, "clinical_lead");
    const app = (await list(techAdmin, clinicA)).find((a) => a.applicationId === applicationId)!;
    const [{ r }] = await as(techAdmin, (q) => q<{ r: { membershipId: string } }>("select public.accept_staff_application($1,$2,$3,$4,'assistant') as r", [op(), clinicA, applicationId, app.version]));
    expect((await admin<{ role_code: string }>("select role_code from public.staff_memberships where id = $1", [r.membershipId]))[0].role_code).toBe("assistant");
  });

  it("rejects with a reason the applicant can read; decided applications cannot be decided again", async () => {
    const u = await newUser("applicant-reject");
    const { applicationId } = await submit(u, clinicA, "inventory", null);
    const app = (await list(techAdmin, clinicA)).find((a) => a.applicationId === applicationId)!;
    await expectCode(as(techAdmin, (q) => q("select public.reject_staff_application($1,$2,$3,$4,'no')", [op(), clinicA, applicationId, app.version])), "CV422");
    await expectCode(as(techAdmin, (q) => q("select public.reject_staff_application($1,$2,$3,$4,'Not on our staff list')", [op(), clinicA, applicationId, app.version + 5])), "CV409");
    await as(techAdmin, (q) => q("select public.reject_staff_application($1,$2,$3,$4,'Not on our staff list')", [op(), clinicA, applicationId, app.version]));
    expect((await mine(u))[0]).toMatchObject({ status: "rejected", decisionReason: "Not on our staff list" });
    const inbox = await as(u, (q) => q<{ r: { items: { title: string; body: string }[] } }>("select public.my_messages() as r"));
    expect(inbox[0].r.items[0].title).toBe("Your staff application was declined");
    expect(inbox[0].r.items[0].body).toContain("Reason: Not on our staff list");
    await expectCode(as(techAdmin2, (q) => q("select public.accept_staff_application($1,$2,$3,$4,null)", [op(), clinicA, applicationId, app.version + 1])), "CV409");
    const decided = await list(techAdmin, clinicA, "decided");
    expect(decided.find((a) => a.applicationId === applicationId)).toMatchObject({ status: "rejected" });
    expect(await admin("select 1 from private.audit_logs where action = 'staff_application.rejected' and entity_id = $1 and reason = 'Not on our staff list'", [applicationId])).toHaveLength(1);
    expect(await admin("select 1 from public.staff_memberships where profile_id = $1", [u.id])).toHaveLength(0);
  });

  it("is scoped to the clinic: another clinic's administrator cannot decide, nor reach it through their own clinic id", async () => {
    const u = await newUser("applicant-scope");
    const { applicationId } = await submit(u, clinicA, "assistant", null);
    await expectCode(as(adminB, (q) => q("select public.accept_staff_application($1,$2,$3,1,null)", [op(), clinicA, applicationId])), "CV403");
    await expectCode(as(adminB, (q) => q("select public.accept_staff_application($1,$2,$3,1,null)", [op(), clinicB, applicationId])), "CV404");
    await expectCode(as(assistant, (q) => q("select public.reject_staff_application($1,$2,$3,1,'Not known here')", [op(), clinicA, applicationId])), "CV403");
  });

  it("nobody decides their own application", async () => {
    const u = await newUser("applicant-self");
    const { applicationId } = await submit(u, clinicA, "assistant", null);
    await grant(org, clinicA, u, "tech_admin"); // granted another way after applying
    await expectCode(as(u, (q) => q("select public.accept_staff_application($1,$2,$3,1,null)", [op(), clinicA, applicationId])), "CV403");
    await expectCode(as(u, (q) => q("select public.reject_staff_application($1,$2,$3,1,'Self rejection')", [op(), clinicA, applicationId])), "CV403");
  });

  it("requires two-step sign-in for administrators, like every staff command", async () => {
    await expectCode(list({ id: techAdmin.id, aal: "aal1" }, clinicA), "CV403");
  });
});
