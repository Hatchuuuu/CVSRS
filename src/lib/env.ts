import "server-only";
import { z } from "zod";
import { parseSessionCookieMaxAge, parseStaffIdleMinutes } from "@/lib/auth/session-policy";

/**
 * Deployment configuration. Missing configuration fails closed. Every identity authenticates against Supabase Auth:
 * locally through the Supabase stack that `npm run dev` starts, otherwise through the deployment's own project.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  NEXT_PUBLIC_SUPABASE_URL: z.url().optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
});

export type DataMode = "supabase";

/** `unconfigured`: the sign-in service settings are absent (this copy is not connected); `invalid`: a setting is present but wrong. */
export class ConfigError extends Error {
  constructor(message: string, readonly kind: "unconfigured" | "invalid" = "invalid") {
    super(message);
    this.name = "ConfigError";
  }
}

/** One public HTTPS origin, with no credentials, path, query or fragment. */
export function canonicalPublicUrl(value: string | undefined): string {
  if (!value) throw new ConfigError("CVSRS_PUBLIC_URL is required in production");
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password || url.pathname !== "/" || url.search || url.hash || value !== `${url.origin}${value.endsWith("/") ? "/" : ""}`) throw new Error("invalid URL");
    return url.origin;
  } catch {
    throw new ConfigError("CVSRS_PUBLIC_URL must be one canonical HTTPS origin");
  }
}

/**
 * Where request limits find the client address. Production must name a header that the ingress/platform overwrites on every request
 * (direct origin access blocked), or explicitly accept shared buckets with CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET=1. Shared buckets let
 * one client consume a public route's allowance for everybody, so the opt-in is documented as a degraded mode, never a default.
 */
export interface ClientAddressSource {
  /** Lower-case header name, or null when no trusted source is configured. */
  header: string | null;
}

export function clientAddressSource(env: Record<string, string | undefined> = process.env): ClientAddressSource {
  const header = env.CVSRS_TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase() ?? "";
  const shared = env.CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET?.trim() ?? "";
  if (shared !== "" && shared !== "1") throw new ConfigError("CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET must be blank or 1");
  if (header) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(header)) throw new ConfigError("CVSRS_TRUSTED_CLIENT_IP_HEADER must be one HTTP header name");
    return { header };
  }
  if (env.NODE_ENV === "production" && shared !== "1") {
    throw new ConfigError("Production request limits need CVSRS_TRUSTED_CLIENT_IP_HEADER (a client-address header your ingress overwrites) or the explicit CVSRS_RATE_LIMIT_ALLOW_SHARED_BUCKET=1 opt-in");
  }
  return { header: null };
}

/** Session settings are validated with the rest of the configuration so a typo fails closed instead of silently using a default. */
function checkSessionSettings() {
  try {
    parseSessionCookieMaxAge(process.env.CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS);
    parseStaffIdleMinutes(process.env.NEXT_PUBLIC_CVSRS_STAFF_IDLE_MINUTES);
  } catch (error) {
    throw new ConfigError((error as Error).message);
  }
}

export function getConfig(): { mode: DataMode; supabaseUrl: string; supabaseKey: string; production: boolean } {
  // An empty optional setting means absent, not a malformed service.
  const env = schema.parse({
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL || undefined,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || undefined,
  });
  const production = env.NODE_ENV === "production";
  if (production) {
    canonicalPublicUrl(process.env.CVSRS_PUBLIC_URL);
    clientAddressSource(process.env);
  }
  checkSessionSettings();
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return { mode: "supabase", supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, supabaseKey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, production };
  }
  // CVSRS_LOCAL_DB_URL used to select a local sign-in shim; it signs nobody in any more, so name the replacement.
  const hint = process.env.CVSRS_LOCAL_DB_URL ? " (CVSRS_LOCAL_DB_URL is no longer a sign-in mode: start local development with npm run dev)" : "";
  throw new ConfigError(`Service is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY${hint}`, "unconfigured");
}
