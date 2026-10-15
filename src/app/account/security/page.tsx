import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { clinicReturnPath } from "@/lib/auth/redirect";
import { requireViewer } from "@/lib/server/viewer";
import { MfaPanel } from "./mfa-panel";

export const metadata: Metadata = { title: "Account security" };

export default async function AccountSecurity({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const { ctx } = await requireViewer();
  const { next } = await searchParams;
  // Only a strict same-origin clinic workspace path is honoured (src/lib/auth/redirect.ts); anything else is ignored.
  const returnTo = clinicReturnPath(typeof next === "string" ? next : null);
  if (ctx.mfa) redirect(returnTo ?? "/account");
  return (
    <>
      <PageTitle title="Account security" lead="A second step at sign-in protects children's records if a password is stolen." />
      <MfaPanel returnTo={returnTo} />
    </>
  );
}
