import { createHash, createHmac, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, expectCode, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, isoDaysFromToday, setDemoMode, type ClinicalWorld } from "./clinical-setup";

let w: ClinicalWorld;
let main: string;
let seq = 0;
type R = { r: Record<string, unknown> };
const T = (n: number) => isoDaysFromToday(n);
const count = async (sql: string, p: unknown[] = []) => Number((await admin<{ n: string }>(sql, p))[0]!.n);

/** A structurally valid PDF stand-in (the database checks the header, size and checksum, not the drawing). */
const fakePdf = () => Buffer.from(`%PDF-1.4\n% test certificate ${randomBytes(8).toString("hex")} ${"x".repeat(300)}\n%%EOF\n`);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const attestationSecret = "certificate-test-secret-for-disposable-database-only-2026";
type Render = { token: string; tokenHash: string; contentHash: string; snapshot: { entries: Record<string, unknown>[]; child: Record<string, unknown> }; certificateNo: string };
const attest = (id: string, r: Render, pdfHash: string, secret = attestationSecret) => createHmac("sha256", secret).update(`${id}:${r.contentHash}:${r.tokenHash}:${pdfHash}`).digest("hex");

async function guardianChild(g: Actor, name = "Cert Kid") {
  const [{ r }] = await as(g, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: `${name} ${++seq}`, dob: T(-60) })]));
  const id = r.childId as string;
  await as(w.assistant, (q) => q("select public.confirm_child_identity($1,$2,$3,1)", [op(), w.clinic, id]));
  const rel = await admin<{ id: string }>("select r.id from public.guardian_child_relationships r join public.guardians gg on gg.id = r.guardian_id where gg.profile_id = $1 and r.child_id = $2", [g.id, id]);
  await as(w.assistant, (q) => q("select public.verify_relationship($1,$2,$3,'in_person_id')", [op(), w.clinic, rel[0]!.id]));
  return id;
}
const outsideDose = (child: string, code: string, on: string, verified = true) =>
  as(w.clinician, (q) => q<R>("select public.record_outside_dose_staff($1,$2,$3,$4,$5,$6) as r", [op(), w.clinic, child, JSON.stringify({ productText: code, administeredOn: on, provider: "Other Clinic X" }), w.products[code], verified]));

async function openEncounter(childId: string) {
  const ci = (await as(w.assistant, (q) => q<R>("select public.check_in($1,$2,$3,null,'cert test') as r", [op(), w.clinic, childId])))[0]!.r;
  const called = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'called',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, ci.version])))[0]!.r;
  const started = (await as(w.assistant, (q) => q<R>("select public.queue_transition($1,$2,$3,'in_service',$4,'S1') as r", [op(), w.clinic, ci.queueEntryId, called.version])))[0]!.r;
  return started.encounterId as string;
}
async function clinicDose(childId: string, lotCode: string) {
  const lot = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,$4,$5) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], lotCode, T(200)])))[0]!.r.lotId as string;
  await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,5,'DR-CERT')", [op(), w.clinic, main, lot]));
  const enc = await openEncounter(childId);
  const res = (await as(w.clinician, (q) => q<R>("select public.record_administration($1,$2,$3,$4) as r", [op(), w.clinic, enc, JSON.stringify({ lotId: lot, locationId: main, route: "IM", site: "left thigh", assessmentReference: "A", consentReference: "C" })])))[0]!.r;
  const ev = (await admin<{ event_id: string }>("select event_id from public.vaccination_revisions where id = $1", [res.revisionId]))[0]!.event_id;
  return { lot, eventId: ev };
}

const prepare = (actor: Actor, child: string, replaces: string | null = null) =>
  as(actor, (q) => q<R>("select public.issue_certificate($1,$2,$3,$4) as r", [op(), w.clinic, child, replaces])).then((x) => x[0]!.r);
const render = (actor: Actor, id: string) => as(actor, (q) => q<R>("select public.begin_certificate_render($1) as r", [id])).then((x) => x[0]!.r as Render);
const store = (actor: Actor, id: string, r: Render, pdf = fakePdf(), hash = sha(pdf), key = op(), signature = attest(id, r, hash)) =>
  as(actor, (q) => q<R>("select public.store_certificate_pdf($1,$2,$3,$4,$5,$6,$7) as r", [key, id, r.contentHash, r.tokenHash, pdf.toString("base64"), hash, signature])).then((x) => x[0]!.r);
/** prepare -> render -> store; returns everything a test needs. */
async function issue(child: string, replaces: string | null = null) {
  const c = await prepare(w.lead, child, replaces);
  const pdf = fakePdf();
  const rr = await render(w.lead, c.certificateId as string);
  await store(w.lead, c.certificateId as string, rr, pdf);
  return { id: c.certificateId as string, no: c.certificateNo as string, token: rr.token, pdf, snapshot: rr.snapshot };
}
const verify = (token: string) => as(null, (q) => q<{ r: Record<string, unknown> | null }>("select public.verify_certificate($1) as r", [token])).then((x) => x[0]!.r);
const work = async () => (await admin<{ r: Record<string, number> }>("select private.process_outbox(500) as r"))[0]!.r;
const inbox = (a: Actor) => as(a, (q) => q<R>("select public.my_messages(100) as r", [])).then((x) => x[0]!.r as { unread: number; items: { id: string; title: string; body: string; kind: string; read: boolean }[] });

beforeAll(async () => {
  await admin("insert into private.certificate_render_secrets (id, secret) values (true, $1)", [attestationSecret]);
  w = await clinicalWorld();
  await activateDemoSchedule(w, "cert-v1");
  main = (await as(w.inventory, (q) => q<R>("select public.create_stock_location($1,$2,'Main fridge','usable') as r", [op(), w.clinic])))[0]!.r.locationId as string;
  await as(w.assistant, (q) => q("select public.create_session($1,$2,$3)", [op(), w.clinic, JSON.stringify({ serviceDate: T(0), startTime: "00:00", endTime: "23:59", totalCapacity: 200, onlineCapacity: 100, walkinCapacity: 100 })]));
});
afterAll(async () => {
  await admin("drop trigger if exists fail_message_insert on public.messages").catch(() => undefined);
  await admin("drop function if exists public.fail_message_insert()").catch(() => undefined);
  await setDemoMode(false);
  await pool.end();
});

describe("issuing a certificate (F16)", () => {
  it("freezes verified, active revisions only; clinic doses show the lot, outside doses show their source", async () => {
    const kid = await guardianChild(w.g1);
    const d = await clinicDose(kid, "CERT-LOT-1");
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    await outsideDose(kid, "DEMO-P-GAMMA", T(-10), false); // pending: must NOT be certified
    const c = await issue(kid);
    const entries = c.snapshot.entries;
    expect(entries).toHaveLength(2);
    const clinic = entries.find((e) => e.source === "clinic")!;
    const elsewhere = entries.find((e) => e.source === "recorded_elsewhere")!;
    expect(clinic.lot).toBe("CERT-LOT-1");
    expect(elsewhere.lot).toBeNull();
    expect(elsewhere.provider).toBe("Other Clinic X");
    expect(c.snapshot.child).toMatchObject({ recordNo: expect.stringMatching(/^CV-/) });
    expect(await count("select count(*) n from public.certificate_items where certificate_id = $1", [c.id])).toBe(2);
    const row = (await admin<{ status: string; content_hash: string; issued_at: string | null; verification_token_hash: string }>("select status, content_hash, issued_at, verification_token_hash from public.certificates where id = $1", [c.id]))[0]!;
    expect(row.status).toBe("issued");
    expect(row.issued_at).toBeTruthy();
    expect(row.content_hash).toBe((await admin<{ h: string }>("select encode(sha256(convert_to(snapshot::text,'UTF8')),'hex') h from public.certificates where id = $1", [c.id]))[0]!.h);
    expect(d.eventId).toBeTruthy();
  });

  it("refuses a child with nothing verified, and anyone without the issuer capability, MFA or clinic scope", async () => {
    const empty = await guardianChild(w.g2, "Empty");
    await expectCode(prepare(w.lead, empty), "CV422");
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    for (const a of [w.assistant, w.clinician, w.inventory, w.g1, w.otherClinicStaff, { ...w.lead, aal: "aal1" as const }]) await expectCode(prepare(a, kid), "CV403");
    expect(await count("select count(*) n from public.certificates where child_id = $1", [kid])).toBe(0);
  });

  it("is idempotent per operation key", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const key = op();
    const call = () => as(w.lead, (q) => q<R>("select public.issue_certificate($1,$2,$3,null) as r", [key, w.clinic, kid]));
    const [a, b] = await Promise.all([call(), call()]);
    expect(a[0]!.r.certificateId).toBe(b[0]!.r.certificateId);
    expect(await count("select count(*) n from public.certificates where child_id = $1", [kid])).toBe(1);
  });

  it("stays pending until the document is stored, and never keeps the token in clear text", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const c = await prepare(w.lead, kid);
    const id = c.certificateId as string;
    expect(await verify("0".repeat(64))).toBeNull();
    const rr = await render(w.lead, id);
    expect(await verify(rr.token)).toBeNull(); // pending certificates are not verifiable
    expect(await count("select count(*) n from private.command_receipts where result::text like '%' || $1 || '%'", [rr.token])).toBe(0);
    expect(await count("select count(*) n from public.certificates where snapshot::text like '%' || $1 || '%' or verification_token_hash = $1", [rr.token])).toBe(0);
    // a retry may rotate the token; the previous one stops working
    const rr2 = await render(w.lead, id);
    expect(rr2.token).not.toBe(rr.token);
    await expectCode(store(w.lead, id, rr), "CV409");
    await store(w.lead, id, rr2);
    expect(await verify(rr.token)).toBeNull();
    expect((await verify(rr2.token))!.status).toBe("valid");
    await expectCode(render(w.lead, id), "CV409");
    await expectCode(store(w.lead, id, rr2), "CV409");
  });

  it("rejects a document that is not a PDF, has the wrong checksum, or is oversized", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const id = (await prepare(w.lead, kid)).certificateId as string;
    const notStarted = { contentHash: "0".repeat(64), tokenHash: "0".repeat(64) } as Render;
    await expectCode(store(w.lead, id, notStarted), "CV409"); // render not started
    const rr = await render(w.lead, id);
    const notPdf = Buffer.from("<html>" + "x".repeat(400));
    await expectCode(store(w.lead, id, rr, notPdf), "CV422");
    await expectCode(store(w.lead, id, rr, fakePdf(), "a".repeat(64)), "CV422");
    await expectCode(as(w.lead, (q) => q("select public.store_certificate_pdf($1,$2,$3,$4,$5,$6,$7)", [op(), id, rr.contentHash, rr.tokenHash, "A".repeat(2_900_000), "0".repeat(64), "0".repeat(64)])), "CV422");
    await expectCode(store(w.clinician, id, rr), "CV404");
    expect((await admin<{ status: string }>("select status from public.certificates where id = $1", [id]))[0]!.status).toBe("pending");
  });

  it("retires a frozen pending artifact so corrected source data can be certified afresh", async () => {
    const kid = await guardianChild(w.g1, "Pending repair");
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const pending = await prepare(w.lead, kid);
    const id = pending.certificateId as string;
    const rr = await render(w.lead, id);
    await expectCode(as(w.clinician, (q) => q("select public.revoke_certificate($1,$2,$3,'unsupported PDF glyph')", [op(), w.clinic, id])), "CV403");
    const key = op();
    const retire = () => as(w.lead, (q) => q<R>("select public.revoke_certificate($1,$2,$3,'unsupported PDF glyph') as r", [key, w.clinic, id])).then((x) => x[0]!.r);
    const first = await retire();
    expect(await retire()).toEqual(first);
    await expectCode(as(w.lead, (q) => q("select public.revoke_certificate($1,$2,$3,'different reason')", [key, w.clinic, id])), "CV409");
    const row = (await admin<{ status: string; issued_at: string | null; verification_token_hash: string | null; revocation_reason: string }>("select status, issued_at, verification_token_hash, revocation_reason from public.certificates where id = $1", [id]))[0]!;
    expect(row).toMatchObject({ status: "revoked", issued_at: null, verification_token_hash: null, revocation_reason: "unsupported PDF glyph" });
    expect(await verify(rr.token)).toBeNull();
    await expectCode(render(w.lead, id), "CV409");
    await expectCode(store(w.lead, id, rr), "CV409");
    expect((await as(w.g1, (q) => q<R>("select public.guardian_list_certificates($1) as r", [kid])))[0]!.r).toEqual([]);
    const fresh = await issue(kid);
    expect(fresh.id).not.toBe(id);
    expect((await verify(fresh.token))?.status).toBe("valid");
    expect(await count("select count(*) n from private.audit_logs where action = 'certificate.retired_pending' and entity_id = $1", [id])).toBe(1);
  });

  it("rejects missing or forged render attestations and removes the old unbound RPC", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const id = (await prepare(w.lead, kid)).certificateId as string;
    const rr = await render(w.lead, id);
    const pdf = fakePdf();
    const otherPdf = fakePdf();
    await expectCode(store(w.lead, id, { ...rr, contentHash: "0".repeat(64) }), "CV409");
    await expectCode(store(w.lead, id, rr, pdf, sha(pdf), op(), ""), "CV403");
    await expectCode(store(w.lead, id, rr, pdf, sha(pdf), op(), "0".repeat(64)), "CV403");
    await expectCode(store(w.lead, id, rr, otherPdf, sha(otherPdf), op(), attest(id, rr, sha(pdf))), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.store_certificate_pdf($1,$2,$3,$4)", [op(), id, pdf.toString("base64"), sha(pdf)])), "42883");
    expect((await verify(rr.token))).toBeNull();
    await store(w.lead, id, rr, pdf);
    expect((await verify(rr.token))?.status).toBe("valid");
  });

  it("replays the same committed store after an unknown response without needing the raw token", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const id = (await prepare(w.lead, kid)).certificateId as string;
    const rr = await render(w.lead, id);
    const pdf = fakePdf();
    const key = op();
    const first = await store(w.lead, id, rr, pdf, sha(pdf), key);
    const replay = await store(w.lead, id, rr, pdf, sha(pdf), key);
    expect(replay).toEqual(first);
    await expectCode(store(w.lead, id, rr, fakePdf(), undefined, key), "CV409");
    expect(await count("select count(*) n from private.certificate_documents where certificate_id = $1", [id])).toBe(1);
    expect(await count("select count(*) n from private.command_receipts where result::text like '%' || $1 || '%'", [rr.token])).toBe(0);
  });

  it("fails closed without the private secret and invalidates an attestation after rotation", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const id = (await prepare(w.lead, kid)).certificateId as string;
    const rr = await render(w.lead, id);
    const pdf = fakePdf();
    await admin("delete from private.certificate_render_secrets");
    try {
      await expectCode(store(w.lead, id, rr, pdf), "CV503");
      await admin("insert into private.certificate_render_secrets (id, secret) values (true, $1)", [attestationSecret + "-rotated"]);
      await expectCode(store(w.lead, id, rr, pdf), "CV403");
      await store(w.lead, id, rr, pdf, sha(pdf), op(), attest(id, rr, sha(pdf), attestationSecret + "-rotated"));
      expect((await verify(rr.token))?.status).toBe("valid");
    } finally {
      await admin("insert into private.certificate_render_secrets (id, secret) values (true, $1) on conflict (id) do update set secret = excluded.secret", [attestationSecret]);
    }
  });

  it("serializes simultaneous begins and accepts only the last token generation", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const id = (await prepare(w.lead, kid)).certificateId as string;
    const [a, b] = await Promise.all([render(w.lead, id), render(w.lead, id)]);
    expect(a.tokenHash).not.toBe(b.tokenHash);
    const current = (await admin<{ verification_token_hash: string }>("select verification_token_hash from public.certificates where id = $1", [id]))[0]!.verification_token_hash;
    const live = a.tokenHash === current ? a : b;
    const stale = a.tokenHash === current ? b : a;
    await expectCode(store(w.lead, id, stale), "CV409");
    await store(w.lead, id, live);
    expect(await verify(stale.token)).toBeNull();
    expect((await verify(live.token))?.status).toBe("valid");
  });

  it("keeps the signing secret private from authenticated callers", async () => {
    await expectCode(as(w.lead, (q) => q("select secret from private.certificate_render_secrets")), "42501");
    const grants = (await admin<{ old_rpc: boolean | null; new_rpc: boolean }>(
      "select to_regprocedure('public.store_certificate_pdf(uuid,uuid,text,text)') is not null old_rpc, has_function_privilege('authenticated', 'public.store_certificate_pdf(uuid,uuid,text,text,text,text,text)', 'EXECUTE') new_rpc",
    ))[0]!;
    expect(grants).toEqual({ old_rpc: false, new_rpc: true });
  });
});

describe("immutability and privacy (T23)", () => {
  it("issued snapshots, items and documents cannot be rewritten, deleted or truncated — even by a superuser", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const c = await issue(kid);
    await expectCode(admin("update public.certificates set snapshot = '{}'::jsonb where id = $1", [c.id]), "CV403");
    await expectCode(admin("update public.certificates set certificate_no = 'X' where id = $1", [c.id]), "CV403");
    await expectCode(admin("update public.certificates set verification_token_hash = repeat('a',64) where id = $1", [c.id]), "CV403");
    await expectCode(admin("delete from public.certificates where id = $1", [c.id]), "CV403");
    await expectCode(admin("truncate public.certificates cascade"), "CV403");
    await expectCode(admin("update public.certificate_items set vaccination_revision_id = vaccination_revision_id where certificate_id = $1", [c.id]), "CV403");
    await expectCode(admin("update private.certificate_documents set sha256 = 'x' where certificate_id = $1", [c.id]), "CV403");
    await expectCode(admin("delete from private.certificate_documents where certificate_id = $1", [c.id]), "CV403");
  });

  it("no direct table access for API roles; the public function answers with minimal fields only", async () => {
    const kid = await guardianChild(w.g1, "Private Kid");
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const c = await issue(kid);
    for (const t of ["public.certificates", "public.certificate_items", "public.messages"]) {
      await expectCode(as(w.g1, (q) => q(`select * from ${t}`)), "42501");
      await expectCode(as(null, (q) => q(`select * from ${t}`)), "42501");
    }
    await expectCode(as(null, (q) => q("select * from private.certificate_documents")), "42501");
    const v = (await verify(c.token))!;
    expect(Object.keys(v).sort()).toEqual(["certificateNo", "clinicName", "issuedOn", "status"]);
    expect(JSON.stringify(v)).not.toMatch(/Private Kid|dob|entries/i);
    expect(v).toMatchObject({ status: "valid", certificateNo: c.no, clinicName: "Clinical Clinic" });
    for (const bad of ["", "abc", c.token.toUpperCase(), c.token.slice(0, 63), c.token + "0", "%".repeat(64), "0".repeat(64)]) expect(await verify(bad)).toBeNull();
    await expectCode(as(null, (q) => q("select public.issue_certificate($1,$2,$3,null)", [op(), w.clinic, kid])), "42501");
    await expectCode(as(null, (q) => q("select public.get_certificate_pdf($1)", [c.id])), "42501");
  });
});

describe("guardian access and reprints (BP20)", () => {
  it("a linked guardian downloads the very same stored document; others and unverified links cannot", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const c = await issue(kid);
    const list = (await as(w.g1, (q) => q<R>("select public.guardian_list_certificates($1) as r", [kid])))[0]!.r as unknown as { certificateNo: string; status: string }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ certificateNo: c.no, status: "issued" });
    const one = (await as(w.g1, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r;
    const two = (await as(w.g1, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r;
    expect(one.pdfBase64).toBe(two.pdfBase64);
    expect(Buffer.from(one.pdfBase64 as string, "base64").equals(c.pdf)).toBe(true);
    expect(one.sha256).toBe(sha(c.pdf));
    expect((await as(w.g2, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r).toBeNull();
    expect((await as(w.g2, (q) => q<R>("select public.guardian_list_certificates($1) as r", [kid])))[0]!.r).toBeNull();
    expect((await as(w.otherClinicStaff, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r).toBeNull();
    expect(await count("select count(*) n from private.audit_logs where action = 'certificate.downloaded' and entity_id = $1", [c.id])).toBe(2);
    // an unverified (provisional) link gives no certificate access
    const unverified = await as(w.g2, (q) => q<R>("select public.create_child_provisional($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ displayName: "Unverified", dob: T(-50) })]));
    expect((await as(w.g2, (q) => q<R>("select public.guardian_list_certificates($1) as r", [unverified[0]!.r.childId])))[0]!.r).toBeNull();
  });

  it("staff see all states with reasons and can still download a revoked document; guardians cannot", async () => {
    const kid = await guardianChild(w.g1);
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const c = await issue(kid);
    await expectCode(as(w.clinician, (q) => q("select public.revoke_certificate($1,$2,$3,'because')", [op(), w.clinic, c.id])), "CV403");
    await expectCode(as(w.lead, (q) => q("select public.revoke_certificate($1,$2,$3,' ')", [op(), w.clinic, c.id])), "CV422");
    await as(w.lead, (q) => q("select public.revoke_certificate($1,$2,$3,'issued to the wrong family')", [op(), w.clinic, c.id]));
    await expectCode(as(w.lead, (q) => q("select public.revoke_certificate($1,$2,$3,'again')", [op(), w.clinic, c.id])), "CV409");
    const staffList = (await as(w.lead, (q) => q<R>("select public.list_child_certificates($1,$2) as r", [w.clinic, kid])))[0]!.r as unknown as { status: string; revocationReason: string }[];
    expect(staffList[0]).toMatchObject({ status: "revoked", revocationReason: "issued to the wrong family" });
    expect((await as(w.lead, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r).not.toBeNull();
    expect((await as(w.g1, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r).toBeNull();
    expect((await verify(c.token))!.status).toBe("revoked");
    await expectCode(admin("update public.certificates set status = 'issued' where id = $1", [c.id]), "CV403");
  });
});

describe("corrections and replacement (T23)", () => {
  const correct = async (eventId: string, proposal: Record<string, unknown>) => {
    const k = (await as(w.clinician, (q) => q<R>("select public.request_correction($1,$2,$3,'correct_details',$4,'fix') as r", [op(), w.clinic, eventId, JSON.stringify(proposal)])))[0]!.r;
    await as(w.lead, (q) => q("select public.approve_correction($1,$2,$3,'ok')", [op(), w.clinic, k.caseId]));
  };

  it("correcting a fact the certificate shows marks it under review, keeps the old snapshot, and a replacement links to it", async () => {
    const kid = await guardianChild(w.g1);
    const a = await clinicDose(kid, "CERT-LOT-A");
    const before = await issue(kid);
    const snapBefore = (await admin<{ s: string }>("select snapshot::text s from public.certificates where id = $1", [before.id]))[0]!.s;
    // a route/site-only change does not alter what the certificate shows
    await correct(a.eventId, { route: "SC", site: "right arm" });
    expect((await verify(before.token))!.status).toBe("valid");
    // a different vial does
    const lotB = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'CERT-LOT-B',$4) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], T(200)])))[0]!.r.lotId as string;
    await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,5,'DR-B')", [op(), w.clinic, main, lotB]));
    await correct(a.eventId, { lotId: lotB, locationId: main });
    expect((await verify(before.token))!.status).toBe("under_review");
    expect((await admin<{ s: string }>("select snapshot::text s from public.certificates where id = $1", [before.id]))[0]!.s).toBe(snapBefore);

    const repl = await issue(kid, before.id);
    expect(repl.snapshot.entries[0]!.lot).toBe("CERT-LOT-B");
    const old = (await admin<{ status: string; revocation_reason: string; review_needed: boolean }>("select status, revocation_reason, review_needed from public.certificates where id = $1", [before.id]))[0]!;
    expect(old).toMatchObject({ status: "revoked", revocation_reason: `Replaced by ${repl.no}`, review_needed: false });
    expect((await verify(before.token))!.status).toBe("revoked");
    expect((await verify(repl.token))!.status).toBe("valid");
    const list = (await as(w.lead, (q) => q<R>("select public.list_child_certificates($1,$2) as r", [w.clinic, kid])))[0]!.r as unknown as { certificateNo: string; replacesNo: string | null }[];
    expect(list.find((x) => x.certificateNo === repl.no)!.replacesNo).toBe(before.no);
    // only one live replacement, and the same child only
    await expectCode(prepare(w.lead, kid, before.id).then(() => prepare(w.lead, kid, before.id)), "CV409");
  });

  it("voiding a certified record flags the certificate; a replacement without it is refused when nothing verified remains", async () => {
    const kid = await guardianChild(w.g1);
    const a = await clinicDose(kid, "CERT-LOT-V");
    const c = await issue(kid);
    const k = (await as(w.clinician, (q) => q<R>("select public.request_correction($1,$2,$3,'void_duplicate',$4,'duplicate') as r", [op(), w.clinic, a.eventId, JSON.stringify({ stockEffect: "return_to_stock" })])))[0]!.r;
    await as(w.lead, (q) => q("select public.approve_correction($1,$2,$3,'ok')", [op(), w.clinic, k.caseId]));
    expect((await verify(c.token))!.status).toBe("under_review");
    await expectCode(prepare(w.lead, kid, c.id), "CV422");
    // another family's certificate is never a valid replacement target
    const other = await guardianChild(w.g2);
    await outsideDose(other, "DEMO-P-GAMMA", T(-20));
    await expectCode(prepare(w.lead, other, c.id), "CV404");
  });
});

describe("merged records (T11)", () => {
  it("a certificate issued for a duplicate stays attributable to the surviving child and can be listed, downloaded and replaced", async () => {
    const dup = await guardianChild(w.g1, "Dup Kid");
    await outsideDose(dup, "DEMO-P-GAMMA", T(-20));
    const c = await issue(dup);
    const [{ r }] = await as(w.assistant, (q) => q<R>("select public.register_child_staff($1,$2,$3,null,true,true) as r", [op(), w.clinic, JSON.stringify({ displayName: `Survivor ${++seq}`, dob: T(-60) })]));
    const survivor = r.childId as string;
    await as(w.lead, (q) => q("select public.merge_children($1,$2,$3,$4,'confirmed same child by document')", [op(), w.clinic, survivor, dup]));
    const list = (await as(w.lead, (q) => q<R>("select public.list_child_certificates($1,$2) as r", [w.clinic, survivor])))[0]!.r as unknown as { certificateNo: string }[];
    expect(list.map((x) => x.certificateNo)).toContain(c.no);
    expect((await as(w.lead, (q) => q<R>("select public.get_certificate_pdf($1) as r", [c.id])))[0]!.r).not.toBeNull();
    expect((await verify(c.token))!.status).toBe("valid");
    const repl = await issue(survivor, c.id);
    expect((await verify(c.token))!.status).toBe("revoked");
    expect((await verify(repl.token))!.status).toBe("valid");
  });
});

describe("in-app messages and the outbox worker (BP22)", () => {
  it("delivers certificate and visit messages to verified guardians only, exactly once", async () => {
    const kid = await guardianChild(w.g1, "Msg Kid");
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const c = await issue(kid);
    // Message delivery needs a bookable visit, independent of when today's shared session ends.
    const slot = (await as(w.assistant, (q) => q<R>("select public.create_session($1,$2,$3) as r", [op(), w.clinic, JSON.stringify({ serviceDate: T(1), startTime: "08:00", endTime: "12:00", totalCapacity: 10, onlineCapacity: 10, walkinCapacity: 0 })])))[0]!.r.sessionId as string;
    const appt = (await as(w.g1, (q) => q<R>("select public.book_appointment($1,$2,$3,null) as r", [op(), kid, slot])))[0]!.r;
    const first = await work();
    expect(first.done).toBeGreaterThanOrEqual(2);
    const box = await inbox(w.g1);
    const titles = box.items.filter((m) => m.body.includes("Msg Kid")).map((m) => m.title).sort();
    expect(titles).toEqual(expect.arrayContaining(["Certificate ready", "Visit booked"]));
    expect(box.items.find((m) => m.title === "Certificate ready" && m.body.includes("Msg Kid"))!.body).toContain(c.no);
    expect(box.items.find((m) => m.title === "Visit booked" && m.body.includes("Msg Kid"))!.body).toContain("Clinical Clinic");
    expect(box.unread).toBeGreaterThanOrEqual(2);
    // nothing leaks to another guardian, and a second run adds nothing
    expect((await inbox(w.g2)).items.some((m) => m.body.includes("Msg Kid"))).toBe(false);
    const total = (await inbox(w.g1)).items.length;
    await work();
    expect((await inbox(w.g1)).items.length).toBe(total);
    // reading is per person
    const m = box.items[0]!;
    await as(w.g2, (q) => q("select public.mark_messages_read($1)", [[m.id]]));
    expect((await inbox(w.g1)).items.find((x) => x.id === m.id)!.read).toBe(false);
    await as(w.g1, (q) => q("select public.mark_messages_read($1)", [[m.id]]));
    expect((await inbox(w.g1)).items.find((x) => x.id === m.id)!.read).toBe(true);
    await as(w.g1, (q) => q("select public.mark_messages_read(null)"));
    expect((await inbox(w.g1)).unread).toBe(0);
    await expectCode(as(null, (q) => q("select public.my_messages(10)")), "42501");
    // cancellation before delivery withdraws the confirmation (BP22)
    const kid2 = await guardianChild(w.g1, "Withdrawn Kid");
    const appt2 = (await as(w.g1, (q) => q<R>("select public.book_appointment($1,$2,$3,null) as r", [op(), kid2, slot])))[0]!.r;
    await as(w.g1, (q) => q("select public.cancel_appointment($1,$2,'changed plans')", [op(), appt2.appointmentId]));
    await work();
    // The verification message (0037) is unrelated to the booking; no "Visit booked" may appear.
    const after = (await inbox(w.g1)).items.filter((x) => x.body.includes("Withdrawn Kid")).map((x) => x.title);
    expect(after.filter((t) => t !== "Access verified")).toEqual(["Visit cancelled"]);
    expect(appt.appointmentId).toBeTruthy();
  });

  it("notifies the family of a certificate under review and of a revocation, with fixed wording", async () => {
    const kid = await guardianChild(w.g1, "Review Kid");
    const d = await clinicDose(kid, "CERT-LOT-R");
    const c = await issue(kid);
    await work();
    const lotB = (await as(w.inventory, (q) => q<R>("select public.register_lot($1,$2,$3,'CERT-LOT-R2',$4) as r", [op(), w.clinic, w.products["DEMO-P-ALPHA"], T(200)])))[0]!.r.lotId as string;
    await as(w.inventory, (q) => q("select public.receive_stock($1,$2,$3,$4,5,'DR-R')", [op(), w.clinic, main, lotB]));
    const k = (await as(w.clinician, (q) => q<R>("select public.request_correction($1,$2,$3,'correct_details',$4,'fix') as r", [op(), w.clinic, d.eventId, JSON.stringify({ lotId: lotB, locationId: main })])))[0]!.r;
    await as(w.lead, (q) => q("select public.approve_correction($1,$2,$3,'ok')", [op(), w.clinic, k.caseId]));
    await work(); // the family hears about the review before any later revocation
    await as(w.lead, (q) => q("select public.revoke_certificate($1,$2,$3,'lot corrected')", [op(), w.clinic, c.id]));
    await work();
    const mine = (await inbox(w.g1)).items.filter((m) => m.body.includes("Review Kid")).map((m) => m.title);
    expect(mine).toEqual(expect.arrayContaining(["Certificate under review", "Certificate no longer valid", "Vaccination recorded"]));
  });

  it("retries a failing job with backoff, then completes it; permanent failures stop and unknown types are not silently dropped", async () => {
    const kid = await guardianChild(w.g1, "Retry Kid");
    await outsideDose(kid, "DEMO-P-GAMMA", T(-20));
    const before = await work(); // drain
    expect(before.failed).toBe(0);
    await admin(`create function public.fail_message_insert() returns trigger language plpgsql as $$ begin raise exception 'boom'; end $$`);
    await admin("create trigger fail_message_insert before insert on public.messages for each row execute function public.fail_message_insert()");
    const c = await issue(kid);
    const job = () => admin<{ status: string; attempt_count: number; last_error_code: string | null; wait: number }>(
      "select status, attempt_count, last_error_code, extract(epoch from (available_at - now()))::int wait from private.outbox_jobs where dedupe_key = $1", ["cert-issued:" + c.id]);
    const r1 = await work();
    expect(r1.retry).toBeGreaterThanOrEqual(1);
    expect((await job())[0]).toMatchObject({ status: "queued", attempt_count: 1, last_error_code: "P0001" });
    expect((await job())[0]!.wait).toBeGreaterThan(30); // not retried immediately
    expect(await work()).toMatchObject({ done: 0, retry: 0 });
    await admin("drop trigger fail_message_insert on public.messages");
    await admin("update private.outbox_jobs set available_at = now() where dedupe_key = $1", ["cert-issued:" + c.id]);
    await work();
    expect((await job())[0]).toMatchObject({ status: "done", attempt_count: 2, last_error_code: null });
    expect((await inbox(w.g1)).items.some((m) => m.title === "Certificate ready" && m.body.includes("Retry Kid"))).toBe(true);
    // permanent failure: unknown handler
    await admin("insert into private.outbox_jobs (organization_id, job_type, aggregate_type, aggregate_id, dedupe_key) values ($1,'sms.send','x',gen_random_uuid(),'t-unknown')", [w.org]);
    expect((await work()).failed).toBe(1);
    expect((await admin<{ status: string; last_error_code: string }>("select status, last_error_code from private.outbox_jobs where dedupe_key = 't-unknown'"))[0]).toEqual({ status: "failed", last_error_code: "CV422" });
    // a stuck 'processing' job whose lock expired is picked up again
    await admin("insert into private.outbox_jobs (organization_id, job_type, aggregate_type, aggregate_id, dedupe_key, status, locked_until) values ($1,'certificate.issued','certificate',gen_random_uuid(),'t-stuck','processing', now() - interval '1 minute')", [w.org]);
    expect((await work()).cancelled).toBeGreaterThanOrEqual(1);
    expect((await admin<{ status: string }>("select status from private.outbox_jobs where dedupe_key = 't-stuck'"))[0]!.status).toBe("cancelled");
    // API roles cannot run the worker
    await expectCode(as(w.lead, (q) => q("select private.process_outbox(5)")), "42501");
  });
});
