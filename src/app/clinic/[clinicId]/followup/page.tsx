import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, Notice, PageTitle, StatusChip } from "@/components/ui";
import { formatClinicDateTime, formatDate } from "@/lib/format";
import { requireClinicStaff } from "@/lib/server/viewer";
import { followupCursor, pageCursor, pageQuery } from "@/lib/api/list-cursors";
import { OutcomeNoticeView } from "@/components/outcome-notice";
import { AttemptForm, RefreshButton } from "./forms";
import { childRecordHref } from "./record-link";

export const metadata: Metadata = { title: "Follow-up list" };

interface Item {
  childId: string;
  childName: string;
  recordNo: string;
  dob: string | null;
  behind: number;
  due: number;
  review: number;
  needs: { requirement: string; status: string }[];
  computedAt: string;
  attempts: number;
  lastAttempt: { outcome: string; at: string; note: string | null; nextTryOn: string | null } | null;
  guardian: { name: string; phone: string | null; phoneChecked: boolean } | null;
}
interface Worklist {
  asOf: string;
  schedule: "active" | "none" | "unknown";
  staleChildren: number;
  items: Item[];
}

const FILTERS = [
  ["behind", "Behind schedule"],
  ["due", "Due now"],
  ["review", "Needs staff review"],
  ["all", "All"],
] as const;
const STATUS: Record<string, string> = {
  overdue: "Overdue",
  past_recommended_date: "Past the recommended date",
  due_now: "Due now",
  due_today: "Due today",
  staff_review_needed: "Staff review needed",
};
const OUTCOME: Record<string, string> = { reached: "Spoke to the family", no_answer: "No answer", wrong_number: "Wrong number", will_visit: "Will visit", refused: "Declined", moved_away: "Moved away", other: "Other" };

export default async function Followup({ params, searchParams }: { params: Promise<{ clinicId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { clinicId } = await params;
  const sp = await searchParams;
  const { rpc, membership } = await requireClinicStaff(clinicId);
  const caps = new Set(membership.capabilities);
  if (!caps.has("bhw.followup") && !caps.has("child.read_clinical")) notFound();
  const filter = FILTERS.some(([k]) => k === sp.filter) ? sp.filter! : "behind";
  const cursor = pageCursor(() => followupCursor(pageQuery(sp)));
  const w = await rpc.rpc<Worklist>("list_followup_worklist", { p_clinic_id: clinicId, p_filter: filter, p_limit: 51,
    p_after_behind: cursor?.behind ?? null, p_after_due: cursor?.due ?? null, p_after_name: cursor?.name ?? null, p_after_id: cursor?.id ?? null });
  if (!w) notFound();
  const items = w.items.slice(0, 50);
  const last = items.at(-1);

  return (
    <>
      <PageTitle title="Follow-up list" lead="Children who are behind or due according to your clinic's approved schedule. Only what the schedule says: the system adds nothing of its own." />
      <OutcomeNoticeView noticeKey={`followup:${clinicId}`} />
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <nav aria-label="Filter" className="flex flex-wrap gap-2">
          {FILTERS.map(([k, label]) => (
            <Link key={k} href={`/clinic/${clinicId}/followup?filter=${k}`} aria-current={k === filter ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-control border px-4 font-semibold no-underline ${k === filter ? "border-primary/30 bg-primary-soft text-primary-strong" : "border-line-strong bg-surface text-ink hover:bg-sunken"}`}>
              {label}
            </Link>
          ))}
        </nav>
        <RefreshButton clinicId={clinicId} stale={w.staleChildren} />
      </div>
      <p className="mb-4 text-sm text-ink-soft">
        Worked out {formatClinicDateTime(w.asOf, membership.clinicTimezone)}. A child&apos;s result is refreshed after new vaccinations or holds, and at least daily.
      </p>

      {w.schedule === "none" ? (
        <Notice tone="attention" title="No approved schedule is active">
          The list needs your clinic&apos;s approved schedule. Ask the clinical lead to activate one (Clinical setup).
        </Notice>
      ) : w.schedule === "unknown" ? (
        <Notice tone="info" title="Nobody has been checked yet">
          Press &ldquo;Update the list&rdquo; to check the children enrolled here.
        </Notice>
      ) : null}

      {w.items.length === 0 && w.schedule === "active" ? (
        <EmptyState title="Nobody needs follow-up in this view">Children you tried recently and set to try again later are hidden until that date.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface">
          {items.map((i) => {
            const href = childRecordHref(clinicId, i.childId, caps);
            return (
            <li key={i.childId} className="space-y-2 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="font-bold">
                  {href ? (
                    <Link href={href} className="text-primary">
                      {i.childName}
                    </Link>
                  ) : (
                    i.childName
                  )}{" "}
                  <span className="tnum font-normal text-ink-soft">
                    · {i.recordNo}
                    {i.dob ? ` · born ${formatDate(i.dob)}` : ""}
                  </span>
                </p>
                <span className="flex flex-wrap gap-2">
                  {i.behind > 0 ? <StatusChip tone="danger">{i.behind} behind</StatusChip> : null}
                  {i.due > 0 ? <StatusChip tone="attention">{i.due} due</StatusChip> : null}
                  {i.review > 0 ? <StatusChip tone="review">{i.review} to review</StatusChip> : null}
                </span>
              </div>
              <ul className="text-sm text-ink-soft">
                {i.needs.map((n) => (
                  <li key={n.requirement}>
                    {n.requirement}: {STATUS[n.status] ?? n.status}
                  </li>
                ))}
              </ul>
              {i.guardian ? (
                <p className="text-sm">
                  Guardian: <span className="font-semibold">{i.guardian.name}</span>
                  {i.guardian.phone ? (
                    <>
                      {" · "}
                      <span className="tnum">{i.guardian.phone}</span> {i.guardian.phoneChecked ? "(checked in person)" : "(not checked)"}
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="text-sm text-ink-soft">No verified guardian is linked.</p>
              )}
              {i.lastAttempt ? (
                <p className="text-sm text-ink-soft">
                  Last contact: {OUTCOME[i.lastAttempt.outcome] ?? i.lastAttempt.outcome}, {formatClinicDateTime(i.lastAttempt.at, membership.clinicTimezone)}
                  {i.lastAttempt.note ? ` — ${i.lastAttempt.note}` : ""} ({i.attempts} attempt{i.attempts === 1 ? "" : "s"})
                </p>
              ) : null}
              <AttemptForm clinicId={clinicId} childId={i.childId} childName={i.childName} />
            </li>
            );
          })}
        </ul>
      )}
      {cursor || w.items.length > 50 ? (
        <nav aria-label="Follow-up pages" className="mt-4 flex flex-wrap gap-4">
          {cursor ? <Link href={`/clinic/${clinicId}/followup?${new URLSearchParams({ filter: String(filter) })}`} className="inline-flex min-h-11 items-center font-semibold text-primary">First children</Link> : null}
          {w.items.length > 50 && last ? <Link href={`/clinic/${clinicId}/followup?${new URLSearchParams({ filter: String(filter), after: JSON.stringify({ behind: last.behind, due: last.due, name: last.childName, id: last.childId }) })}`} className="inline-flex min-h-11 items-center font-semibold text-primary">More children</Link> : null}
        </nav>
      ) : null}
    </>
  );
}
