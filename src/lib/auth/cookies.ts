import type { CookieOptions, CookieMethodsServer } from "@supabase/ssr";
import { parseSessionCookieMaxAge } from "./session-policy";

/**
 * One cookie policy for every Supabase client (route handlers, proxy, server RPC client and browser client).
 *
 * - `Path=/`, `SameSite=Lax`, host-only (no Domain), `Secure` in production.
 * - A bounded `Max-Age` (CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS, default 12 hours) replaces @supabase/ssr's fixed 400-day default,
 *   which the SDK applies even when `cookieOptions.maxAge` is passed, so it is enforced here on every write.
 * - NOT HttpOnly: the browser SDK must read the session for MFA enrollment/verification and the password reset form. Script access is
 *   contained by the nonce-based Content-Security-Policy instead (src/proxy.ts). Changing this requires moving those flows server-side.
 */
export interface SessionCookiePolicy {
  secure: boolean;
  /** Seconds, or null for a browser-session cookie (no Max-Age). */
  maxAgeSeconds: number | null;
}

/** Remote token revocation is bounded so sign-out answers quickly during an Auth outage. */
export const SIGN_OUT_TIMEOUT_MS = 2_500;

/** Server policy. Throws RangeError for an invalid CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS (getConfig reports it as a ConfigError). */
export function serverSessionCookiePolicy(env: Record<string, string | undefined>): SessionCookiePolicy {
  return { secure: env.NODE_ENV === "production", maxAgeSeconds: parseSessionCookieMaxAge(env.CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS) };
}

/**
 * Browser policy. The server-side lifetime is not available to the browser bundle, so token refreshes written by the browser SDK
 * become browser-session cookies (cleared when the browser closes); the next server refresh restores the configured Max-Age.
 */
export function browserSessionCookiePolicy(): SessionCookiePolicy {
  return { secure: process.env.NODE_ENV === "production", maxAgeSeconds: null };
}

/** Applies the policy to options proposed by the SDK. Removals (Max-Age 0) stay removals. */
export function sessionCookieOptions(proposed: Partial<CookieOptions> | undefined, policy: SessionCookiePolicy): CookieOptions {
  const removal = proposed?.maxAge === 0 || (proposed?.expires instanceof Date && proposed.expires.getTime() <= Date.now());
  const options: CookieOptions = { path: "/", sameSite: "lax", secure: policy.secure, httpOnly: false };
  if (removal) options.maxAge = 0;
  else if (policy.maxAgeSeconds !== null) options.maxAge = policy.maxAgeSeconds;
  return options;
}

/** `sb-<project-ref>-auth-token`, its numbered chunks (`.0`, `.1`, …) and PKCE verifier entries (`-code-verifier`, …). */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-[^\s;=]+-auth-token(?:\.\d+|-[A-Za-z0-9_-]+)?$/.test(name);
}

interface WritableJar {
  getAll(): { name: string; value: string }[];
  set(name: string, value: string, options?: CookieOptions): unknown;
}

/**
 * Cookie methods for createServerClient over a Next cookie jar. `ignoreWriteErrors` is for Server Components, where writes are not
 * allowed and the proxy refreshes the session instead. `isOpen` lets a caller stop late SDK writes after it has responded.
 */
export function sessionCookieMethods(jar: WritableJar, policy: SessionCookiePolicy, opts: { ignoreWriteErrors?: boolean; isOpen?: () => boolean } = {}): CookieMethodsServer {
  return {
    getAll: () => jar.getAll(),
    setAll: (list) => {
      if (opts.isOpen && !opts.isOpen()) return;
      for (const c of list) {
        try {
          jar.set(c.name, c.value, sessionCookieOptions(c.options, policy));
        } catch (error) {
          if (!opts.ignoreWriteErrors) throw error;
        }
      }
    },
  };
}
