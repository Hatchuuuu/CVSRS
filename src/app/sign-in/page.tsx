import type { Metadata } from "next";
import { NurseMascot } from "@/components/nurse-mascot";
import { AuthPage } from "@/components/auth-page";
import { SignInUnavailable, signUpMode } from "@/app/sign-up/availability";
import { signInMessages } from "./messages";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in", description: "Access family vaccination records and clinic workflows." };

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; auth?: string; email?: string }> }) {
  const params = await searchParams;
  const messages = signInMessages(params);
  const mode = await signUpMode();
  return (
    <AuthPage
      headingVisual={<NurseMascot size={88} className="shrink-0 rounded-full [&_button:focus-visible]:outline-2 [&_button:focus-visible]:outline-offset-2 [&_button:focus-visible]:outline-primary" />}
      title="Welcome back"
      lead="Sign in to your family account to see your children's vaccination records."
      after={
        <p className="mt-5 text-sm leading-relaxed text-ink-soft">
          Clinic staff verify guardian access before sharing a child&apos;s clinical history. Contact your clinic if you need help signing in.
        </p>
      }
    >
      {mode === "unavailable" ? <SignInUnavailable /> : null}
      {mode === "unavailable" ? null : (
        <SignInForm
          audience="family"
          defaultEmail={params.email}
          alternate={{ text: "New to the family portal?", href: "/sign-up", link: "Create a family account" }}
          {...messages}
        />
      )}
    </AuthPage>
  );
}
