import type { Metadata } from "next";
import { FamilyMascot } from "@/components/family-mascot";
import { AuthPage } from "@/components/auth-page";
import { SignUpUnavailable, signUpMode } from "./availability";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create a family account",
  description: "Register a family account for clinic vaccination records and appointments.",
};

export default async function SignUp() {
  const mode = await signUpMode();
  return (
    <AuthPage
      headingVisual={<FamilyMascot />}
      width="wide"
      title="Create a family account"
      lead="Keep your child's vaccination records and clinic visits organized in one secure place. Clinic staff verify guardian access before sharing clinical history."
    >
      {mode === "unavailable" ? (
        <SignUpUnavailable signInHref="/sign-in" />
      ) : (
        <SignUpForm audience="family" alternate={{ text: "Already registered?", href: "/sign-in", link: "Sign in to existing account" }} />
      )}
    </AuthPage>
  );
}
