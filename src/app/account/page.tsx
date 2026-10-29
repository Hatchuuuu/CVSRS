import { personName } from "@/lib/person-name";
import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Lock, MessageSquare, UserRound } from "lucide-react";
import { Notice, PageTitle, Section } from "@/components/ui";
import { requireViewer } from "@/lib/server/viewer";
import { activeClinicAccess } from "@/lib/auth/clinic-access";
import { portalHref, resolvePortalContext } from "@/lib/portal-context";
import { PasswordForm, ProfileForm } from "./account-forms";
import { TextSettings, type ContactPrefs } from "../messages/text-settings";

export const metadata: Metadata = { title: "Account" };

const rowLink = "flex min-h-14 items-center justify-between gap-4 px-4 py-3 no-underline hover:bg-primary-soft";

export default async function Account({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { ctx, session, rpc } = await requireViewer();
  const prefs = await rpc.rpc<ContactPrefs>("get_contact_preferences");
  if (!prefs && activeClinicAccess(ctx.memberships).length === 0) {
    const children = await rpc.rpc<{ childId: string }[]>("my_children");
    if (!children || children.length > 0) throw new Error("Contact preferences could not be loaded. Please try again.");
  }
  const raw = searchParams ? await searchParams : {};
  const query = new URLSearchParams();
  for (const key of ["portal", "clinic"]) {
    const value = raw[key];
    if (typeof value === "string") query.set(key, value);
    else value?.forEach(v => query.append(key, v));
  }
  const context = resolvePortalContext("/account", query, ctx.memberships);
  const needsName = ctx.needsName === true;
  const isStaff = ctx.memberships.some(m => m.status === "active");
  return (
    <div className="space-y-6">
      <PageTitle dashboard title="Account" lead="Manage your profile, password and contact preferences." action={<a href="#signin-h" className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-4 text-sm font-semibold text-ink no-underline hover:bg-sunken"><Lock aria-hidden className="size-4" />Password settings</a>} />

      {needsName ? (
        <Notice tone="attention" title="Add your full name">
          Your account has no name yet. Add the name on your ID so the clinic can identify you.
        </Notice>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="min-w-0 space-y-6">
      <Section panel id="profile-h" title="Your details" description="Keep your name and preferred language up to date.">
        <ProfileForm displayName={personName(ctx.displayName)} locale={ctx.locale} needsName={needsName} />
        <p className="mt-4 max-w-prose text-sm text-ink-soft">
          {isStaff ? "This updates your account profile. Your clinic roles and access are managed by the clinic administrator." : "The name on a child's record is kept as the clinic verified it. If it is wrong there, ask the clinic to correct it."}
        </p>
      </Section>

      <Section panel id="contact-h" title="Contact preferences" description="Keep a phone number the clinic can use to contact you.">
        {prefs ? <TextSettings prefs={prefs} /> : <p className="text-sm text-ink-soft">Contact preferences become available after you register or link a child with a clinic. For staff contact details, ask your clinic administrator.</p>}
      </Section>

      <Section panel id="signin-h" title="Signing in" description="Choose a strong password that you do not use elsewhere.">
        <PasswordForm />
        <p className="mt-4 max-w-prose text-sm text-ink-soft">To use a different email address for signing in, ask the clinic to help preserve your account access.</p>
      </Section>

      </div>
      <aside className="min-w-0 space-y-6" aria-label="Account information">
        <section className="rounded-card border border-line bg-surface p-5 sm:p-6" aria-labelledby="account-summary-h">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary"><UserRound aria-hidden className="size-6" /></div>
          <h2 id="account-summary-h" className="break-words text-lg font-bold">{needsName ? "Your account" : ctx.displayName}</h2>
          <p className="mt-1 break-all text-sm text-ink-soft">{session.email}</p>
          <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-soft">Portal</dt><dd className="font-semibold">{context.kind === "parents" ? "Parents Portal" : context.kind === "developer" ? "Developer Console" : "Clinics Portal"}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-ink-soft">Preferred language</dt><dd className="font-semibold">{ctx.locale === "fil" ? "Filipino" : "English"}</dd></div>
          </dl>
        </section>
      <Section panel id="more-h" title="Security and messages">
        <ul className="-mx-4 divide-y divide-line">
          {!ctx.mfa ? <li>
            <Link href="/account/security" className={rowLink}>
              <span className="flex items-center gap-3">
                <Lock aria-hidden className="size-5 text-primary" />
                <span>
                  <span className="block font-semibold text-ink">Two-step sign-in</span>
                  <span className="text-sm text-ink-soft">Manage an additional sign-in step.</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-soft" />
            </Link>
          </li> : null}
          <li>
            <Link href={portalHref("/messages", context)} className={rowLink}>
              <span className="flex items-center gap-3">
                <MessageSquare aria-hidden className="size-5 text-primary" />
                <span>
                  <span className="block font-semibold text-ink">Clinic messages</span>
                  <span className="text-sm text-ink-soft">Read clinic updates and booking confirmations.</span>
                </span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-soft" />
            </Link>
          </li>
        </ul>
      </Section>

      <Section panel id="close-h" title="Closing your account">
        <p className="max-w-prose text-sm text-ink-soft">
          {isStaff ? "Ask your clinic administrator to end your staff access. Clinical records and audit history remain with the clinic." : "Ask the health center to close your account. Your access ends, and the clinic keeps your children's vaccination records as its records policy requires, because those records belong to the child's care."}
        </p>
      </Section>
      </aside>
      </div>
    </div>
  );
}
