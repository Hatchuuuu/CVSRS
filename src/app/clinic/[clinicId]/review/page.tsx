import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/ui";
import { pageCursor, pageQuery, timestampCursor } from "@/lib/api/list-cursors";
import { requireClinicStaff } from "@/lib/server/viewer";
import { CaseCard, REVIEW_NOTICE_KEY, type ReviewCase } from "./cases";
import { OutcomeNoticeView } from "@/components/outcome-notice";

export const metadata: Metadata = { title: "Review queue" };

export default async function ReviewQueue({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { clinicId } = await params;
  const query = pageQuery(searchParams ? await searchParams : {});
  const cursor = pageCursor(() => timestampCursor(query, "after"));
  const { rpc, membership, ctx } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  if (!caps.has("guardian.verify") && !caps.has("review.resolve") && !caps.has("correction.approve") && !caps.has("inventory.approve")) notFound();
  const rows = await rpc.rpc<ReviewCase[]>("list_review_cases", { p_clinic_id: clinicId, p_status: "open", p_limit: 51, p_after: cursor?.at ?? null, p_after_id: cursor?.id ?? null });
  if (!rows) throw new Error("Review cases could not be loaded.");
  const cases = rows.slice(0, 50);
  const last = cases.at(-1);
  return (
    <>
      <PageTitle title="Review queue" lead="Guardian link requests, possible duplicate records, edit requests, stock checks and bookings to follow up. Nothing here changes a record until you decide." />
      <OutcomeNoticeView noticeKey={REVIEW_NOTICE_KEY} />
      {cases.length === 0 ? (
        <EmptyState title="All caught up">There is nothing waiting for review.</EmptyState>
      ) : (
        <ul className="space-y-4">
          {cases.map((c, i) => (
            <li key={c.caseId}>
              <CaseCard clinicId={clinicId} c={c} canVerify={caps.has("guardian.verify")} canResolve={caps.has("review.resolve")} canEdit={caps.has("child.register")} canApproveStock={caps.has("inventory.approve")} canApproveCorrection={caps.has("correction.approve")} myId={ctx.profileId} position={{ n: i + 1, of: cases.length }} />
            </li>
          ))}
        </ul>
      )}
      {cursor || rows.length > 50 ? (
        <nav aria-label="Review pages" className="mt-4 flex flex-wrap gap-4">
          {cursor ? <Link href={`/clinic/${clinicId}/review`} className="inline-flex min-h-11 items-center font-semibold text-primary">Oldest cases</Link> : null}
          {rows.length > 50 && last ? <Link href={`/clinic/${clinicId}/review?${new URLSearchParams({ after: last.createdAt, afterId: last.caseId })}`} className="inline-flex min-h-11 items-center font-semibold text-primary">More cases</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
