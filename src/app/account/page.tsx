import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Lock, MessageSquare } from "lucide-react";
import { Notice, PageTitle, Section } from "@/components/ui";
import { requireViewer } from "@/lib/server/viewer";
import { PasswordForm, ProfileForm } from "./account-forms";

export const metadata: Metadata = { title: "Account" };

const rowLink = "flex min-h-14 items-center justify-between gap-4 px-4 py-3 no-underline hover:bg-primary-soft";

export default async function Account() {
  const { ctx, session } = await requireViewer();
  const needsName = ctx.needsName === true;
  return (
    <div className="max-w-3xl">
      <PageTitle title="Account" lead={session.email ? `Signed in as ${session.email}` : undefined} />

      {needsName ? (
        <Notice tone="attention" title="Add your full name">
          Your account has no name yet. Clinic staff use it to confirm that you are the child&apos;s guardian.
        </Notice>
      ) : null}

      <Section id="profile-h" title="Your details" className="mt-0 border-t-0 pt-0">
        <ProfileForm displayName={ctx.displayName} locale={ctx.locale} needsName={needsName} />
        <p className="mt-4 max-w-prose text-sm text-ink-soft">
          The name on a child&apos;s record is kept as the clinic verified it. If it is wrong there, ask the clinic to correct it.
        </p>
      </Section>

      <Section id="signin-h" title="Signing in">
        <PasswordForm />
        <p className="mt-4 max-w-prose text-sm text-ink-soft">To use a different email address for signing in, ask the clinic. It keeps your access and your children&apos;s records together.</p>
      </Section>

      <Section id="more-h" title="Security and messages">
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {!ctx.mfa ? <li>
            <Link href="/account/security" className={rowLink}>
              <span className="flex items-center gap-3">
                <Lock aria-hidden className="size-5 text-primary" />
                <span>
                  <span className="block font-semibold text-ink">Two-step sign-in</span>
                  <span className="text-sm text-ink-soft">Required for clinic staff; recommended for everyone.</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-soft" />
            </Link>
          </li> : null}
          <li>
            <Link href="/messages" className={rowLink}>
              <span className="flex items-center gap-3">
                <MessageSquare aria-hidden className="size-5 text-primary" />
                <span>
                  <span className="block font-semibold text-ink">Phone number and text messages</span>
                  <span className="text-sm text-ink-soft">Change the number the clinic calls or texts.</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-soft" />
            </Link>
          </li>
        </ul>
      </Section>

      <Section id="close-h" title="Closing your account">
        <p className="max-w-prose text-sm text-ink-soft">
          Ask the health center to close your account. Your access ends, and the clinic keeps your children&apos;s vaccination records as its records policy
          requires, because those records belong to the child&apos;s care.
        </p>
      </Section>
    </div>
  );
}
