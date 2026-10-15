import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { serverSessionCookiePolicy, sessionCookieMethods } from "@/lib/auth/cookies";
import { authCallbackResult } from "@/lib/auth/redirect";
import { canonicalPublicUrl, ConfigError, getConfig } from "@/lib/env";

/**
 * Exchange the one-use PKCE code on the server and store the session in the shared session cookies (src/lib/auth/cookies.ts:
 * Secure in production, SameSite=Lax, bounded Max-Age). They are not HttpOnly, because the browser SDK reads the session for MFA
 * and password reset.
 */
export async function GET(request: Request) {
  let cfg;
  let origin: string;
  try {
    cfg = getConfig();
    origin = cfg.production ? canonicalPublicUrl(process.env.CVSRS_PUBLIC_URL) : new URL(request.url).origin;
    if (new URL(request.url).origin !== origin) return new NextResponse(null, { status: 400 });
  } catch (error) {
    if (error instanceof ConfigError) return new NextResponse(null, { status: 503 });
    return new NextResponse(null, { status: 400 });
  }

  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  if (!code || params.has("error") || params.has("error_code")) {
    return NextResponse.redirect(new URL(authCallbackResult("invalid", null), origin));
  }

  try {
    const jar = await cookies();
    const supabase = createServerClient(cfg.supabaseUrl, cfg.supabaseKey, { cookies: sessionCookieMethods(jar, serverSessionCookiePolicy(process.env)) });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return NextResponse.redirect(new URL(authCallbackResult(error?.message ?? null, params.get("next")), origin));
  } catch {
    return NextResponse.redirect(new URL(authCallbackResult("exchange-failed", null), origin));
  }
}
