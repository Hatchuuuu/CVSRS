import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageTitle, Section, StatusChip } from "@/components/ui";
import { formatClinicDateTime } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { AnswerForm, PolicyForm } from "./forms";

export const metadata: Metadata = { title: "Questions and plans" };

interface Checkin {
  id: string;
  childId: string;
  childName: string;
  recordNo: string;
  category: "question" | "after_vaccination" | "other";
  message: string;
  createdAt: string;
}
interface Review {
  planId: string;
  childId: string;
  childName: string;
  recordNo: string;
  authoredBy: string | null;
  itemCount: number;
  submittedAt: string;
}
interface Policy {
  enabled: boolean;
  safetyNotice: string;
}

const CATEGORY = { question: "Question", after_vaccination: "After a vaccination", other: "Other" } as const;
export default async function Questions({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const when = (iso: string) => formatClinicDateTime(iso, membership.clinicTimezone);
  const caps = new Set(membership.capabilities);
  const canAnswer = caps.has("child.read_clinical");
  const canReview = caps.has("rules.approve");
  const canPolicy = caps.has("grant.approve.clinical");
  if (!canAnswer && !canReview && !canPolicy) notFound();
  const [policy, checkins, reviews] = await Promise.all([
    canAnswer || canPolicy ? rpc.rpc<Policy>("get_checkin_policy", { p_clinic_id: clinicId }) : Promise.resolve(null),
    canAnswer ? rpc.rpc<Checkin[]>("list_checkins", { p_clinic_id: clinicId, p_status: "open" }) : Promise.resolve(null),
    canReview ? rpc.rpc<Review[]>("list_catchup_reviews", { p_clinic_id: clinicId }) : Promise.resolve(null),
  ]);

  return (
    <>
      <PageTitle title="Questions and plans" lead="Families' questions wait here for a person. Nothing is answered or ranked by software." />

      {canReview ? (
        <Section id="pr-h" title="Catch-up plans waiting for review" className="border-t-0 pt-0" description="A plan must be approved by someone other than its author.">
          {!reviews || reviews.length === 0 ? (
            <EmptyState title="No plans waiting" />
          ) : (
            <ul className="divide-y divide-line rounded-control border border-line bg-surface">
              {reviews.map((r) => (
                <li key={r.planId} className="flex flex-wrap items-center justify-between gap-2 p-4">
                  <span>
                    <span className="block font-bold">
                      {r.childName} <span className="tnum font-normal text-ink-soft">· {r.recordNo}</span>
                    </span>
                    <span className="text-sm text-ink-soft">
                      {r.itemCount} item{r.itemCount === 1 ? "" : "s"} · written by {r.authoredBy ?? "staff"} · {when(r.submittedAt)}
                    </span>
                  </span>
                  <Link href={`/clinic/${clinicId}/children/${r.childId}#cu-h`} className="inline-flex min-h-11 items-center font-semibold text-primary">
                    Open the plan
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canAnswer ? (
        <Section id="ck-h" title="Questions from families" className={canReview ? "" : "border-t-0 pt-0"} description="Questions about a child's health after a vaccination are shown first. Read them all.">
          {policy && !policy.enabled ? (
            <Notice tone="attention" title="Family questions are switched off">
              Families cannot send questions until a clinical lead records the safety notice and turns this on.
            </Notice>
          ) : null}
          {!checkins || checkins.length === 0 ? (
            <EmptyState title="No open questions" />
          ) : (
            <ul className="divide-y divide-line rounded-control border border-line bg-surface">
              {checkins.map((k) => (
                <li key={k.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-bold">
                      <Link href={`/clinic/${clinicId}/children/${k.childId}`} className="text-primary">
                        {k.childName}
                      </Link>{" "}
                      <span className="tnum font-normal text-ink-soft">· {k.recordNo}</span>
                    </p>
                    {k.category === "after_vaccination" ? <StatusChip tone="danger">After a vaccination</StatusChip> : <StatusChip tone="neutral">{CATEGORY[k.category]}</StatusChip>}
                  </div>
                  <p className="text-sm text-ink-soft">{when(k.createdAt)}</p>
                  <p>{k.message}</p>
                  <AnswerForm clinicId={clinicId} checkinId={k.id} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {canPolicy && policy ? (
        <Section id="pol-h" title="Family questions: on or off" description="There is no default wording. The safety notice you write is shown to every family before they send a question.">
          <PolicyForm clinicId={clinicId} policy={policy} />
        </Section>
      ) : null}
    </>
  );
}
