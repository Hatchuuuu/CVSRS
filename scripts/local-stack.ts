/** Shared helpers for the local Supabase stack (npm run dev, setup:first-staff, end-to-end tests). */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { createServer } from "node:net";

export const ROOT = resolve(import.meta.dirname, "..");
const SUPABASE_JS = join(ROOT, "node_modules", "supabase", "dist", "supabase.js");

/** An operator-facing problem; its message is printed as is (it never contains credentials). */
export class SetupError extends Error {}

/** A wildcard probe can coexist with an occupied loopback address on Windows; check both addresses explicitly. */
export async function requireFreeLoopbackPort(port: number): Promise<void> {
  for (const host of ["127.0.0.1", "::1"]) {
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", () => reject(new SetupError(`Port ${port} is already in use or unavailable; no existing server was stopped.`)));
      probe.listen({ port, host, exclusive: true }, () => probe.close(() => resolve()));
    });
  }
}

export const PRIVILEGED_KEYS = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "SERVICE_ROLE_KEY", "CVSRS_SMS_WEBHOOK_DB_URL", "CVSRS_OWNER_DB_URL"];

/** Local certificates must resolve against the running app, including when Next loads a hosted .env.local. */
export function localWebEnvironment(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const local: NodeJS.ProcessEnv = { ...env, CVSRS_PUBLIC_URL: "" };
  // Empty overrides also keep Next's dotenv loader from injecting owner/provider credentials into the web runtime.
  for (const key of PRIVILEGED_KEYS) local[key] = "";
  return local;
}

/** The CLI may print credentials after start/reset; keep those rows out of operator logs. */
export function localCliOutput(output: string): string {
  return output.split(/\r?\n/).filter((line) => !/secret|password|service.?role|anonymous.?key|publishable.?key|jwt|postgres(?:ql)?:\/\/|sb_(?:secret|publishable)_|eyJ/i.test(line)).join("\n");
}

export function supabaseCli(args: string[], inherit = false) {
  if (!existsSync(SUPABASE_JS)) throw new SetupError("The Supabase CLI is missing. Run npm install first.");
  // shortcut: CLI diagnostics are capped at 16 MiB, use streaming redaction if output exceeds that bound.
  const r = spawnSync(process.execPath, [SUPABASE_JS, ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (r.error) throw new SetupError("The Supabase CLI could not complete. Check the local service and retry.");
  if (inherit) {
    process.stdout.write(localCliOutput(r.stdout ?? ""));
    process.stderr.write(localCliOutput(r.stderr ?? ""));
  }
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function requireDocker() {
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", windowsHide: true });
  if (docker.error || docker.status !== 0) {
    throw new SetupError("Docker is not running. Install Docker Desktop (https://www.docker.com/products/docker-desktop/), start it, and try again.");
  }
}

export interface StackInfo { apiUrl: string; dbUrl: string; publishableKey: string; studioUrl?: string; inboxUrl?: string }

export async function assertImmediateSignup(stack: StackInfo) {
  const response = await fetch(`${stack.apiUrl}/auth/v1/settings`, { headers: { apikey: stack.publishableKey }, signal: AbortSignal.timeout(5000) });
  if (!response.ok || (await response.json()).mailer_autoconfirm !== true) {
    throw new SetupError("The running Auth service does not allow immediate signup. Disable email confirmation and restart this local Supabase stack (stop/start, not db reset), then try again.");
  }
}

/** Reads `supabase status -o json`. Key names differ between CLI versions; the service-role/secret keys are ignored on purpose. */
export function parseStatus(json: string): StackInfo | null {
  let s: Record<string, unknown>;
  try { s = JSON.parse(json) as Record<string, unknown>; } catch { return null; }
  const str = (k: string) => (typeof s[k] === "string" && s[k] ? (s[k] as string) : undefined);
  const apiUrl = str("API_URL"), dbUrl = str("DB_URL"), publishableKey = str("PUBLISHABLE_KEY") ?? str("ANON_KEY");
  if (!apiUrl || !dbUrl || !publishableKey) return null;
  return { apiUrl, dbUrl, publishableKey, studioUrl: str("STUDIO_URL"), inboxUrl: str("MAILPIT_URL") ?? str("INBUCKET_URL") };
}

/** The running local stack, or null when it is not running. */
export function stackStatus(): StackInfo | null {
  const r = supabaseCli(["status", "-o", "json"]);
  return r.ok ? parseStatus(r.stdout) : null;
}

/** Destructive or privileged local steps only ever target a loopback database. */
export function assertLoopback(dbUrl: string) {
  const host = new URL(dbUrl).hostname.replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(host)) throw new SetupError("Refusing: that database is not the local stack.");
}
