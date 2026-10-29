import { randomUUID } from "node:crypto";
import { personName } from "@/lib/person-name";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { z } from "zod";
import { getConfig } from "@/lib/env";
import { getRpcClient } from "@/lib/db";
import { isSameOrigin } from "@/lib/security/origin";
import { serverSessionCookiePolicy, sessionCookieMethods } from "@/lib/auth/cookies";
import { PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password-policy";
import { entryDestination, STAFF_HOME } from "@/lib/auth/redirect";
import { authException, authFailure, authRateLimit, authRedirect, authServiceFailure, isJsonAuthRequest, readAuthFields } from "@/lib/auth/request";
import { staffApplicationFields } from "@/lib/validation/staff";
import { LEGAL_VERSION } from "@/lib/legal";
import { MOBILE_NUMBER_HINT, toE164 } from "@/lib/sms/provider";

const done = (req: Request, body: Record<string, unknown>, redirect: string) =>
  isJsonAuthRequest(req) ? NextResponse.json({ ok: true, ...body, redirect }, { headers: { "cache-control": "no-store" } }) : authRedirect(redirect);

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return authFailure(req, "sign-up", "Forbidden cross-origin request", 403, "forbidden");
  try {
    const cfg = getConfig();
    const fields = await readAuthFields(req);
    const limited = await authRateLimit(req, "sign-up", fields.email ?? "");
    if (limited) return limited;

    const email = fields.email?.trim() ?? "";
    const password = fields.password ?? "";
    const fullName = personName(fields.fullName ?? "");
    const phone = fields.phone?.trim() ?? "";

    if (!z.email().safeParse(email).success || phone.length > 40) {
      return authFailure(req, "sign-up", `Please provide a valid email and a password of at least ${PASSWORD_MIN_LENGTH} characters.`, 400, "invalid_input");
    }
    // The form asks for a mobile number (the clinic calls or texts it), so a number SMS could never reach is refused while it can be fixed.
    if (phone && !toE164(phone)) return authFailure(req, "sign-up", MOBILE_NUMBER_HINT, 400, "invalid_input");
    // The name is what clinic staff see when they verify a guardian or grant staff access, so the server requires it too.
    if (!fullName || fullName.length > 120) return authFailure(req, "sign-up", "Enter your full name (up to 120 characters).", 400, "invalid_input");
    // Agreement is checked here as well as on the form, and only for the current version: a form left open across an update must reload.
    if (fields.termsVersion !== LEGAL_VERSION) {
      return authFailure(req, "sign-up", "Agree to the current Terms of Use and Privacy Policy to create an account. If you already ticked the box, reload the page and try again.", 400, "invalid_input");
    }

    // A staff account is an ordinary account plus an application to one health center. The application is only a request: an access
    // administrator accepts or rejects it, and access still needs a second person's approval (database two-person rule).
    const home = entryDestination(fields.next);
    let staffApplication: Record<string, string | null> | null = null;
    if (home === STAFF_HOME) {
      const parsed = staffApplicationFields.safeParse({
        clinicId: fields.clinicId ?? "",
        role: fields.role ?? "",
        positionTitle: fields.positionTitle?.trim() || undefined,
        note: fields.note?.trim() || undefined,
      });
      if (!parsed.success) return authFailure(req, "sign-up", parsed.error.issues[0]?.message ?? "Check your application details.", 400, "invalid_input");
      staffApplication = { clinic_id: parsed.data.clinicId, role: parsed.data.role, position_title: parsed.data.positionTitle ?? null, note: parsed.data.note ?? null };
    }

    const weak = passwordProblem(password);
    if (weak) return authFailure(req, "sign-up", weak, 400, "weak_password");

    if (staffApplication) {
      const clinics = (await (await getRpcClient(randomUUID())).rpc<{ id: string }[]>("list_public_clinics")) ?? [];
      if (!clinics.some((c) => c.id === staffApplication.clinic_id)) {
        return authFailure(req, "sign-up", "Choose your health center from the list.", 400, "invalid_input");
      }
    }

    const jar = await cookies();
    const supabase = createServerClient(cfg.supabaseUrl, cfg.supabaseKey,{ cookies: sessionCookieMethods(jar, serverSessionCookiePolicy(process.env)) });
    const signUp = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: fullName,
          phone,
          preferred_language: fields.preferredLanguage === "fil" ? "fil" : "en",
          terms_version: LEGAL_VERSION,
          ...(staffApplication ? { staff_application: staffApplication } : {}),
        },
      },
    });

    if (signUp.error) {
      return authServiceFailure(req, "sign-up", signUp.error)
        ?? authFailure(req, "sign-up", "Unable to create the account. Please check your details and try again.", 400, "signup_failed");
    }
    if (signUp.data.session) return done(req, {}, home);
    return authFailure(req, "sign-up", "Immediate account access is unavailable. Ask the administrator to disable email confirmation in the sign-in service, then sign in.", 503, "unavailable");
  } catch (error) {
    return authException(req, "sign-up", error);
  }
}
