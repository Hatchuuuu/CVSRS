import type { Metadata } from "next";
import { Stethoscope } from "lucide-react";
import { AuthPage } from "@/components/auth-page";
import { Notice } from "@/components/ui";
import { SignUpUnavailable, signUpMode } from "@/app/sign-up/availability";
import { SignUpForm } from "@/app/sign-up/sign-up-form";
import { STAFF_SIGN_IN_PATH } from "@/lib/auth/staff-entry";
import { getViewer } from "@/lib/server/viewer";

/** Reached from the unlisted staff sign-in and from the address clinic administrators give new staff. Never indexed. */
export const metadata: Metadata = {
  title: "Create a staff account",
  description: "Create your eVacTrack staff account and apply to your health center.",
  robots: { index: false, follow: false, nocache: true },
};

const NEXT_STEPS = [
  { title: "Your application goes to your health center", text: "Its administrators see your name, email, the role you chose and your note." },
  { title: "An administrator accepts or declines it", text: "Accepting sends your access to a second person for approval. Nobody can approve their own access." },
  { title: "Set up two-step sign-in", text: "Sign in on the staff sign-in page, add eVacTrack to an authenticator app, and the clinic workspace opens." },
] as const;

export default async function StaffSignUp() {
  const mode = await signUpMode();
  // The public directory of active health centers. A failed read is shown as a failure, never as "no health centers".
  const clinics = mode === "unavailable"
    ? []
    : await (await getViewer()).rpc.rpc<{ id: string; name: string }[]>("list_public_clinics").then((rows) => rows ?? [], () => null);
  return (
    <AuthPage
      Icon={Stethoscope}
      width="wide"
      title="Create a staff account"
      lead="For nurses, midwives, barangay health workers and other health center staff. You apply to your health center as you create your account."
      after={
        <section aria-labelledby="staff-next-h" className="mt-6 rounded-card border border-line bg-surface/60 p-5">
          <h2 id="staff-next-h" className="text-sm font-bold text-ink">
            What happens next
          </h2>
          <ol className="mt-3 grid gap-3">
            {NEXT_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
                <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-bold text-primary-strong">
                  {i + 1}
                </span>
                <span>
                  <strong className="font-semibold text-ink">{step.title}.</strong> {step.text}
                </span>
              </li>
            ))}
          </ol>
        </section>
      }
    >
      {mode === "unavailable" ? (
        <SignUpUnavailable signInHref={STAFF_SIGN_IN_PATH} />
      ) : clinics === null ? (
        <Notice tone="danger" role="alert" title="The list of health centers could not be loaded">
          Reload this page in a moment. Your account has not been created.
        </Notice>
      ) : (
        <SignUpForm
          audience="staff"
          clinics={clinics.map((c) => ({ id: c.id, name: c.name }))}
          alternate={{ text: "Already have a staff account?", href: STAFF_SIGN_IN_PATH, link: "Sign in to the clinic workspace" }}
        />
      )}
    </AuthPage>
  );
}
