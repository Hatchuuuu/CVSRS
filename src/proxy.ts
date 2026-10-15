import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { serverSessionCookiePolicy, sessionCookieOptions } from "@/lib/auth/cookies";
import { staffEntryRedirect } from "@/lib/auth/staff-entry";

/**
 * Per-request Content-Security-Policy and (with Supabase) session-cookie refresh. This is NOT an authorization boundary:
 * every page and API route re-authenticates, and the database enforces access (BP31).
 *
 * Production scripts run only with this request's nonce ('strict-dynamic'); there is no 'unsafe-inline' or 'unsafe-eval' for scripts.
 * Development keeps them because React's dev tooling needs eval. Styles keep 'unsafe-inline' (Next injects style attributes).
 */
export function buildCsp(nonce: string, production: boolean, supabaseUrl?: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    production ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'` : "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    `connect-src 'self' ${supabaseUrl ?? ""}`.trim(),
    "object-src 'none'",
    "worker-src 'self'",
  ].join("; ");
}

const HEALTH_PATHS = new Set(["/api/v1/health", "/api/v1/health/ready"]);

/** Missing or invalid production configuration fails closed with a generic answer; the reason is only in the server log. */
function unavailable() {
  return new NextResponse("Service unavailable", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function proxy(request: NextRequest) {
  // Staff type their unlisted sign-in address by hand; accept any capitals (/EVACTRACKSTAFFLOGIN) and settle on one address.
  const staffEntry = staffEntryRedirect(request.nextUrl.pathname);
  // The proxy must redirect to an absolute URL; it is built from the address the browser used, so the host and cookies stay the same.
  if (staffEntry) {
    const target = request.nextUrl.clone();
    target.pathname = staffEntry;
    return NextResponse.redirect(target, 308);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV === "production", process.env.NEXT_PUBLIC_SUPABASE_URL);
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  let response = NextResponse.next({ request: { headers } });
  // Liveness and readiness never use the session, and readiness reports configuration problems itself (503), so health checks
  // still answer when the deployment is misconfigured.
  if (HEALTH_PATHS.has(request.nextUrl.pathname)) {
    response.headers.set("Content-Security-Policy", csp);
    return response;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    try {
      new URL(url);
      // Throws for an invalid CVSRS_SESSION_COOKIE_MAX_AGE_SECONDS (a configuration error, handled below).
      const policy = serverSessionCookiePolicy(process.env);
      const supabase = createServerClient(url, key, {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll: (list) => {
            for (const c of list) request.cookies.set(c.name, c.value);
            response = NextResponse.next({ request: { headers } });
            for (const c of list) response.cookies.set(c.name, c.value, sessionCookieOptions(c.options, policy));
          },
        },
      });
      await supabase.auth.getUser();
    } catch (err) {
      console.warn("[proxy] Supabase session refresh failed:", err);
      if (process.env.NODE_ENV === "production") return unavailable();
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error("[proxy] Missing Supabase URL or publishable key in production environment");
    return unavailable();
  }
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{ source: "/((?!ocr/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};
