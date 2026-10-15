import Link from "next/link";
import { Info } from "lucide-react";
import { ConfigError, getConfig } from "@/lib/env";

/**
 * Whether this copy can create accounts and sign people in:
 * - "live": connected to the sign-in service (Supabase Auth);
 * - "unavailable": not connected (the sign-in service settings are missing), so a form could never succeed and is not shown.
 * Any other configuration problem is left to the server's normal error handling when a form is sent.
 */
export type SignUpMode = "live" | "unavailable";

export async function signUpMode(): Promise<SignUpMode> {
  try {
    getConfig();
    return "live";
  } catch (error) {
    return error instanceof ConfigError && error.kind === "unconfigured" ? "unavailable" : "live";
  }
}

const NOT_CONNECTED = "This copy of eVacTrack is not connected to its sign-in service, so it has no accounts. If you run this copy, start it as the README describes (npm run dev); otherwise contact your health center.";

export function SignUpUnavailable({ signInHref }: { signInHref: string }) {
  return (
    <div role="status" className="flex items-start gap-3 rounded-card border border-info/20 bg-info-bg p-4 text-sm text-info">
      <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-2">
        <p className="font-semibold">Accounts cannot be created here right now.</p>
        <p>{NOT_CONNECTED}</p>
        <Link href={signInHref} className="inline-flex min-h-11 items-center font-bold text-primary hover:underline">
          Go to sign in
        </Link>
      </div>
    </div>
  );
}

/** Sign-in and password recovery on a copy that is not connected to the sign-in service (audit F06/F07). */
export function SignInUnavailable() {
  return (
    <div role="status" className="flex items-start gap-3 rounded-card border border-info/20 bg-info-bg p-4 text-sm text-info">
      <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-2">
        <p className="font-semibold">Sign-in is unavailable here right now.</p>
        <p>{NOT_CONNECTED}</p>
      </div>
    </div>
  );
}
