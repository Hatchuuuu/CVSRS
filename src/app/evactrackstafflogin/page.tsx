import type { Metadata } from "next";
import { KeyRound, Stethoscope, UserCheck } from "lucide-react";
import { AuthPage } from "@/components/auth-page";
import { signInMessages } from "@/app/sign-in/messages";
import { SignInUnavailable, signUpMode } from "@/app/sign-up/availability";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { STAFF_SIGN_UP_PATH } from "@/lib/auth/staff-entry";

/** The unlisted staff sign-in (see src/lib/auth/staff-entry.ts). Never indexed; no public page links here. */
export const metadata: Metadata = {
  title: "Clinic staff sign in",
  description: "Sign in to the eVacTrack clinic workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function StaffSignIn({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; auth?: string }> }) {
  const messages = signInMessages(await searchParams);
  const mode = await signUpMode();
  return (
    <AuthPage
      Icon={Stethoscope}
      title="Clinic staff sign in"
      lead="For nurses, midwives, barangay health workers and other staff of health centers that use eVacTrack."
      after={
        <section aria-labelledby="staff-access-h" className="mt-6 rounded-card border border-line bg-surface/60 p-5">
          <h2 id="staff-access-h" className="text-sm font-bold text-ink">
            How staff access works
          </h2>
          <ul className="mt-3 grid gap-3 text-sm leading-relaxed text-ink-soft">
            <li className="flex gap-3">
              <UserCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <strong className="font-semibold text-ink">Your clinic grants access.</strong> You apply when you create your account; an administrator accepts it and a
                second person approves it.
              </span>
            </li>
            <li className="flex gap-3">
              <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>
                <strong className="font-semibold text-ink">Two-step sign-in is required.</strong> Set it up with an authenticator app the first time you sign
                in; clinic records stay closed until you do.
              </span>
            </li>
          </ul>
        </section>
      }
    >
      {mode === "unavailable" ? <SignInUnavailable /> : null}
      {mode === "unavailable" ? null : <SignInForm audience="staff" alternate={{ text: "New staff member?", href: STAFF_SIGN_UP_PATH, link: "Create a staff account" }} {...messages} />}
    </AuthPage>
  );
}
