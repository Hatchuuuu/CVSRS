import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { admin, as, newUser, op, pool, type Actor } from "./helpers";
import { activateDemoSchedule, clinicalWorld, setDemoMode, type ClinicalWorld } from "./clinical-setup";

/**
 * Authorization and robustness sweep over EVERY command the API roles can execute.
 *  1. Robustness: no function may fail with an internal error (missing table/column, type errors, unassigned records...) for a user with no
 *     roles, whatever the arguments. Only deliberate business errors (CV4xx), privilege errors, and data-shape errors are acceptable.
 *  2. Authorization: a signed-in user with NO staff role and NO family link, given a REAL clinic id, must never receive data from any
 *     clinic-scoped command: it must fail (CV401/403/404/409/422, 42501) or return nothing. The few commands that legitimately answer
 *     any signed-in person are listed below with the reason, so a new function that leaks cannot slip in unnoticed.
 */

interface Fn {
  name: string;
  args: { name: string; type: string; hasDefault: boolean }[];
}

let w: ClinicalWorld;
let nobody: Actor;
let fns: Fn[] = [];

/** Commands that are meant to answer any signed-in user (they only expose what that user is entitled to, or public clinic information). */
const OPEN_TO_SIGNED_IN = new Map<string, string>([
  ["get_my_context", "own profile and memberships"],
  ["list_public_clinics", "public clinic directory"],
  ["my_children", "own children only"],
  ["my_appointments", "own family's appointments only"],
  ["my_messages", "own messages only"],
  ["get_contact_preferences", "own preferences only"],
  ["get_privacy_notice", "the clinic's published notice text is public to signed-in families"],
  ["get_pending_privacy_notices", "unacknowledged clinic privacy notices for signed-in families"],
  ["mark_messages_read", "own messages only"],
  ["verify_certificate", "public minimal authenticity check"],
  ["guardian_list_sessions", "open sessions are shown to any signed-in family so they can book (no personal data)"],
  ["public_queue_display", "anonymous waiting-room display: ticket labels only"],
  ["submit_staff_application", "any signed-in person may apply for their own staff access; it files a request, never grants access"],
  ["my_staff_applications", "own staff applications only"],
]);
const FAIL_OK = /^(CV40[0-9]|CV422|42501|22[0-9A-Z]{3}|23[0-9A-Z]{3})$/;

function valueFor(type: string, name: string): unknown {
  if (name === "p_operation_key") return op();
  if (type === "uuid") return randomUUID();
  if (type === "uuid[]") return [];
  if (type === "text[]") return [];
  if (type === "text") return "sweep";
  if (type === "boolean") return false;
  if (type === "integer" || type === "bigint" || type === "smallint" || type === "numeric") return 1;
  if (type === "date") return new Date().toISOString().slice(0, 10);
  if (type.startsWith("timestamp")) return new Date().toISOString();
  if (type === "jsonb" || type === "json") return {};
  throw new Error(`sweep does not know how to build a ${type} argument for ${name}: add it`);
}

beforeAll(async () => {
  w = await clinicalWorld();
  await activateDemoSchedule(w, "sweep-v1");
  nobody = await newUser("nobody");
  // A real child with a guardian and some history so that "no data" means something.
  await as(w.g1, (q) => q("select public.create_child_provisional($1,$2,$3)", [op(), w.clinic, JSON.stringify({ displayName: "Sweep Kid", dob: "2026-08-01" })]));
  const rows = await admin<{ name: string; argnames: string[] | null; types: string[]; nargs: number; ndef: number }>(
    `select p.proname name, p.proargnames argnames,
            array(select format_type(t, null) from unnest(string_to_array(p.proargtypes::text, ' ')::oid[]) t) types, p.pronargs nargs, p.pronargdefaults ndef
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute') order by 1`,
  );
  fns = rows.map((r) => ({
    name: r.name,
    args: r.types.map((t, i) => ({ name: r.argnames?.[i] ?? `a${i}`, type: t, hasDefault: i >= r.nargs - r.ndef })),
  }));
});
afterAll(async () => {
  await setDemoMode(false);
  await pool.end();
});

const call = (actor: Actor | null, f: Fn, override: Record<string, unknown> = {}) => {
  const params = f.args.map((a) => (a.name in override ? override[a.name] : valueFor(a.type, a.name)));
  const sql = `select public.${f.name}(${f.args.map((a, i) => `${a.name} => $${i + 1}::${a.type}`).join(", ")}) as r`;
  return as(actor, (q) => q<{ r: unknown }>(sql, params.map((v) => (Array.isArray(v) && v.some((x) => typeof x === "object") ? JSON.stringify(v) : v))));
};
const empty = (v: unknown): boolean => v === null || v === undefined || (Array.isArray(v) && v.length === 0) || (typeof v === "object" && v !== null && Object.keys(v).length === 0);

describe("sweep of every executable command", () => {
  it("finds a meaningful number of commands", () => {
    expect(fns.length).toBeGreaterThan(120);
  });

  it("does not include the superseded commands revoked in 0040 (I4-04)", () => {
    // acknowledge_privacy_notice was listed above as open to any signed-in user; acknowledge_clinic_privacy_notice replaced it.
    expect(fns.map((f) => f.name)).not.toContain("acknowledge_privacy_notice");
    expect(fns.map((f) => f.name)).not.toContain("record_report_export");
  });

  it("never fails with an internal error for a signed-in user with no roles", async () => {
    const bad: string[] = [];
    for (const f of fns) {
      try {
        await call(nobody, f);
      } catch (e) {
        const code = (e as { code?: string }).code ?? "?";
        if (!FAIL_OK.test(code)) bad.push(`${f.name}: ${code} ${(e as Error).message.slice(0, 120)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("never fails with an internal error for a real clinic id either (the paths that get past the first check)", async () => {
    const bad: string[] = [];
    for (const f of fns) {
      const override: Record<string, unknown> = {};
      for (const a of f.args) if (a.name === "p_clinic_id" || a.name === "p_from_clinic_id") override[a.name] = w.clinic;
      if (Object.keys(override).length === 0) continue;
      for (const actor of [nobody, w.assistant, w.clinician, w.lead, w.inventory, w.g1]) {
        try {
          await call(actor, f, override);
        } catch (e) {
          const code = (e as { code?: string }).code ?? "?";
          if (!FAIL_OK.test(code)) bad.push(`${f.name} as ${actor === nobody ? "nobody" : actor.id.slice(0, 4)}: ${code} ${(e as Error).message.slice(0, 120)}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives nothing to a user with no role and no family link, whatever clinic they ask about", async () => {
    const leaks: string[] = [];
    for (const f of fns) {
      if (OPEN_TO_SIGNED_IN.has(f.name)) continue;
      const override: Record<string, unknown> = {};
      for (const a of f.args) if (a.name === "p_clinic_id" || a.name === "p_from_clinic_id") override[a.name] = w.clinic;
      try {
        const res = (await call(nobody, f, override))[0]?.r;
        if (!empty(res)) leaks.push(`${f.name}: ${JSON.stringify(res).slice(0, 100)}`);
      } catch (e) {
        const code = (e as { code?: string }).code ?? "?";
        if (!FAIL_OK.test(code)) leaks.push(`${f.name}: unexpected ${code}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("anonymous callers can execute only the deliberately public commands", async () => {
    const open: string[] = [];
    for (const f of fns) {
      try {
        await call(null, f);
        open.push(f.name);
      } catch (e) {
        if ((e as { code?: string }).code !== "42501") open.push(`${f.name} (${(e as { code?: string }).code})`);
      }
    }
    expect(open.sort()).toEqual(["list_public_clinics", "public_queue_display", "verify_certificate"]);
  });
});
