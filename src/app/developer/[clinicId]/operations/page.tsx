import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice, PageTitle, Section, StatusChip } from "@/components/ui";
import { OpsCheckForm } from "@/app/clinic/[clinicId]/settings/forms";
import { requireDeveloper } from "@/lib/server/developer";
import { formatDate, formatClinicDateTime } from "@/lib/format";
import { RefreshStatus } from "@/components/technical/refresh-status";
interface Check { result: "passed" | "failed"; performedOn: string; evidence: string; daysAgo: number }
interface Ops { checks: Record<"restore_drill" | "database_backup" | "file_backup", Check | null>; jobs: { queued: number; processing: number; failed: number; oldestQueuedMinutes: number | null }; sms: { queued: number; failed: number }; lastAudit: string | null }
const kinds = { restore_drill: "Restore drill", database_backup: "Database backup", file_backup: "File backup" } as const;
export const metadata = { title: "Operations · Developer Console" };
export default async function Operations({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireDeveloper(clinicId);
  if (!membership.capabilities.includes("admin.config")) notFound();
  const ops = await rpc.rpc<Ops>("get_ops_status", { p_clinic_id: clinicId });
  if (!ops) throw new Error("Operations status unavailable");
  return <>
    <PageTitle title="Operations" lead="Recorded checks and current queue counts. A recorded pass is evidence of that check, not a live health guarantee." />
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm"><p>Read at {formatClinicDateTime(new Date().toISOString(), membership.clinicTimezone)}</p><RefreshStatus /><Link href={`/developer/${clinicId}/operations/runbook`}>Open local operations runbook</Link></div>
    {!ops.checks.restore_drill || ops.checks.restore_drill.result === "failed" || ops.checks.restore_drill.daysAgo > 90 ? <Notice tone="attention" title="Restore evidence needs attention">Run the existing disposable restore drill and record its outcome. Local instructions: docs/operations/runbook.md.</Notice> : null}
    <Section id="backup-h" title="Recorded backup and restore evidence"><dl className="grid gap-3 sm:grid-cols-3">{(Object.keys(kinds) as (keyof typeof kinds)[]).map((kind) => {
      const check = ops.checks[kind];
      return <div key={kind} className="rounded-card border border-line p-4"><dt className="font-bold">{kinds[kind]}</dt><dd><StatusChip tone={check ? check.result === "passed" ? "success" : "danger" : "neutral"}>{check ? check.result : "Unknown: never recorded"}</StatusChip>{check ? <p className="mt-2 break-words text-sm">{formatDate(check.performedOn)} · {check.evidence}</p> : null}</dd></div>;
    })}</dl></Section>
    <Section id="jobs-h" title="Message processing"><dl className="grid gap-3 sm:grid-cols-2">{[["Queued", ops.jobs.queued], ["Processing", ops.jobs.processing], ["Failed", ops.jobs.failed], ["Oldest ready queued job (minutes)", ops.jobs.oldestQueuedMinutes ?? "None ready"], ["SMS queued / failed", `${ops.sms.queued} / ${ops.sms.failed}`]].map(([label, value]) => <div key={label} className="rounded-card border border-line p-4"><dt>{label}</dt><dd className="font-bold">{value}</dd></div>)}</dl><p className="mt-3 text-sm">Queue counts cover this clinic’s organization. SMS counts describe stored jobs and do not prove external delivery.</p></Section>
    <Section id="record-h" title="Record a completed check" description="Run checks through the existing local tools first, then record the evidence here."><OpsCheckForm clinicId={clinicId} /></Section>
  </>;
}
