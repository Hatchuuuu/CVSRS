import type { Metadata } from "next";
import { LinkButton, Notice, PageTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Signed out on this device", robots: { index: false, follow: false } };

/** Shown by /auth/sign-out when this device was signed out but Auth did not confirm that the account's other sessions were ended. */
export default function SignedOut() {
  return (
    <div className="mx-auto max-w-lg">
      <PageTitle title="Signed out on this device" />
      <Notice tone="attention" role="alert" title="Other sessions could not be ended">
        <p>You are signed out here. We could not reach the sign-in service to end this account&apos;s sessions on other devices.</p>
        <p className="mt-2">To try again, sign in and sign out once more. If this computer is shared, it is safe to leave it now.</p>
      </Notice>
      <div className="flex flex-wrap gap-3">
        <LinkButton href="/sign-in">Sign in to try again</LinkButton>
        <LinkButton href="/" variant="secondary">Go to the home page</LinkButton>
      </div>
    </div>
  );
}
