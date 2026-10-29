import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { getConfig } from "@/lib/env";
import { isSameOrigin } from "@/lib/security/origin";
import { serverSessionCookiePolicy, sessionCookieMethods } from "@/lib/auth/cookies";
import { entryDestination, STAFF_HOME } from "@/lib/auth/redirect";
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
    // Keep new session cookies private until the account is admitted through the correct portal.
    const stored = new Map(jar.getAll().map(cookie => [cookie.name, cookie.value]));
    const staged = new Map<string, { value: string; options?: CookieOptions }>();
    const supabase = createServerClient(cfg.supabaseUrl, cfg.supabaseKey, { cookies: sessionCookieMethods({
      getAll: () => [...stored].map(([name, value]) => ({ name, value })),
      set: (name, value, options) => { stored.set(name, value); staged.set(name, { value, options }); },
    }, serverSessionCookiePolicy(process.env)) });
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      const service = authServiceFailure(req, "sign-in", error);
      if (service) return service;
      if (error?.code === "email_not_confirmed") {
        return authFailure(req, "sign-in", "Account access is unavailable. Ask the administrator to enable immediate account access in the sign-in service.", 503, "unavailable");
      }
      return authFailure(req, "sign-in", "Invalid credentials. Please verify your email and password.", 401, "invalid_credentials");
    }
    const { data: kind, error: kindError } = await supabase.rpc("get_sign_in_account_kind");
    if (kindError || (kind !== "staff" && kind !== "family")) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return authFailure(req, "sign-in", "Account access could not be checked. Please try again.", 503, "unavailable");
    }
    if ((kind === "staff") !== (redirectUrl === STAFF_HOME)) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return authFailure(req, "sign-in", kind === "staff"
        ? "This is a staff account. Please use the clinic staff sign-in page."
        : "This is a family account. Please use the family sign-in page.", 403, kind === "staff" ? "staff_portal_required" : "family_portal_required");
    }
    for (const [name, cookie] of staged) jar.set(name, cookie.value, cookie.options);
    await authAttemptSucceeded(req, "sign-in", email);
    if (isJsonAuthRequest(req)) return NextResponse.json({ ok: true, redirect: redirectUrl }, { headers: { "cache-control": "no-store" } });
    return authRedirect(redirectUrl);
  } catch (error) {
    return authException(req, "sign-in", error);
  }
}
