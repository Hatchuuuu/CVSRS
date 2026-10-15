import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, BookOpenText, ChevronRight, FlaskConical, KeyRound, ScrollText, Settings, type LucideIcon } from "lucide-react";
import { EmptyState, Notice, PageTitle, Section, StatusChip } from "@/components/ui";
import { requireClinicStaff } from "@/lib/server/viewer";
import { formatClinicDate } from "@/lib/format";
import { staffRoleLabel } from "@/lib/staff-roles";
import { STAFF_SIGN_UP_PATH } from "@/lib/auth/staff-entry";
import { OutcomeNoticeView } from "@/components/outcome-notice";
import { StaffRowActions } from "../access/staff-forms";
import { ApplicationDecision } from "./application-decision";
import { CreateStaffAccount } from "./create-staff-account";

export const metadata: Metadata = { title: "Admin console" };

interface Application {
  applicationId: string;
  profileId: string;
  displayName: string;
  email: string | null;
  emailConfirmed: boolean | null;
  requestedRole: string;
  positionTitle: string | null;
  note: string | null;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  version: number;
  createdAt: string;
  decidedAt: string | null;
  decidedByName: string | null;
  decisionReason: string | null;
  membershipStatus: string | null;
  grantedRole: string | null;
  requiresClinicalApproval: boolean;
}

interface Membership {
  membershipId: string;
  profileId: string;
  displayName: string;
  role: string;
  status: string;
  version: number;
  requestedBy: string | null;
  requiresClinicalApproval: boolean;
}

const DECISION: Record<Application["status"], { tone: "success" | "attention" | "danger" | "neutral"; label: string }> = {
  pending: { tone: "attention", label: "Waiting" },
  accepted: { tone: "success", label: "Accepted" },
  rejected: { tone: "danger", label: "Declined" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
};

interface Tool {
  href: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  allowed: (caps: Set<string>) => boolean;
}

/** Every administration area of the clinic workspace, each shown only to roles its page admits. */
const TOOLS: Tool[] = [
  { href: "access", label: "Staff access", description: "Everyone's access at this clinic: request access for a person, approve requests and remove access.", Icon: KeyRound, allowed: (c) => c.has("admin.users") || c.has("grant.approve.clinical") },
  { href: "settings", label: "Settings and operations", description: "Clinic contact details, opening hours and time zone, backups and operations status.", Icon: Settings, allowed: (c) => c.has("admin.config") || c.has("audit.read") },
  { href: "clinical", label: "Clinical setup", description: "Vaccines and products, the approved vaccination schedule and the privacy notice for families.", Icon: FlaskConical, allowed: (c) => c.has("admin.config") || c.has("rules.propose") || c.has("rules.approve") },
  { href: "content", label: "Care information", description: "Guidance published to families. Each version is checked by a second person before families see it.", Icon: BookOpenText, allowed: (c) => c.has("admin.config") || c.has("rules.propose") || c.has("rules.approve") },
  { href: "audit", label: "Audit log", description: "Who did what, and when, at this clinic. Search by action, person or date.", Icon: ScrollText, allowed: (c) => c.has("audit.read") },
  { href: "reports", label: "Reports", description: "Clinic totals and paper tallies, exported without names.", Icon: BarChart3, allowed: (c) => c.has("report.run") || c.has("vaccination.record") },
];

/**
 * Admin console: one place to run a clinic. Staff applications wait here for an access administrator to accept or decline; accepted
 * applications and other access requests wait here for a second person's approval; every other administration area is one link away.
 * The page shows only what the viewer's role admits, and the database authorizes every action again.
 */
export default async function AdminConsole({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  const reviewsAccess = caps.has("admin.users") || caps.has("grant.approve.clinical");
  if (!reviewsAccess && !caps.has("admin.config")) notFound();
  const base = `/clinic/${clinicId}`;
  const tz = membership.clinicTimezone;

  // Failed reads are reported as failures, never shown as "nothing waiting".
  const [pending, decided, memberships] = reviewsAccess
    ? await Promise.all([
        rpc.rpc<Application[]>("list_staff_applications", { p_clinic_id: clinicId, p_view: "pending" }).then((r) => r ?? [], () => null),
        rpc.rpc<Application[]>("list_staff_applications", { p_clinic_id: clinicId, p_view: "decided" }).then((r) => r ?? [], () => null),
        rpc.rpc<Membership[]>("list_staff_memberships", { p_clinic_id: clinicId }).then((r) => r ?? [], () => null),
      ])
    : [[], [], []];
  const waitingApproval = (memberships ?? []).filter((m) => m.status === "pending_approval");
  const activeStaff = (memberships ?? []).filter((m) => m.status === "active").length;
  const canApprove = (m: Membership) =>
    caps.has(m.requiresClinicalApproval ? "grant.approve.clinical" : "admin.users") && m.profileId !== ctx.profileId && m.requestedBy !== ctx.profileId;
  const tools = TOOLS.filter((t) => t.allowed(caps));
  const signUpUrl = `${process.env.CVSRS_PUBLIC_URL?.replace(/\/$/, "") ?? ""}${STAFF_SIGN_UP_PATH}`;

  return (
    <>
      <PageTitle
        title="Admin console"
        lead={`Run ${membership.clinicName} in eVacTrack: review staff applications, approve access, and reach every administration tool from here.`}
      />

      {reviewsAccess ? (
        <ul className="grid gap-3 sm:grid-cols-3" aria-label="At a glance">
          {[
            { label: "Applications waiting", value: pending?.length, href: "#applications" },
            { label: "Access requests to approve", value: memberships ? waitingApproval.length : undefined, href: "#approvals" },
            { label: "Active staff", value: memberships ? activeStaff : undefined, href: `${base}/access` },
          ].map((s) => (
            <li key={s.label} className="rounded-card border border-line bg-surface">
              <Link href={s.href} className="flex min-h-11 items-center justify-between gap-3 rounded-card px-4 py-3 no-underline hover:bg-sunken sm:flex-col sm:items-start sm:justify-start sm:gap-1">
                <span className="text-sm font-semibold text-ink-soft">{s.label}</span>
                <span className="tnum text-xl font-bold text-ink sm:text-2xl">{s.value ?? "—"}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {reviewsAccess ? (
        <Section id="create-staff" title="Create staff account" description="Create a local account for a nurse, midwife, barangay health worker or other clinic staff member. Access follows the clinic’s approval and sign-in rules.">
          {caps.has("admin.users") ? <CreateStaffAccount clinicId={clinicId} /> : <Notice tone="attention" title="Account creation is restricted">An access administrator must create the account.</Notice>}
        </Section>
      ) : null}

      {reviewsAccess ? (
        <Section
          id="applications"
          title="Staff applications"
          description={
            <>
              New staff apply when they create a staff account at <strong className="break-all font-semibold text-ink">{signUpUrl}</strong>. Accept to
              send their access for a second person&apos;s approval, or decline with a reason they will see.
            </>
          }
          className="scroll-mt-[calc(var(--header-h)+1rem)]"
        >
          <OutcomeNoticeView noticeKey={`staff-applications:${clinicId}`} />
          {pending === null ? (
            <Notice tone="danger" role="alert" title="Applications could not be loaded">
              Reload this page in a moment.
            </Notice>
          ) : pending.length === 0 ? (
            <EmptyState title="No applications waiting">New applications appear here as soon as someone applies to this clinic.</EmptyState>
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface" aria-label="Applications waiting">
              {pending.map((a) => (
                <li key={a.applicationId} className="p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-bold text-ink">{a.displayName || "(no name given)"}</p>
                      <p className="break-all text-sm text-ink-soft">{a.email ?? "No email on record"}</p>
                    </div>
                    {a.emailConfirmed === false ? <StatusChip tone="attention">Email not confirmed yet</StatusChip> : null}
                  </div>
                  <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                    <dt className="font-semibold text-ink">Applied for</dt>
                    <dd className="text-ink-soft">
                      {staffRoleLabel(a.requestedRole)}
                      {a.positionTitle ? ` · ${a.positionTitle}` : ""}
                    </dd>
                    <dt className="font-semibold text-ink">Applied on</dt>
                    <dd className="text-ink-soft">{formatClinicDate(a.createdAt, tz)}</dd>
                    {a.note ? (
                      <>
                        <dt className="font-semibold text-ink">Note</dt>
                        <dd className="whitespace-pre-line text-ink-soft">{a.note}</dd>
                      </>
                    ) : null}
                  </dl>
                  {a.profileId === ctx.profileId ? (
                    <p className="mt-3 text-sm text-ink-soft">This is your own application. Another administrator decides it.</p>
                  ) : (
                    <ApplicationDecision
                      clinicId={clinicId}
                      application={{ id: a.applicationId, version: a.version, name: a.displayName || "this applicant", requestedRole: a.requestedRole }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}

          {decided && decided.length > 0 ? (
            <details className="mt-4 rounded-card border border-line bg-surface">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-ink">Recently decided ({decided.length})</summary>
              <ul className="divide-y divide-line border-t border-line" aria-label="Recently decided applications">
                {decided.map((a) => {
                  const chip = DECISION[a.status];
                  return (
                    <li key={a.applicationId} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">
                          {a.displayName || "(no name given)"} <span className="font-normal text-ink-soft">· {staffRoleLabel(a.grantedRole ?? a.requestedRole)}</span>
                        </p>
                        <p className="text-ink-soft">
                          {a.status === "withdrawn" ? "Withdrawn by the applicant" : `By ${a.decidedByName || "an administrator"}`}
                          {a.decidedAt ? ` on ${formatClinicDate(a.decidedAt, tz)}` : ""}
                          {a.decisionReason ? ` · “${a.decisionReason}”` : ""}
                          {a.status === "accepted" && a.membershipStatus === "pending_approval" ? " · waiting for a second approval" : ""}
                          {a.status === "accepted" && a.membershipStatus === "active" ? " · access active" : ""}
                        </p>
                      </div>
                      <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
                    </li>
                  );
                })}
              </ul>
            </details>
          ) : null}
        </Section>
      ) : null}

      {reviewsAccess ? (
        <Section
          id="approvals"
          title="Access waiting for approval"
          description="Accepted applications and access requests need approval from someone other than the person who requested them. Clinical access is approved by a clinical lead."
          className="scroll-mt-[calc(var(--header-h)+1rem)]"
        >
          <OutcomeNoticeView noticeKey={`staff-access:${clinicId}`} />
          {memberships === null ? (
            <Notice tone="danger" role="alert" title="Access requests could not be loaded">
              Reload this page in a moment.
            </Notice>
          ) : waitingApproval.length === 0 ? (
            <EmptyState title="Nothing waiting for approval" />
          ) : (
            <ul className="divide-y divide-line rounded-card border border-line bg-surface" aria-label="Access waiting for approval">
              {waitingApproval.map((m) => {
                const approvable = canApprove(m);
                return (
                  <li key={m.membershipId} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold text-ink">
                        {m.displayName || "(no name given)"} <span className="font-normal text-ink-soft">— {staffRoleLabel(m.role)}</span>
                      </p>
                      <StatusChip tone="attention">Waiting for approval</StatusChip>
                    </div>
                    <p className="text-sm text-ink-soft">
                      {m.requiresClinicalApproval ? "Clinical access: a clinical lead approves." : "Non-clinical access: another access administrator approves."}
                      {m.requestedBy === ctx.profileId ? " You requested this, so someone else must approve it." : ""}
                      {m.profileId === ctx.profileId ? " This is your own access; someone else must approve it." : ""}
                      {!approvable && m.requestedBy !== ctx.profileId && m.profileId !== ctx.profileId ? " Your role cannot approve this one." : ""}
                    </p>
                    <StaffRowActions clinicId={clinicId} row={{ id: m.membershipId, version: m.version, name: m.displayName }} canApprove={approvable} canRevoke={false} />
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}

      <Section id="tools" title="Administration tools" description="Everything else you can manage at this clinic.">
        <ul className="divide-y divide-line rounded-card border border-line bg-surface">
          {tools.map(({ href, label, description, Icon }) => (
            <li key={href}>
              <Link href={`${base}/${href}`} className="group flex min-h-14 items-center gap-4 px-4 py-3.5 no-underline hover:bg-sunken">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-control bg-primary-soft text-primary">
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-bold text-ink group-hover:text-primary-strong">{label}</span>
                  <span className="block text-sm text-ink-soft">{description}</span>
                </span>
                <ChevronRight aria-hidden className="size-5 shrink-0 text-ink-soft" />
              </Link>
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}
