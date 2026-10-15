import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageTitle, StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { Act, ContentForm, WithReason, type Version } from "./forms";
import { NewContent } from "./new-content";

export const metadata: Metadata = { title: "Care information" };

const STATUS = {
  draft: { tone: "neutral", label: "Draft" },
  submitted: { tone: "review", label: "Waiting for review" },
  active: { tone: "success", label: "Shown to families" },
  rejected: { tone: "danger", label: "Rejected" },
  retired: { tone: "neutral", label: "Withdrawn or replaced" },
} as const;

export default async function Content({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  const canWrite = caps.has("admin.config") || caps.has("rules.propose");
  const canReview = caps.has("rules.approve");
  if (!canWrite && !canReview) notFound();
  const versions = (await rpc.rpc<Version[]>("list_content", { p_clinic_id: clinicId })) ?? [];
  const base = `/api/v1/clinics/${clinicId}/content`;

  return (
    <>
      <PageTitle title="Care information" lead="Text your clinic wants families to read, such as what to expect after a visit. Families see it only after a second person has approved it. The system supplies no text of its own." />
      <Notice tone="info" title="Who does what">
        One person writes it and another person with approval rights publishes it. Published wording cannot be edited: write a new version, and the old one is replaced when the new one is approved.
      </Notice>
      {versions.length === 0 ? <EmptyState title="Nothing written yet" /> : null}
      <ul className="mb-6 divide-y divide-line rounded-control border border-line bg-surface">
        {versions.map((v) => {
          const mine = v.authoredById === ctx.profileId;
          return (
            <li key={v.versionId} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  {v.title} <span className="font-normal text-ink-soft">· {v.code} · {v.language === "en" ? "English" : "Filipino"}</span>
                </p>
                <StatusChip tone={STATUS[v.status].tone}>{STATUS[v.status].label}</StatusChip>
              </div>
              <p className="whitespace-pre-line text-sm">{v.body}</p>
              <p className="text-sm text-ink-soft">
                Source: {v.source} · written by {v.authoredBy ?? "staff"}
                {v.reviewedBy ? ` · reviewed by ${v.reviewedBy}${v.reviewedOn ? ` on ${formatDate(v.reviewedOn)}` : ""}` : ""}
                {v.reviewNote ? ` · ${v.reviewNote}` : ""}
              </p>
              <div className="flex flex-wrap items-start gap-3">
                {v.status === "draft" && mine && canWrite ? <Act label="Submit for review" variant="primary" path={`${base}/${v.versionId}/submit`} /> : null}
                {v.status === "submitted" && canReview && !mine ? (
                  <>
                    <WithReason label="Approve and publish" variant="primary" path={`${base}/${v.versionId}/review`} action="approve" fieldLabel="Note (optional)" required={false} />
                    <WithReason label="Reject" variant="danger" path={`${base}/${v.versionId}/review`} action="reject" fieldLabel="Why is it rejected?" />
                  </>
                ) : null}
                {v.status === "submitted" && mine ? <p className="text-sm text-ink-soft">Someone else has to review this.</p> : null}
                {v.status === "active" && canReview ? <WithReason label="Withdraw" variant="danger" path={`${base}/${v.versionId}/retire`} action="retire" fieldLabel="Why is it withdrawn?" /> : null}
              </div>
              {v.status === "draft" && mine && canWrite ? <ContentForm clinicId={clinicId} version={v} /> : null}
            </li>
          );
        })}
      </ul>
      {canWrite ? <NewContent clinicId={clinicId} /> : null}
    </>
  );
}
