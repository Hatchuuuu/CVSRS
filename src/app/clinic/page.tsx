import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, ChevronRight, Circle, Clock3 } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { Notice, PageTitle } from "@/components/ui";
import { requireViewer, type Membership } from "@/lib/server/viewer";
import { clinicLandingRoute } from "@/lib/auth/destination";
import { activeClinicAccess } from "@/lib/auth/clinic-access";
import { staffRoleLabel } from "@/lib/staff-roles";
import { formatClinicDate } from "@/lib/format";
import { StaffApplicationForm, WithdrawApplicationButton } from "./application-forms";

export const metadata: Metadata = { title: "Clinic workspace" };

/**
 * Staff entry point (the destination of the unlisted staff sign-in). One active clinic opens directly; several are listed. Anyone without
 * an active clinic sees where their access stands, from their own account: applications, the administrator's decision, memberships
 * waiting for a second approval, and whether this sign-in has passed the second step. They can apply, re-apply or withdraw here.
 * Access itself is decided only by the database, never by this page.
 */
export default async function ClinicHome() {
  const { ctx, session, rpc } = await requireViewer();
  // One entry per clinic, with the capabilities of every role held there (audit F09).
  const active = activeClinicAccess(ctx.memberships);
  const pending = ctx.memberships.filter((m) => m.status === "pending_approval");
  if (active.length === 1 && active[0]) redirect(clinicLandingRoute(active[0].clinicId, active[0].capabilities));

  if (active.length === 0) {
    // Own applications and the public clinic directory (for applying). A failed read is reported, never shown as "no application".
    const [applications, clinics] = await Promise.all([
      rpc.rpc<StaffApplication[]>("my_staff_applications").then((rows) => rows ?? [], () => null),
      rpc.rpc<{ id: string; name: string }[]>("list_public_clinics").then((rows) => rows ?? [], () => null),
    ]);
    return <AccessStatus email={session.email ?? null} pending={pending} mfa={ctx.mfa} applications={applications} clinics={clinics} />;
  }

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Choose a clinic" lead="You only see children enrolled at the clinic you are working in." />
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {active.map((m) => (
          <li key={m.clinicId}>
            <Link href={clinicLandingRoute(m.clinicId, m.capabilities)} className="flex min-h-14 items-center justify-between gap-4 px-5 py-3 no-underline hover:bg-primary-soft">
              <span>
                <span className="block text-lg font-bold">{m.clinicName}</span>
                <span className="text-sm text-ink-soft">{m.roles.map(staffRoleLabel).join(" · ")}</span>
              </span>
              <ChevronRight aria-hidden className="size-5 text-ink-soft" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

type StepState = "done" | "current" | "waiting" | "upcoming";

const STEP_ICON: Record<StepState, ReactNode> = {
  done: <CheckCircle2 aria-hidden className="size-6 text-success" />,
  current: <Circle aria-hidden className="size-6 text-primary" strokeWidth={2.5} />,
  waiting: <Clock3 aria-hidden className="size-6 text-attention" />,
  upcoming: <Circle aria-hidden className="size-6 text-line-strong" />,
};
/** Spoken with each step, so its state never depends on the icon's colour. */
const STEP_STATUS: Record<StepState, string> = { done: "done", current: "to do", waiting: "waiting", upcoming: "not yet" };

function Step({ state, title, children }: { state: StepState; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 py-4 first:pt-0 last:pb-0">
      <span className="mt-0.5 shrink-0">{STEP_ICON[state]}</span>
      <div className="min-w-0">
        <p className="font-bold text-ink">
          {title} <span className="sr-only">({STEP_STATUS[state]})</span>
        </p>
        <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  );
}

interface StaffApplication {
  applicationId: string;
  clinicId: string;
  clinicName: string;
  clinicTimezone: string;
  requestedRole: string;
  positionTitle: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  decisionReason: string | null;
  createdAt: string;
  decidedAt: string | null;
  membershipStatus: string | null;
  grantedRole: string | null;
}

function AccessStatus({ email, pending, mfa, applications, clinics }: {
  email: string | null;
  pending: Membership[];
  mfa: boolean;
  applications: StaffApplication[] | null;
  clinics: { id: string; name: string }[] | null;
}) {
  const waiting = (applications ?? []).filter((a) => a.status === "pending");
  const sent = waiting.length > 0 || pending.length > 0;
  // A decline is never silent: the most recent one is shown until the person applies again.
  const lastDeclined = !sent ? (applications ?? []).find((a) => a.status === "rejected") : undefined;
  const fromApplication = new Set((applications ?? []).filter((a) => a.status === "accepted").map((a) => a.clinicId));
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle title="Clinic workspace" lead="Clinic records open once your health center has granted you access. Here is where your access stands." />
      {applications === null ? (
        <Notice tone="danger" role="alert" title="Your applications could not be loaded">
          Reload this page in a moment.
        </Notice>
      ) : null}
      <section aria-labelledby="access-steps-h" className="rounded-card border border-line bg-surface p-5 sm:p-6">
        <h2 id="access-steps-h" className="sr-only">
          Your clinic access
        </h2>
        <ol className="divide-y divide-line">
          <Step state="done" title="Account created">
            Signed in as <strong className="font-semibold break-all text-ink">{email ?? "your account"}</strong>.
          </Step>
          <Step state={sent ? "done" : "current"} title="Application to your health center">
            {sent ? (
              <ul className="grid gap-3">
                {waiting.map((a) => (
                  <li key={a.applicationId}>
                    Sent to <strong className="font-semibold text-ink">{a.clinicName}</strong> for {staffRoleLabel(a.requestedRole)}
                    {a.positionTitle ? ` (${a.positionTitle})` : ""} on {formatClinicDate(a.createdAt, a.clinicTimezone)}.
                    <WithdrawApplicationButton applicationId={a.applicationId} clinicName={a.clinicName} />
                  </li>
                ))}
                {pending
                  .filter((m) => !waiting.some((a) => a.clinicId === m.clinicId))
                  .map((m) => (
                    <li key={m.clinicId}>
                      {fromApplication.has(m.clinicId) ? "Your application to " : "Your clinic requested access for you at "}
                      <strong className="font-semibold text-ink">{m.clinicName}</strong>
                      {fromApplication.has(m.clinicId) ? " was accepted." : "."}
                    </li>
                  ))}
              </ul>
            ) : (
              <>
                {lastDeclined ? (
                  <p className="mb-2 rounded-control border border-danger/30 bg-danger-bg p-3 text-danger">
                    Your application to <strong className="font-semibold">{lastDeclined.clinicName}</strong> was declined.
                    {lastDeclined.decisionReason ? <> Reason: &ldquo;{lastDeclined.decisionReason}&rdquo;</> : null} You can apply again below.
                  </p>
                ) : null}
                <span>Choose your health center and the role you work in. Its administrators accept or decline your application.</span>
                {clinics === null ? (
                  <p role="alert" className="mt-2 text-danger">
                    The list of health centers could not be loaded. Reload this page in a moment.
                  </p>
                ) : (
                  <StaffApplicationForm clinics={clinics} />
                )}
              </>
            )}
          </Step>
          <Step state={pending.length > 0 ? "done" : waiting.length > 0 ? "waiting" : "upcoming"} title="Accepted by an administrator">
            {pending.length > 0
              ? "An administrator accepted, and requested access for your role."
              : waiting.length > 0
                ? "Waiting for an administrator at your health center to review your application."
                : "An administrator at your health center reviews your application and accepts or declines it."}
          </Step>
          <Step state={pending.length > 0 ? "waiting" : "upcoming"} title="Approved by a second person">
            {pending.length > 0 ? (
              <ul className="grid gap-1">
                {pending.map((m) => (
                  <li key={m.clinicId}>
                    Waiting for approval at <strong className="font-semibold text-ink">{m.clinicName}</strong> as {staffRoleLabel(m.role)}.
                  </li>
                ))}
              </ul>
            ) : (
              "Someone other than the person who accepted your application approves your access. Nobody can approve their own."
            )}
          </Step>
          <Step state={mfa ? "done" : "current"} title="Two-step sign-in">
            {mfa ? (
              "Confirmed for this sign-in."
            ) : (
              <>
                <span>Clinic records stay closed until you confirm a code from an authenticator app. You can set it up now.</span>{" "}
                <Link href="/account/security" className="inline-flex min-h-11 items-center gap-1 font-bold text-primary">
                  Set up two-step sign-in <ArrowRight aria-hidden className="size-4" />
                </Link>
              </>
            )}
          </Step>
        </ol>
      </section>
      <p className="mt-5 text-sm leading-relaxed text-ink-soft">
        Opened this page as a parent or guardian? Your children&apos;s records are under{" "}
        <Link href="/children" className="font-semibold text-primary">
          My Children
        </Link>
        .
      </p>
    </div>
  );
}
