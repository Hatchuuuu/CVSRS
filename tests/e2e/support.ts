/** Shared end-to-end helpers. Every account and record is synthetic and exists only in the isolated end-to-end database. */
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test as base, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import pg from "pg";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set: run the browser tests with npm run test:e2e`);
  return v;
}
export const env = {
  get baseUrl() { return required("E2E_BASE_URL"); },
  get dbUrl() { return required("E2E_DB_URL"); },
  get inboxUrl() { return required("E2E_INBOX_URL"); },
  get apiUrl() { return required("E2E_API_URL"); },
  get publishableKey() { return required("E2E_PUBLISHABLE_KEY"); },
};

/** Strong, unique, synthetic credentials. */
export const PASSWORD = "Correct horse battery 2026";
export const NEW_PASSWORD = "Another long passphrase 2026";
export const account = (role: string) => `${role}@e2e.example.test`;

// ---- persisted journey state (accounts made by earlier journeys) ----
const STATE = join(process.cwd(), ".local", "e2e", "state.json");
export type JourneyState = { clinicId?: string; totp?: Record<string, string> };
export function readState(): JourneyState {
  return existsSync(STATE) ? (JSON.parse(readFileSync(STATE, "utf8")) as JourneyState) : {};
}
export function writeState(patch: JourneyState) {
  mkdirSync(join(process.cwd(), ".local", "e2e"), { recursive: true });
  const cur = readState();
  writeFileSync(STATE, JSON.stringify({ ...cur, ...patch, totp: { ...cur.totp, ...patch.totp } }, null, 2));
}
export function resetState() {
  mkdirSync(join(process.cwd(), ".local", "e2e"), { recursive: true });
  writeFileSync(STATE, "{}");
}

// ---- test inbox (Mailpit, bundled with the local stack) ----
interface MailSummary { ID: string; Subject: string; Created: string; To: { Address: string }[] }

/** Waits for a new email to `to` whose subject matches, and returns the Auth link in it. */
export async function linkFromInbox(to: string, subject: RegExp, after: Date): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${env.inboxUrl}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const list = ((await res.json()) as { messages?: MailSummary[] }).messages ?? [];
    const mail = list.find((m) => subject.test(m.Subject) && new Date(m.Created) >= new Date(after.getTime() - 2000));
    if (mail) {
      const full = (await (await fetch(`${env.inboxUrl}/api/v1/message/${mail.ID}`)).json()) as { HTML?: string; Text?: string };
      const body = `${full.Text ?? ""}\n${full.HTML ?? ""}`;
      const link = /https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/.exec(body)?.[0];
      if (!link) throw new Error(`no Auth link in "${mail.Subject}"`);
      return link.replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email matching ${subject} reached ${to}`);
}

// ---- TOTP (RFC 6238: SHA-1, 30 s, 6 digits), as an authenticator app computes it ----
function base32(secret: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) {
    const i = alphabet.indexOf(ch);
    if (i < 0) throw new Error("invalid base32 secret");
    bits += i.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
export function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac("sha1", base32(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
const usedSteps = new Map<string, number>();
/** A code from a time step this secret has not used yet (Auth refuses a code twice), waiting for the next step if needed. */
export async function freshTotp(secret: string): Promise<string> {
  let step = Math.floor(Date.now() / 30_000);
  if (usedSteps.get(secret) === step) {
    await new Promise((r) => setTimeout(r, 30_000 - (Date.now() % 30_000) + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  usedSteps.set(secret, step);
  return totp(secret);
}

// ---- operator steps that happen outside the app (database owner), exactly as documented ----
export async function asDatabaseOwner<T>(fn: (db: pg.Client) => Promise<T>): Promise<T> {
  const db = new pg.Client({ connectionString: env.dbUrl });
  await db.connect();
  try { return await fn(db); } finally { await db.end(); }
}

// ---- browser steps shared by journeys ----
export async function signUpFamily(page: Page, name: string, email: string) {
  const since = new Date();
  await page.goto("/sign-up");
  await page.getByLabel("Full name of parent or legal guardian").fill(name);
  await page.getByLabel("Philippine mobile number").fill("0917 123 4567");
  await page.getByLabel("Email address (used to sign in)").fill(email);
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByLabel("Type the password again").fill(PASSWORD);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Create family account/ }).click();
  await expect(page).toHaveURL(/\/children$/);
  await assertAutoConfirmed(email, since);
  await page.reload();
  await expect(page).toHaveURL(/\/children$/);
}

/** Signup is immediately confirmed and must not send a confirmation email. Reset emails remain enabled. */
export async function assertAutoConfirmed(email: string, since: Date) {
  const users = await asDatabaseOwner(async (db) => (await db.query(
    "select email_confirmed_at from auth.users where lower(email) = lower($1)", [email],
  )).rows as { email_confirmed_at: Date | null }[]);
  expect(users).toHaveLength(1);
  expect(users[0]!.email_confirmed_at).not.toBeNull();
  const response = await fetch(`${env.inboxUrl}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  expect(response.ok).toBe(true);
  const inbox = await response.json() as { messages?: MailSummary[] };
  expect((inbox.messages ?? []).filter((mail) => /confirm|verify/i.test(mail.Subject) && new Date(mail.Created) >= new Date(since.getTime() - 2000))).toHaveLength(0);
}

export async function signIn(page: Page, email: string, password = PASSWORD, staff = false) {
  await page.goto(staff ? "/evactrackstafflogin" : "/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^Sign in/ }).click();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: /^sign out$/i }).first().click();
  await page.getByRole("dialog", { name: "Sign out of eVacTrack?" }).getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/$|\/auth\/signed-out/);
}

/** First sign-in step for staff: enrol TOTP from the key shown on the page; returns the secret for later sign-ins. */
export async function enrolTotp(page: Page): Promise<string> {
  await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
  const secret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  return secret;
}

/** Second step at sign-in. Waits until the app has stored the upgraded (aal2) session and returned to the clinic page. */
export async function verifyTotp(page: Page, secret: string) {
  await page.waitForURL((url) => url.pathname.startsWith("/account/security"));
  await expect(page.getByLabel("6-digit code")).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("6-digit code").fill(await freshTotp(secret));
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/account/security"));
}

/** The page's own alert, not Next's (empty) route announcer, which also has role="alert". */
export const formAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

// ---- first-visit journey (04) helpers: added, nothing above changed ----

/** Ids the first-visit journey passes between its steps (same state file as JourneyState). */
export type VisitState = JourneyState & { childId?: string; childName?: string; lotId?: string; certificateId?: string; certificateNo?: string; verifyToken?: string };
export const readVisitState = () => readState() as VisitState;
export function writeVisitState(patch: Omit<VisitState, "clinicId" | "totp">) {
  writeState(patch as JourneyState);
}

/** Clinic-local calendar date (the e2e clinic runs in Asia/Manila) shifted by n days. Never the UTC date. */
export function clinicDate(offsetDays = 0, timeZone = "Asia/Manila"): string {
  const local = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
  const d = new Date(`${local}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** A staff member in their own browser context, signed in with password plus the second step (aal2). */
export async function signInStaff(browser: Browser, who: string): Promise<{ context: BrowserContext; page: Page }> {
  const secret = readState().totp?.[who];
  if (!secret) throw new Error(`no TOTP secret saved for ${who}: run the earlier journeys first`);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account(who), undefined, true);
  await verifyTotp(page, secret);
  return { context, page };
}

/** The app's own API through a signed-in browser context (its cookies), the way the app's forms call it. */
export async function apiPost(page: Page, path: string, data: unknown = {}) {
  const res = await page.request.post(path, {
    headers: { "idempotency-key": crypto.randomUUID(), origin: env.baseUrl, "content-type": "application/json" },
    data,
  });
  const text = await res.text();
  let body: { data?: Record<string, unknown>; error?: { message?: string } } = {};
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status(), body, text };
}

/**
 * Text drawn on a PDF made by pdf-lib with an embedded (Identity-H) font: inflates every stream, reads the ToUnicode map and decodes
 * each `<hex> Tj` run in drawing order. Enough to read back what the app printed (no PDF text library is installed).
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const toUnicode = new Map<string, string>();
  const runs: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let content: string;
    try { content = Buffer.from(decodePDFRawStream(obj).decode()).toString("latin1"); } catch { continue; }
    if (content.includes("beginbfchar")) {
      for (const m of content.matchAll(/<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>/g)) {
        const units = m[2]!.match(/.{4}/g) ?? [];
        toUnicode.set(m[1]!.toLowerCase(), String.fromCharCode(...units.map((u) => parseInt(u, 16))));
      }
    } else if (/\bTj\b/.test(content)) {
      for (const m of content.matchAll(/<([0-9A-Fa-f]*)>\s*Tj/g)) runs.push(m[1]!.toLowerCase());
    }
  }
  return runs.map((hex) => (hex.match(/.{4}/g) ?? []).map((g) => toUnicode.get(g) ?? "?").join("")).join("\n");
}

// ---- staff-screen journeys (06+) helpers: added, nothing above changed ----

/** One in-app message as GET /api/v1/me/messages returns it. */
export interface InboxItem { id: string; kind: string; title: string; body: string; childId: string | null; createdAt: string; read: boolean }

/**
 * Waits (bounded) until the signed-in person's inbox holds a message that matches. Messages are written by the outbox worker that the
 * end-to-end server runs in-process every 10 seconds, so a matching message normally appears within one or two ticks.
 */
export async function waitForMessage(page: Page, match: (m: InboxItem) => boolean, what: string, timeoutMs = 60_000): Promise<InboxItem> {
  const deadline = Date.now() + timeoutMs;
  let last: InboxItem[] = [];
  while (Date.now() < deadline) {
    const res = await page.request.get("/api/v1/me/messages?limit=100");
    if (res.ok()) {
      last = (((await res.json()) as { data?: { items?: InboxItem[] } }).data?.items ?? []);
      const hit = last.find(match);
      if (hit) return hit;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`no message "${what}" within ${timeoutMs / 1000} s; inbox titles: ${last.map((m) => m.title).join(" | ") || "(empty)"}`);
}

/** A calendar date as the staff screens print it (src/lib/format.ts formatDate): "8 Oct 2026". */
export function shownDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m! - 1]} ${y}`;
}

/** A calendar date as the outbox worker words it in messages (PostgreSQL 'FMDay, FMDD FMMonth YYYY'): "Thursday, 8 October 2026". */
export function messageDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  const month = d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  return `${weekday}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** A calendar date as the family visit list words it (src/app/children/[childId]/visits.tsx fmtDay): "Thu, 8 Oct 2026". */
export async function familyDate(_page: Page, iso: string): Promise<string> {
  return `${new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}, ${shownDate(iso)}`;
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** GET through a signed-in browser context; returns status and the parsed `data`. */
export async function apiGet<T = unknown>(page: Page, path: string): Promise<{ status: number; data: T | undefined; text: string }> {
  const res = await page.request.get(path);
  const text = await res.text();
  let data: T | undefined;
  try { data = (JSON.parse(text) as { data?: T }).data; } catch { /* not JSON */ }
  return { status: res.status(), data, text };
}

/** A new staff member signs up immediately and applies for `role`; clinic access still requires staff approval. */
export async function applyAsStaff(page: Page, name: string, who: string, role: string) {
  const since = new Date();
  await page.goto("/evactrackstafflogin/create-account");
  await page.getByLabel("Full name (as your clinic knows you)").fill(name);
  await page.getByLabel("Work email address (used to sign in)").fill(account(who));
  await page.getByLabel("Create a password").fill(PASSWORD);
  await page.getByLabel("Type the password again").fill(PASSWORD);
  await page.getByLabel("Health center", { exact: true }).selectOption({ label: "E2E Health Center" });
  await page.getByLabel("Role you are applying for").selectOption(role);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Create staff account and apply/ }).click();
  await expect(page).toHaveURL(/\/clinic$/);
  await assertAutoConfirmed(account(who), since);
  await page.reload();
  await expect(page).toHaveURL(/\/clinic$/);
  await expect(page.getByText(/Waiting for an administrator/i)).toBeVisible();
}

/** The family's own browser, signed in. */
export async function signInFamily(browser: Browser, who = "parent", password = NEW_PASSWORD): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account(who), password);
  await expect(page).toHaveURL(/\/children/);
  return { context, page };
}

/**
 * `test` for journeys 06+. Every new browser context gets a stub React DevTools hook, so React's development-only "Download the React
 * DevTools" console line is not printed on each page load. The runner drains the dev server's output while Playwright runs.
 * No application code or behaviour changes.
 */
const DEVTOOLS_STUB = "window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { isDisabled: true, supportsFiber: true, renderers: new Map(), inject() { return 1; }, onCommitFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, checkDCE() {} };";
export const journeyTest = base.extend<object, { quietBrowser: Browser }>({
  quietBrowser: [async ({ browser }, use) => {
    const b = browser as Browser & { __quiet?: boolean };
    if (!b.__quiet) {
      const open = browser.newContext.bind(browser);
      b.newContext = async (options) => {
        const ctx = await open(options);
        await ctx.addInitScript({ content: DEVTOOLS_STUB });
        return ctx;
      };
      b.__quiet = true;
    }
    await use(browser);
  }, { scope: "worker", auto: true }],
});
