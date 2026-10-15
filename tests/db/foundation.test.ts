import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";

let org: string, clinicA: string, clinicB: string;
let lead: Actor, lead2: Actor, techAdmin: Actor, assistant: Actor, stranger: Actor, newHire: Actor;

beforeAll(async () => {
  org = await makeOrg();
  clinicA = await makeClinic(org, "Clinic A");
  clinicB = await makeClinic(org, "Clinic B");
  [lead, lead2, techAdmin, assistant, stranger, newHire] = await Promise.all(
    ["lead", "lead2", "admin", "assistant", "stranger", "newhire"].map(newUser),
  );
  await grant(org, clinicA, lead, "clinical_lead");
  await grant(org, clinicA, lead2, "clinical_lead");
  await grant(org, clinicA, techAdmin, "tech_admin");
  await grant(org, clinicA, assistant, "assistant");
});
afterAll(() => pool.end());

describe("profiles (BP30/BP32)", () => {
  it("creates exactly one profile per auth user and no privileged access", async () => {
    const rows = await admin("select status from public.profiles where id = $1", [stranger.id]);
    expect(rows).toHaveLength(1);
    const ctx = await as(stranger, (q) => q("select public.get_my_context() as c"));
    expect((ctx[0] as { c: { memberships: unknown[] } }).c.memberships).toEqual([]);
  });

  it("lets a user edit safe profile fields but not status", async () => {
    await as(stranger, (q) => q("update public.profiles set display_name = 'New Name' where id = $1", [stranger.id]));
    await expectCode(
      as(stranger, (q) => q("update public.profiles set status = 'deactivated' where id = $1", [stranger.id])),
      "42501",
    );
  });

  it("cannot read or modify other profiles", async () => {
    const rows = await as(stranger, (q) => q("select id from public.profiles where id <> $1", [stranger.id]));
    expect(rows).toHaveLength(0);
    const upd = await as(stranger, (q) => q("update public.profiles set display_name = 'x' where id = $1 returning id", [lead.id]));
    expect(upd).toHaveLength(0);
  });
});

describe("anonymous and API-role grants", () => {
  it("anonymous cannot read protected tables", async () => {
    for (const t of ["profiles", "staff_memberships", "clinics", "organizations"]) {
      await expectCode(as(null, (q) => q(`select 1 from public.${t}`)), "42501");
    }
  });

  it("anonymous sees only the curated public clinic view", async () => {
    const rows = await as(null, (q) => q("select * from public.public_clinics"));
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0]).sort()).toEqual(["address", "contact_text", "id", "name", "timezone"]);
  });

  it("no API role can touch private schema tables", async () => {
    await expectCode(as(lead, (q) => q("select * from private.audit_logs")), "42501");
    await expectCode(as(lead, (q) => q("select * from private.command_receipts")), "42501");
    await expectCode(as(null, (q) => q("select * from private.audit_logs")), "42501");
  });

  it("private helpers are not callable by anon", async () => {
    await expectCode(as(null, (q) => q("select private.has_capability(gen_random_uuid(), 'x')")), "42501");
  });
});

describe("MFA enforcement for staff capability (BP32)", () => {
  it("an aal1 session has no staff capability even with an active membership", async () => {
    const [{ ok }] = await as({ ...assistant, aal: "aal1" }, (q) => q<{ ok: boolean }>("select private.has_capability($1,'child.search') as ok", [clinicA]));
    expect(ok).toBe(false);
    const [{ ok: ok2 }] = await as(assistant, (q) => q<{ ok: boolean }>("select private.has_capability($1,'child.search') as ok", [clinicA]));
    expect(ok2).toBe(true);
  });
});

describe("capability scope", () => {
  it("is limited to the assigned clinic and to the role preset", async () => {
    const check = (a: Actor, clinic: string, cap: string) =>
      as(a, async (q) => (await q<{ ok: boolean }>("select private.has_capability($1,$2) as ok", [clinic, cap]))[0].ok);
    expect(await check(assistant, clinicA, "child.search")).toBe(true);
    expect(await check(assistant, clinicB, "child.search")).toBe(false); // other clinic, same org
    expect(await check(assistant, clinicA, "vaccination.record")).toBe(false); // not in preset
    expect(await check(techAdmin, clinicA, "child.read_clinical")).toBe(false); // tech admin has no clinical access (T32)
    expect(await check(techAdmin, clinicA, "admin.users")).toBe(true);
  });

  it("expired and revoked memberships stop granting capability immediately", async () => {
    const u = await newUser("temp");
    const id = await grant(org, clinicA, u, "assistant");
    const has = () => as(u, async (q) => (await q<{ ok: boolean }>("select private.has_capability($1,'child.search') as ok", [clinicA]))[0].ok);
    expect(await has()).toBe(true);
    await admin("update public.staff_memberships set valid_until = now() + interval '1 second', valid_from = now() - interval '1 hour' where id = $1", [id]);
    await new Promise((r) => setTimeout(r, 1200));
    expect(await has()).toBe(false);
    await admin("update public.staff_memberships set status = 'active', valid_until = null where id = $1", [id]);
    expect(await has()).toBe(true);
    await admin("update public.staff_memberships set status = 'revoked' where id = $1", [id]);
    expect(await has()).toBe(false);
  });

  it("revoking staff access needs the right approver, a reason, ends access at once, is audited and idempotent", async () => {
    const nurse = await newUser("revoke-nurse");
    const clerk = await newUser("revoke-clerk");
    const nurseM = await grant(org, clinicA, nurse, "clinical_staff");
    const clerkM = await grant(org, clinicA, clerk, "inventory");
    const revoke = (actor: Actor, id: string, reason = "left the health center", key = op()) =>
      as(actor, (q) => q<{ r: { status: string } }>("select public.revoke_staff_membership($1,$2,$3) as r", [key, id, reason]));
    // A clinical membership is revoked by a clinical approver, not by the technical administrator; others need admin.users.
    await expectCode(revoke(techAdmin, nurseM), "CV403");
    await expectCode(revoke(assistant, clerkM), "CV403");
    await expectCode(revoke(stranger, clerkM), "CV403");
    await expectCode(revoke(lead, nurseM, "  "), "CV422");
    const key = op();
    expect((await revoke(lead, nurseM, "left the health center", key))[0].r.status).toBe("revoked");
    // Retrying the same submission returns the same result instead of failing; a new attempt on a closed membership is refused.
    expect((await revoke(lead, nurseM, "left the health center", key))[0].r.status).toBe("revoked");
    await expectCode(revoke(lead2, nurseM), "CV409");
    const has = await as(nurse, async (q) => (await q<{ ok: boolean }>("select private.has_capability($1,'child.read_clinical') as ok", [clinicA]))[0].ok);
    expect(has).toBe(false);
    expect((await revoke(techAdmin, clerkM))[0].r.status).toBe("revoked");
    const audit = await admin("select count(*)::int n from private.audit_logs where action = 'staff_membership.revoked' and entity_id = any($1::uuid[])", [[nurseM, clerkM]]);
    expect(audit[0]).toEqual({ n: 2 });
  });

  it("a suspended profile loses all capability", async () => {
    const u = await newUser("susp");
    await grant(org, clinicA, u, "assistant");
    await admin("update public.profiles set status = 'suspended' where id = $1", [u.id]);
    const ok = await as(u, async (q) => (await q<{ ok: boolean }>("select private.has_capability($1,'child.search') as ok", [clinicA]))[0].ok);
    expect(ok).toBe(false);
  });
});

describe("staff membership lifecycle (two-person control)", () => {
  it("rejects a client trying to grant itself membership by direct insert", async () => {
    await expectCode(
      as(stranger, (q) =>
        q(`insert into public.staff_memberships (organization_id, profile_id, clinic_id, role_code, status) values ($1,$2,$3,'clinical_lead','active')`, [org, stranger.id, clinicA])),
      "42501",
    );
  });

  it("a stranger cannot request memberships", async () => {
    await expectCode(as(stranger, (q) => q("select public.request_staff_membership($1,$2,$3,'assistant')", [op(), clinicA, newHire.id])), "CV403");
  });

  it("tech admin can request; clinical grants need a different clinical approver, never the tech admin", async () => {
    const r = await as(techAdmin, (q) => q<{ r: { membershipId: string; requiresClinicalApproval: boolean } }>(
      "select public.request_staff_membership($1,$2,$3,'clinical_staff') as r", [op(), clinicA, newHire.id]));
    const { membershipId, requiresClinicalApproval } = r[0].r;
    expect(requiresClinicalApproval).toBe(true);
    // the tech admin cannot approve a clinical grant they requested (or at all)
    await expectCode(as(techAdmin, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), membershipId])), "CV403");
    // the assistant cannot
    await expectCode(as(assistant, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), membershipId])), "CV403");
    // the grantee cannot approve their own
    await expectCode(as(newHire, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), membershipId])), "CV403");
    // a clinical lead can
    await as(lead, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), membershipId]));
    const [m] = await admin<{ status: string; approved_by: string }>("select status, approved_by from public.staff_memberships where id = $1", [membershipId]);
    expect(m.status).toBe("active");
    expect(m.approved_by).toBe(lead.id);
    // stale version conflict on a second approval attempt
    await expectCode(as(lead2, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), membershipId])), "CV409");
  });

  it("a clinical lead cannot approve a grant they requested themselves", async () => {
    const u = await newUser("hire2");
    const [{ r }] = await as(lead, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'clinical_staff') as r", [op(), clinicA, u.id]));
    await expectCode(as(lead, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId])), "CV403");
    await as(lead2, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId]));
  });

  it("non-clinical grants are approved by a different tech admin capability, not a clinical role without it", async () => {
    const u = await newUser("inv");
    const [{ r }] = await as(techAdmin, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'inventory') as r", [op(), clinicA, u.id]));
    await expectCode(as(techAdmin, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId])), "CV403"); // same person
    // clinical lead lacks admin.users, so cannot approve a purely technical/inventory grant
    await expectCode(as(lead, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId])), "CV403");
    const admin2 = await newUser("admin2");
    await grant(org, clinicA, admin2, "tech_admin");
    await as(admin2, (q) => q("select public.approve_staff_membership($1,$2,1)", [op(), r.membershipId]));
  });

  it("an explicit clinical capability on an assistant still requires clinical approval", async () => {
    const u = await newUser("hire3");
    const [{ r }] = await as(techAdmin, (q) => q<{ r: { requiresClinicalApproval: boolean } }>(
      "select public.request_staff_membership($1,$2,$3,'assistant',array['evidence.verify']) as r", [op(), clinicA, u.id]));
    expect(r.requiresClinicalApproval).toBe(true);
  });

  it("rejects capabilities outside the fixed vocabulary", async () => {
    const u = await newUser("hire4");
    await expectCode(as(techAdmin, (q) => q("select public.request_staff_membership($1,$2,$3,'assistant',array['god.mode'])", [op(), clinicA, u.id])), "23514");
  });
});

describe("idempotent commands (T05/T06)", () => {
  it("replays the original result for the same key and payload, without duplicating", async () => {
    const u = await newUser("idem");
    const key = op();
    const first = await as(techAdmin, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'assistant') as r", [key, clinicA, u.id]));
    const second = await as(techAdmin, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'assistant') as r", [key, clinicA, u.id]));
    expect(second[0].r.membershipId).toBe(first[0].r.membershipId);
    const [{ n }] = await admin<{ n: string }>("select count(*) n from public.staff_memberships where profile_id = $1", [u.id]);
    expect(Number(n)).toBe(1);
  });

  it("raises a conflict when the key is reused with a different payload", async () => {
    const u = await newUser("idem2");
    const key = op();
    await as(techAdmin, (q) => q("select public.request_staff_membership($1,$2,$3,'assistant')", [key, clinicA, u.id]));
    const reused = as(techAdmin, (q) => q("select public.request_staff_membership($1,$2,$3,'inventory')", [key, clinicA, u.id]));
    await expect(reused).rejects.toMatchObject({ code: "CV409", hint: "cvsrs:operation_key_reused" });
    const [{ n }] = await admin<{ n: string }>("select count(*) n from public.staff_memberships where profile_id = $1", [u.id]);
    expect(Number(n)).toBe(1);
  });

  it("concurrent requests with the same key yield a single effect", async () => {
    const u = await newUser("race");
    const key = op();
    const call = () => as(techAdmin, (q) => q<{ r: { membershipId: string } }>("select public.request_staff_membership($1,$2,$3,'assistant') as r", [key, clinicA, u.id]));
    const results = await Promise.all([call(), call(), call()]);
    expect(new Set(results.map((x) => x[0].r.membershipId)).size).toBe(1);
    const [{ n }] = await admin<{ n: string }>("select count(*) n from public.staff_memberships where profile_id = $1", [u.id]);
    expect(Number(n)).toBe(1);
  });
});

describe("audit trail (BP34)", () => {
  it("records grants with actor, and is immutable even for a superuser", async () => {
    const rows = await admin<{ id: string; actor_id: string }>("select id, actor_id from private.audit_logs where action = 'staff_membership.requested' limit 1");
    expect(rows[0].actor_id).toBeTruthy();
    await expect(admin("update private.audit_logs set reason = 'tamper' where id = $1", [rows[0].id])).rejects.toMatchObject({ code: "CV403" });
    await expect(admin("delete from private.audit_logs where id = $1", [rows[0].id])).rejects.toMatchObject({ code: "CV403" });
    await expect(admin("truncate private.audit_logs")).rejects.toMatchObject({ code: "CV403" });
  });

  it("command receipts cannot be modified once completed", async () => {
    await expect(admin("update private.command_receipts set result = '{}' where status = 'completed'")).rejects.toMatchObject({ code: "CV403" });
  });
});

describe("function hardening", () => {
  it("every SECURITY DEFINER function pins an empty search_path", async () => {
    const rows = await admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public','private') and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c = 'search_path=""')`,
    );
    expect(rows).toEqual([]);
  });

  it("anon holds no privilege on any public table except the allowed reference/curated ones", async () => {
    const rows = await admin<{ table_name: string }>(
      `select distinct table_name from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public' and table_name not in ('barangays','public_clinics')`,
    );
    expect(rows).toEqual([]);
  });

  it("anon can execute only the three deliberately public functions", async () => {
    const rows = await admin<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')
          and p.proname not in ('list_public_clinics','public_queue_display','verify_certificate')`,
    );
    expect(rows).toEqual([]);
  });
});

describe("staff administration reads (P33)", () => {
  it("only access administrators can list memberships or look up profiles by email", async () => {
    const rows = await as(techAdmin, (q) => q<{ r: { role: string }[] }>("select public.list_staff_memberships($1) as r", [clinicA]));
    expect(rows[0].r.length).toBeGreaterThan(0);
    await expectCode(as(assistant, (q) => q("select public.list_staff_memberships($1)", [clinicA])), "CV403");
    await expectCode(as(stranger, (q) => q("select public.list_staff_memberships($1)", [clinicA])), "CV403");
    await expectCode(as(assistant, (q) => q("select public.find_profile_for_grant($1,'x@example.test')", [clinicA])), "CV403");
  });

  it("email lookup is exact, returns no email or clinical data, and is audited", async () => {
    const [{ email }] = await admin<{ email: string }>("select email from auth.users where id = $1", [newHire.id]);
    const hit = await as(techAdmin, (q) => q<{ r: Record<string, unknown> }>("select public.find_profile_for_grant($1,$2) as r", [clinicA, email.toUpperCase()]));
    expect(Object.keys(hit[0].r).sort()).toEqual(["displayName", "profileId"]);
    const miss = await as(techAdmin, (q) => q<{ r: unknown }>("select public.find_profile_for_grant($1,'nobody@example.test') as r", [clinicA]));
    expect(miss[0].r).toBeNull();
    const audits = await admin("select 1 from private.audit_logs where action = 'staff.profile_lookup'");
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("membership lists never include another clinic's staff", async () => {
    const other = await newUser("otherclinicstaff");
    await grant(org, clinicB, other, "assistant");
    const rows = await as(techAdmin, (q) => q<{ r: { profileId: string }[] }>("select public.list_staff_memberships($1) as r", [clinicA]));
    expect(rows[0].r.map((x) => x.profileId)).not.toContain(other.id);
  });
});
