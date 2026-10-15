import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageTitle, Section, StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { OpsCheckForm, ProfileForm, type Profile } from "./forms";

export const metadata: Metadata = { title: "Clinic settings and operations" };

interface Check {
  result: "passed" | "failed";
  performedOn: string;
  evidence: string;
  daysAgo: number;
}
interface Ops {
  checks: { restore_drill: Check | null; database_backup: Check | null; file_backup: Check | null };
  jobs: { queued: number; processing: number; failed: number; oldestQueuedMinutes: number | null };
  sms: { queued: number; failed: number };
  lastAudit: string | null;
}

const KIND = { restore_drill: "Restore drill", database_backup: "Database backup", file_backup: "File backup" } as const;

export default async function Settings({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  const canConfig = caps.has("admin.config");
  if (!canConfig && !caps.has("audit.read")) notFound();
  const [profile, ops] = await Promise.all([
    canConfig ? rpc.rpc<Profile>("get_clinic_profile", { p_clinic_id: clinicId }) : Promise.resolve(null),
    rpc.rpc<Ops>("get_ops_status", { p_clinic_id: clinicId }),
  ]);
  const drill = ops?.checks.restore_drill ?? null;

  return (
    <>
      <PageTitle title="Clinic settings and operations" lead="What families see about your clinic, and whether the system is being looked after." />

      {caps.has("audit.read") ? (
        <p className="mb-6">
          <Link href={`/clinic/${clinicId}/audit`} className="font-semibold text-primary">
            Open the audit trail
          </Link>
        </p>
      ) : null}

      {ops ? (
        <Section id="ops-h" title="Operations status" className="border-t-0 pt-0" description="Only facts that someone recorded. If nothing was recorded, it says so.">
          {!drill || drill.result === "failed" ? (
            <Notice tone="attention" title={!drill ? "No restore drill has been recorded" : "The last recorded restore drill failed"}>
              A backup has not been proven until it has been restored and checked. See the runbook (docs/operations/runbook.md).
            </Notice>
          ) : drill.daysAgo > 90 ? (
            <Notice tone="attention" title={`The last restore drill was ${drill.daysAgo} days ago`}>
              Repeat it at least every three months.
            </Notice>
          ) : null}
          <dl className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => {
              const c = ops.checks[k];
              return (
                <div key={k} className="rounded-control border border-line bg-surface p-3">
                  <dt className="text-sm text-ink-soft">{KIND[k]}</dt>
                  <dd>
                    {c ? (
                      <>
                        <StatusChip tone={c.result === "passed" ? "success" : "danger"}>{c.result === "passed" ? "Passed" : "Failed"}</StatusChip>
                        <span className="mt-1 block text-sm text-ink-soft">
                          {formatDate(c.performedOn)} · {c.evidence}
                        </span>
                      </>
                    ) : (
                      <StatusChip tone="neutral">Unknown: never recorded</StatusChip>
                    )}
                  </dd>
                </div>
              );
            })}
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-sm text-ink-soft">Messages waiting</dt>
              <dd className="tnum text-2xl font-bold">
                {ops.jobs.queued}
                {ops.jobs.oldestQueuedMinutes && ops.jobs.oldestQueuedMinutes > 5 ? <span className="ml-2 text-sm font-normal text-attention">oldest {ops.jobs.oldestQueuedMinutes} min</span> : null}
              </dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-sm text-ink-soft">Messages that failed</dt>
              <dd className="tnum text-2xl font-bold">{ops.jobs.failed}</dd>
            </div>
            <div className="rounded-control border border-line bg-surface p-3">
              <dt className="text-sm text-ink-soft">Text messages waiting / failed</dt>
              <dd className="tnum text-2xl font-bold">
                {ops.sms.queued} / {ops.sms.failed}
              </dd>
            </div>
          </dl>
          {canConfig ? (
            <div className="mt-6">
              <h3 className="mb-2 text-lg font-bold">Record a backup or restore check</h3>
              <OpsCheckForm clinicId={clinicId} />
            </div>
          ) : null}
        </Section>
      ) : null}

      {profile ? (
        <Section id="cp-h" title="Clinic details" className={ops ? "" : "border-t-0 pt-0"} description="Shown on the public start page.">
          <ProfileForm clinicId={clinicId} profile={profile} />
        </Section>
      ) : null}
    </>
  );
}
