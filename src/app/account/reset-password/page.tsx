import type { Metadata } from "next";
import { PageTitle } from "@/components/ui";
import { SignInUnavailable, signUpMode } from "@/app/sign-up/availability";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

/** Like the request page: a copy that is not connected to the sign-in service says so instead of failing in the browser. */
export default async function ResetPassword() {
  const mode = await signUpMode();
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Choose a new password" />
      {mode === "live" ? <ResetPasswordForm /> : <SignInUnavailable />}
    </div>
  );
}
