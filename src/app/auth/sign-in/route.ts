import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { getConfig } from "@/lib/env";
import { isSameOrigin } from "@/lib/security/origin";
import { serverSessionCookiePolicy, sessionCookieMethods } from "@/lib/auth/cookies";
import { entryDestination } from "@/lib/auth/redirect";
import { authAttemptSucceeded, authException, authFailure, authRateLimit, authRedirect, authServiceFailure, isJsonAuthRequest, readAuthFields } from "@/lib/auth/request";

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return authFailure(req, "sign-in", "Forbidden cross-origin request", 403, "forbidden");
  try {
    const cfg = getConfig();
    const fields = await readAuthFields(req);
    const limited = await authRateLimit(req, "sign-in", fields.email ?? "");
    if (limited) return limited;
    // Staff sign in from the unlisted staff page (src/lib/auth/staff-entry.ts), which asks for the clinic workspace; the workspace then picks their clinic.
    const redirectUrl = entryDestination(fields.next);
    const email = fields.email?.trim() ?? "";
    const password = fields.password ?? "";
    if (!z.email().safeParse(email).success || !password) {
      return authFailure(req, "sign-in", "Enter your email address and password.", 400, "invalid_input");
    }
    const jar = await cookies();
    const supabase = createServerClient(cfg.supabaseUrl, cfg.supabaseKey, { cookies: sessionCookieMethods(jar, serverSessionCookiePolicy(process.env)) });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      const service = authServiceFailure(req, "sign-in", error);
      if (service) return service;
      if (error?.code === "email_not_confirmed") {
        return authFailure(req, "sign-in", "Account access is unavailable. Ask the administrator to enable immediate account access in the sign-in service.", 503, "unavailable");
      }
      return authFailure(req, "sign-in", "Invalid credentials. Please verify your email and password.", 401, "invalid_credentials");
    }
    await authAttemptSucceeded(req, "sign-in", email);
    if (isJsonAuthRequest(req)) return NextResponse.json({ ok: true, redirect: redirectUrl }, { headers: { "cache-control": "no-store" } });
    return authRedirect(redirectUrl);
  } catch (error) {
    return authException(req, "sign-in", error);
  }
}
