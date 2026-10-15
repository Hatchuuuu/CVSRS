import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { SignInUnavailable, signUpMode } from "@/app/sign-up/availability";
import { RecoveryRequestForm } from "./recovery-request-form";

export const metadata: Metadata = { title: "Reset password" };

/**
 * Only a copy connected to the sign-in service can send a reset link. Elsewhere the page says so instead of showing a form that
 * would report "a link will arrive" while nothing is sent (audit F06).
 */
export default async function ForgotPassword() {
  const mode = await signUpMode();
  return (
    <div className="mx-auto max-w-md py-6">
      <PageTitle title="Reset password" lead={mode === "live" ? "Enter the email address for your account. If it matches, we will send a reset link." : undefined} />
      {mode === "live" ? (
        <RecoveryRequestForm />
      ) : (
        <SignInUnavailable />
      )}
    </div>
  );
}
