import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, grant, makeClinic, makeOrg, newUser, op, pool, type Actor } from "./helpers";
import { clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
type R = { r: Record<string, unknown> };
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);
const T = (n: number) => isoDaysFromToday(n);

beforeAll(async () => {
  w = await clinicalWorld();
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

describe("clinic profile (P34)", () => {
  it("context excludes unusable staff grants and inactive profiles", async () => {
    const actor = await newUser("context-eligibility");
    const clinic = await makeClinic(w.org, "Context Clinic");
    const membership = await grant(w.org, clinic, actor, "assistant");
    const context = async () => (await as(actor, (q) => q<{ r: { memberships: { clinicId: string; clinicTimezone: string }[] } | null }>("select public.get_my_context() as r")))[0]!.r;
    await admin("update public.clinics set timezone = 'Pacific/Honolulu' where id = $1", [clinic]);
    expect((await context())?.memberships.find((m) => m.clinicId === clinic)?.clinicTimezone).toBe("Pacific/Honolulu");
    await admin("update public.staff_memberships set valid_from = now() + interval '1 day' where id = $1", [membership]);
    expect((await context())?.memberships).toEqual([]);
    await admin("update public.staff_memberships set valid_from = now() - interval '2 days', valid_until = now() - interval '1 day' where id = $1", [membership]);
    expect((await context())?.memberships).toEqual([]);
    await admin("update public.staff_memberships set valid_until = null where id = $1", [membership]);
    await admin("update public.clinics set status = 'suspended' where id = $1", [clinic]);
    expect((await context())?.memberships).toEqual([]);
    await admin("update public.profiles set status = 'suspended' where id = $1", [actor.id]);
    expect(await context()).toBeNull();
  });
  const update = (a: Actor, name = "Renamed Clinic", tz = "Asia/Manila", hours: string | null = "Mon-Fri 8am to 4pm", contact: string | null = "0917 000 1234") =>
    as(a, (q) => q("select public.update_clinic_profile($1,$2,$3,'Purok 1',$4,$5,$6)", [op(), w.clinic, name, contact, hours, tz]));
  const publicClinic = async () => ((await as(null, (q) => q<R>("select public.list_public_clinics() as r", [])))[0]!.r as unknown as { id: string; name: string; contact: string | null; hours: string | null }[]).find((c) => c.id === w.clinic)!;

  it("only admin.config can change it; input is validated; the public directory shows exactly what was typed", async () => {
    for (const a of [w.lead, w.clinician, w.assistant, w.g1, w.otherClinicStaff, { ...w.techAdmin, aal: "aal1" as const }]) await expectCode(update(a), "CV403");
    await expectCode(update(w.techAdmin, " "), "CV422");
    await expectCode(update(w.techAdmin, "X", "Mars/Olympus"), "CV422");
    await expectCode(update(w.techAdmin, "X", "Asia/Manila", "h".repeat(501)), "CV422");
    expect((await publicClinic()).hours).toBeNull();
    await update(w.techAdmin);
    expect(await publicClinic()).toMatchObject({ name: "Renamed Clinic", contact: "0917 000 1234", hours: "Mon-Fri 8am to 4pm" });
    await update(w.techAdmin, "Renamed Clinic", "Asia/Manila", null, null);
    expect(await publicClinic()).toMatchObject({ contact: null, hours: null }); // nothing invented when blank
  });

  it("keeps before and after in the audit trail and is idempotent per key", async () => {
    const key = op();
    const call = () => as(w.techAdmin, (q) => q("select public.update_clinic_profile($1,$2,'Twice Clinic','Purok 1',null,'9-5','Asia/Manila')", [key, w.clinic]));
    await Promise.all([call(), call()]);
    const a = await admin<{ before: { name: string }; after: { name: string } }>("select before, after from private.audit_logs where action = 'clinic.profile_changed' and entity_id = $1 order by server_time desc limit 1", [w.clinic]);
    expect(a[0]!.after.name).toBe("Twice Clinic");
    expect(a[0]!.before.name).toBe("Renamed Clinic");
    expect(await count("select count(*) n from private.audit_logs where action = 'clinic.profile_changed' and after ->> 'name' = 'Twice Clinic'")).toBe(1);
    expect(((await as(w.techAdmin, (q) => q<R>("select public.get_clinic_profile($1) as r", [w.clinic])))[0]!.r as { hours: string }).hours).toBe("9-5");
    await expectCode(as(w.lead, (q) => q("select public.get_clinic_profile($1)", [w.clinic])), "CV403");
  });
});

describe("reviewed care information (F19, P13)", () => {
  let guardianKid: string;
  const save = (a: Actor, code = "care-after-visit", lang = "en", title = "After the visit", body = "Write the clinic's approved text here for families to read.", src = "Clinic leaflet 2026", id: string | null = null) =>
    as(a, (q) => q<R>("select public.save_content_draft($1,$2,$3,$4,$5,$6,$7,$8) as r", [op(), w.clinic, code, lang, title, body, src, id])).then((x) => x[0]!.r);
  const submit = (a: Actor, id: string) => as(a, (q) => q("select public.submit_content($1,$2,$3)", [op(), w.clinic, id]));
  const review = (a: Actor, id: string, d = "approve", note: string | null = null) => as(a, (q) => q("select public.review_content($1,$2,$3,$4,$5)", [op(), w.clinic, id, d, note]));
  const listC = (a: Actor) => as(a, (q) => q<R>("select public.list_content($1) as r", [w.clinic])).then((x) => x[0]!.r as unknown as { versionId: string; code: string; language: string; status: string; title: string }[]);
  const mine = (a: Actor) => as(a, (q) => q<R>("select public.guardian_care_content() as r", [])).then((x) => x[0]!.r as unknown as { code: string; title: string; language: string; fallback: boolean; source: string }[] | null);

  beforeAll(async () => {
    const [{ r }] = await as(w.g1, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Content Kid", dob: T(-60) })]));
    guardianKid = r.childId as string;
    await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, guardianKid]));
    const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [w.g1.id, guardianKid]);
    await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
  });

  it("the system ships nothing: families see no care information until a second person approves the clinic's own text", async () => {
    expect(await mine(w.g1)).toEqual([]);
    for (const a of [w.assistant, w.inventory, w.g1, w.otherClinicStaff]) await expectCode(save(a), "CV403");
    await expectCode(save(w.techAdmin, "Bad Code"), "CV422");
    await expectCode(save(w.techAdmin, "care-x", "en", "ab"), "CV422");
    await expectCode(save(w.techAdmin, "care-x", "en", "A fine title", "too short"), "CV422");
    await expectCode(save(w.techAdmin, "care-x", "en", "A fine title", "This body is long enough for the rule.", " "), "CV422");
    await expectCode(save(w.techAdmin, "care-x", "de"), "CV422");
    const d = await save(w.techAdmin);
    const id = d.versionId as string;
    await expectCode(save(w.techAdmin), "CV409"); // one draft per item and language
    await expectCode(save(w.clinician, "care-after-visit", "en", "Changed", "Another long enough body for the check here.", "src", id), "CV403"); // only the author edits
    expect(await mine(w.g1)).toEqual([]);
    await submit(w.techAdmin, id);
    await expectCode(submit(w.techAdmin, id), "CV409");
    await expectCode(submit(w.clinician, id), "CV403");
    expect(await mine(w.g1)).toEqual([]); // submitted is not published
    await expectCode(review(w.techAdmin, id), "CV403"); // no rules.approve
    await expectCode(review(w.clinician, id), "CV403");
    await expectCode(review(w.lead, id, "maybe"), "CV422");
    await expectCode(review(w.lead, id, "reject", " "), "CV422");
    await review(w.lead, id);
    expect((await mine(w.g1))!.map((c) => c.code)).toEqual(["care-after-visit"]);
    expect((await mine(w.g1))![0]).toMatchObject({ title: "After the visit", language: "en", fallback: false, source: "Clinic leaflet 2026" });
  });

  it("the author cannot approve their own wording; approved wording is frozen; a newer approved version replaces the old one", async () => {
    const own = (await save(w.lead, "care-own", "en", "Written by the lead", "A body that is definitely long enough to pass.")).versionId as string;
    await submit(w.lead, own);
    await expectCode(review(w.lead, own), "CV403");
    await review(w.lead2, own);
    const active = (await listC(w.lead)).find((c) => c.versionId === own)!;
    expect(active.status).toBe("active");
    await expectCode(admin("update public.content_versions set body = 'sneaky replacement text that is long enough' where id = $1", [own]), "CV403");
    await expectCode(admin("delete from public.content_versions where id = $1", [own]), "CV403");
    await expectCode(admin("truncate public.content_versions cascade"), "CV403");
    const v2 = (await save(w.techAdmin, "care-own", "en", "Second wording", "Another body that is definitely long enough.")).versionId as string;
    await submit(w.techAdmin, v2);
    await review(w.lead, v2, "approve", "checked against the leaflet");
    const all = await listC(w.lead);
    expect(all.find((c) => c.versionId === own)!.status).toBe("retired");
    expect(all.find((c) => c.versionId === v2)!.status).toBe("active");
    expect((await mine(w.g1))!.find((c) => c.code === "care-own")!.title).toBe("Second wording");
    // rejection keeps the text on record but never shows it
    const bad = (await save(w.techAdmin, "care-rejected", "en", "Not approved", "A body that is long enough but will be rejected.")).versionId as string;
    await submit(w.techAdmin, bad);
    await review(w.lead, bad, "reject", "does not match the leaflet");
    expect((await mine(w.g1))!.map((c) => c.code)).not.toContain("care-rejected");
    expect((await listC(w.lead)).find((c) => c.versionId === bad)!.status).toBe("rejected");
  });

  it("families see their own language with a marked English fallback; unrelated users see nothing; withdrawing is immediate", async () => {
    const fil = (await save(w.techAdmin, "care-after-visit", "fil", "Pagkatapos ng bisita", "Ito ang nakasulat na teksto ng klinika para sa mga pamilya.")).versionId as string;
    await submit(w.techAdmin, fil);
    await review(w.lead, fil);
    expect((await mine(w.g1))!.find((c) => c.code === "care-after-visit")!.language).toBe("en"); // preferred language is English
    await as(w.g1, (q) => q("select public.set_contact_preferences($1,'fil',null,null)", [op()]));
    expect((await mine(w.g1))!.find((c) => c.code === "care-after-visit")).toMatchObject({ language: "fil", fallback: false });
    expect((await mine(w.g1))!.find((c) => c.code === "care-own")).toMatchObject({ language: "en", fallback: true });
    expect(await mine(w.g2)).toEqual([]);
    expect(await mine(w.otherClinicStaff)).toEqual([]);
    await expectCode(as(null, (q) => q("select public.guardian_care_content()")), "42501");
    await as(w.lead, (q) => q("select public.retire_content($1,$2,$3,'no longer accurate')", [op(), w.clinic, fil]));
    expect((await mine(w.g1))!.find((c) => c.code === "care-after-visit")).toMatchObject({ language: "en", fallback: true });
    await expectCode(as(w.lead, (q) => q("select public.retire_content($1,$2,$3,'again')", [op(), w.clinic, fil])), "CV409");
    await expectCode(as(w.techAdmin, (q) => q("select public.retire_content($1,$2,$3,'nope')", [op(), w.clinic, fil])), "CV403");
    for (const t of ["public.content_items", "public.content_versions"]) await expectCode(as(w.g1, (q) => q(`select * from ${t}`)), "42501");
  });
});

describe("audit search (P39)", () => {
  const search = (a: Actor, args: { action?: string; actor?: string; from?: string; to?: string; before?: string; limit?: number } = {}, clinic = w.clinic) =>
    as(a, (q) => q<R>("select public.search_audit($1,$2,$3,$4,$5,$6,$7) as r", [clinic, args.action ?? null, args.actor ?? null, args.from ?? null, args.to ?? null, args.before ?? null, args.limit ?? 50])).then((x) => x[0]!.r as unknown as { rows: { id: string; action: string; actor: string | null; actorId: string | null; at: string }[]; nextBefore: string | null });

  it("needs audit.read; filters, paginates, and every search is itself on record", async () => {
    for (const a of [w.clinician, w.assistant, w.inventory, w.techAdmin, w.g1, { ...w.lead, aal: "aal1" as const }]) await expectCode(search(a), "CV403");
    const all = await search(w.lead, { limit: 5 });
    expect(all.rows).toHaveLength(5);
    expect(all.nextBefore).toBeTruthy();
    const page2 = await search(w.lead, { limit: 5, before: all.nextBefore! });
    expect(page2.rows.map((r) => r.id).filter((id) => all.rows.some((x) => x.id === id))).toEqual([]);
    const profile = await search(w.lead, { action: "clinic.profile" });
    expect(profile.rows.length).toBeGreaterThan(0);
    expect(profile.rows.every((r) => r.action.startsWith("clinic.profile"))).toBe(true);
    const byActor = await search(w.lead, { actor: w.techAdmin.id, limit: 100 });
    expect(byActor.rows.length).toBeGreaterThan(0);
    expect(byActor.rows.every((r) => r.actorId === w.techAdmin.id)).toBe(true);
    expect((await search(w.lead, { from: new Date(Date.now() + 864e5).toISOString() })).rows).toEqual([]);
    await expectCode(search(w.lead, { from: new Date().toISOString(), to: new Date(Date.now() - 864e5).toISOString() }), "CV422");
    expect((await search(w.lead, { action: "%" })).rows.length).toBeGreaterThan(0); // wildcards are not interpreted
    expect(await count("select count(*) n from private.audit_logs where action = 'audit.searched' and actor_id = $1", [w.lead.id])).toBeGreaterThanOrEqual(6);
  });

  it("never reaches another organization's records and offers no way to change them", async () => {
    const org2 = await makeOrg("Other Org");
    const clinic2 = await makeClinic(org2, "Other Org Clinic");
    const lead2 = await newUser("lead-other-org");
    await grant(org2, clinic2, lead2, "clinical_lead");
    await as(lead2, (q) => q("select public.update_clinic_profile($1,$2,'x','y',null,null,'Asia/Manila')", [op(), clinic2]).catch(() => undefined));
    const rows = (await search(lead2, { limit: 100 }, clinic2)).rows;
    const ours = await admin<{ id: string }>("select id from private.audit_logs where organization_id = $1", [w.org]);
    expect(rows.some((r) => ours.some((o) => o.id === r.id))).toBe(false);
    await expectCode(search(lead2, {}, w.clinic), "CV403");
    await expectCode(admin("update private.audit_logs set action = 'x'"), "CV403");
    await expectCode(admin("delete from private.audit_logs"), "CV403");
  });
});

describe("operations status (P40)", () => {
  const record = (a: Actor, kind = "restore_drill", result = "passed", on = T(0), evidence = "drill log 2026-10-01") => as(a, (q) => q("select public.record_ops_check($1,$2,$3,$4,$5,$6)", [op(), w.clinic, kind, result, on, evidence]));
  const status = (a: Actor) => as(a, (q) => q<R>("select public.get_ops_status($1) as r", [w.clinic])).then((x) => x[0]!.r as unknown as { checks: Record<string, { result: string; daysAgo: number; evidence: string } | null>; jobs: { queued: number; failed: number }; sms: { queued: number; failed: number } });

  it("unknown stays unknown until someone records evidence; only recorded facts are shown", async () => {
    const before = await status(w.techAdmin);
    expect(before.checks).toEqual({ restore_drill: null, database_backup: null, file_backup: null });
    await expectCode(record(w.lead), "CV403");
    await expectCode(record(w.techAdmin, "restore_drill", "passed", T(1)), "CV422");
    await expectCode(record(w.techAdmin, "restore_drill", "passed", T(0), "x"), "CV422");
    await expectCode(record(w.techAdmin, "coffee", "passed"), "CV422");
    await record(w.techAdmin, "restore_drill", "failed", T(-3), "drill ticket OPS-12");
    await record(w.techAdmin, "restore_drill", "passed", T(0), "drill ticket OPS-15");
    const s = await status(w.lead); // audit.read may read it too
    expect(s.checks.restore_drill).toMatchObject({ result: "passed", daysAgo: 0, evidence: "drill ticket OPS-15" });
    expect(s.checks.database_backup).toBeNull();
    await expectCode(status(w.clinician), "CV403");
    await expectCode(admin("update public.ops_checks set result = 'passed'"), "CV403");
  });

  it("reports queue health from the real outbox and SMS tables", async () => {
    await admin("insert into private.outbox_jobs (organization_id, job_type, aggregate_type, aggregate_id, dedupe_key, status) values ($1,'sms.send','x',gen_random_uuid(),'ops-failed','failed')", [w.org]);
    await admin("insert into private.outbox_jobs (organization_id, job_type, aggregate_type, aggregate_id, dedupe_key, available_at) values ($1,'appointment.confirmation','x',gen_random_uuid(),'ops-queued', now() - interval '30 minutes')", [w.org]);
    const s = await status(w.techAdmin);
    expect(s.jobs.failed).toBeGreaterThanOrEqual(1);
    expect(s.jobs.queued).toBeGreaterThanOrEqual(1);
    expect((s.jobs as unknown as { oldestQueuedMinutes: number }).oldestQueuedMinutes).toBeGreaterThanOrEqual(29);
    expect(s.sms).toMatchObject({ queued: expect.any(Number), failed: expect.any(Number) });
  });
});
