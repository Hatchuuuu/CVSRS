import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { isSupabaseAuthCookie, serverSessionCookiePolicy, sessionCookieMethods, sessionCookieOptions, SIGN_OUT_TIMEOUT_MS, type SessionCookiePolicy } from "@/lib/auth/cookies";
import { getConfig } from "@/lib/env";
import { isSameOrigin } from "@/lib/security/origin";

type Jar = Awaited<ReturnType<typeof cookies>>;

/** Asks Auth to end every session of this user (global scope), bounded by SIGN_OUT_TIMEOUT_MS. True only when Auth confirmed it. */
async function revokeRemoteSessions(url: string, key: string, jar: Jar, policy: SessionCookiePolicy): Promise<boolean> {
  const controller = new AbortController();
  let open = true;
  const supabase = createServerClient(url, key, {
    global: {
      fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal }),
    },
    // After this request has answered, late SDK retries must not touch the cookie jar.
    cookies: sessionCookieMethods(jar, policy, { ignoreWriteErrors: true, isOpen: () => open }),
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), SIGN_OUT_TIMEOUT_MS); });
  const attempt = supabase.auth.signOut().then(({ error }) => {
    if (error) console.warn(`[sign-out] remote revocation failed: ${error.name}`);
    return !error;
  }, () => false);
  try {
    return await Promise.race([attempt, timedOut]);
  } finally {
    clearTimeout(timer);
    open = false;
    controller.abort();
  }
}

// Explicit logout. POST-only (never state-changing GET) and same-origin only.
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return new NextResponse(null, { status: 403 });
  const jar = await cookies();
  let cfg: ReturnType<typeof getConfig> | null = null;
  try {
    cfg = getConfig();
  } catch (error) {
    console.error(`[sign-out] configuration error: ${(error as Error).name}`);
  }

  let policy: SessionCookiePolicy;
  try {
    policy = serverSessionCookiePolicy(process.env);
  } catch {
    policy = { secure: process.env.NODE_ENV === "production", maxAgeSeconds: null };
  }
  const present = jar.getAll().map((c) => c.name).filter(isSupabaseAuthCookie);
  const revoked = cfg ? await revokeRemoteSessions(cfg.supabaseUrl, cfg.supabaseKey, jar, policy) : false;

  // This device is always signed out, whatever Auth answered: expire every auth cookie (session chunks and PKCE verifiers).
  const expired = sessionCookieOptions({ maxAge: 0 }, policy);
  for (const name of new Set([...present, ...jar.getAll().map((c) => c.name).filter(isSupabaseAuthCookie)])) jar.set(name, "", expired);

  // Revocation unconfirmed: other sessions (another device, or a copied refresh token) may still be valid. Say so.
  return signedOut(revoked ? "/" : "/auth/signed-out");
}

// A relative redirect preserves the browser origin when Next reconstructs loopback URLs.
function signedOut(location: string) {
  return new NextResponse(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}
