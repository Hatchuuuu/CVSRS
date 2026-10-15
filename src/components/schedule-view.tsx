import { StatusChip } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { Calendar, CheckCircle2, Info, ShieldAlert } from "lucide-react";

export interface ScheduleRequirement {
  requirement: string;
  status: string;
  antigen?: string;
  targetOn?: string | null;
  recommendedOn?: string | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  earliestEligibleOn?: string | null;
  creditedOn?: string | null;
  reasons?: { code: string; on?: string; doses?: { reason: string }[] }[];
}

const STATUS: Record<string, { tone: "success" | "attention" | "danger" | "review" | "info" | "neutral"; label: string }> = {
  completed: { tone: "success", label: "Completed" },
  not_yet_eligible: { tone: "neutral", label: "Not yet eligible" },
  upcoming: { tone: "info", label: "Upcoming" },
  due_today: { tone: "attention", label: "Due today" },
  due_now: { tone: "attention", label: "Due now" },
  overdue: { tone: "danger", label: "Overdue — contact the clinic" },
  past_recommended_date: { tone: "attention", label: "Past the recommended date" },
  staff_review_needed: { tone: "review", label: "Clinic review needed" },
  not_applicable: { tone: "neutral", label: "Not applicable" },
};

const REASON_TEXT: Record<string, string> = {
  credited_by_verified_dose: "Counted from a verified dose.",
  birth_date_not_exact: "The exact date of birth is not confirmed, so the clinic must review this.",
  clinical_hold: "A clinician has paused this item for review.",
  dose_outside_rule_limits: "A dose was recorded outside the approved limits and was not counted.",
  unresolved_history: "Some recorded history has an unclear date, so the clinic must review it.",
  rule_requires_review: "The approved schedule asks for clinician review of this item.",
  beyond_maximum_age: "This item is past the approved age limit.",
  predecessor_pending: "An earlier step must be completed first.",
  before_earliest_eligible: "Too early. The earliest eligible date is shown.",
  after_due_window: "The approved due period has ended.",
  target_date_is_today: "The recommended date is today.",
  within_due_window: "Inside the approved due period.",
  window_open: "The due period has started.",
  past_target_without_overdue_threshold: "The recommended date has passed. Please review with the clinic.",
  eligible_no_timing_guidance: "Eligible now; no specific timing rule.",
  target_in_future: "The recommended date is in the future.",
};

/**
 * Family wording for why an item is "Not yet eligible". These restate the engine's own reason codes
 * (0025_scheduling_integrity.sql: before_earliest_eligible, predecessor_pending); they add no clinical rule.
 */
const FAMILY_NOT_YET_TEXT: Record<string, (on?: string | null) => string> = {
  before_earliest_eligible: (on) => (on ? `Too early for this dose. It can be given from ${formatDate(on)}.` : "Too early for this dose."),
  predecessor_pending: () => "An earlier dose in this series needs to be given first.",
};

/** "20 Sep 2026 to 10 Oct 2026", "From 21 Oct 2026 (open-ended)", or "Until 10 Oct 2026". */
function windowText(start?: string | null, end?: string | null): string {
  if (start && end) return `${formatDate(start)} to ${formatDate(end)}`;
  if (start) return `From ${formatDate(start)} (open-ended)`;
  return `Until ${formatDate(end)}`;
}

export function ScheduleView({ requirements, showInternals = false }: { requirements: ScheduleRequirement[]; showInternals?: boolean }) {
  return (
    <div role="list" className="space-y-3" aria-label="Vaccination schedule">
      {requirements.map((r) => {
        const s = STATUS[r.status] ?? { tone: "neutral" as const, label: r.status };
        const first = r.reasons?.[0];
        const isDone = r.status === "completed";
        const notYet = r.status === "not_yet_eligible";
        const earliest = r.earliestEligibleOn ?? (first?.code === "before_earliest_eligible" ? first.on : null);
        const familyReason = !showInternals && notYet
          ? (first && FAMILY_NOT_YET_TEXT[first.code]?.(earliest)) ?? "Not due yet. The clinic can tell you when."
          : null;
        return (
          <div
            role="listitem"
            key={r.requirement}
            className={`rounded-card border p-4 sm:p-5 ${
              isDone
                ? "border-success/40 bg-success-bg/60"
                : r.status === "overdue"
                ? "border-danger bg-danger-bg/70 shadow-xs"
                : r.status.includes("due")
                ? "border-attention/60 bg-attention-bg/70 shadow-xs"
                : "border-line bg-surface"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-extrabold text-ink text-base flex items-center gap-2">
                  {isDone ? <CheckCircle2 className="size-4 text-success shrink-0" /> : <Calendar className="size-4 text-ink-soft shrink-0" />}
                  {r.requirement}
                </h3>
                {showInternals && r.antigen ? <p className="mt-0.5 text-xs text-ink-soft">Antigen: {r.antigen}</p> : null}
              </div>
              <StatusChip tone={s.tone}>{s.label}</StatusChip>
            </div>

            <dl className="mt-3.5 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
              {isDone ? (
                <div className="flex flex-wrap items-baseline gap-x-1.5 text-success">
                  <dt className="text-ink-soft">Administered on:</dt>
                  <dd className="font-bold text-ink">{formatDate(r.creditedOn)}</dd>
                </div>
              ) : (
                <>
                  {showInternals && r.earliestEligibleOn ? (
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                      <dt className="text-ink-soft">Earliest eligible:</dt>
                      <dd className="font-semibold">{formatDate(r.earliestEligibleOn)}</dd>
                    </div>
                  ) : null}
                  {!showInternals && notYet && earliest ? (
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                      <dt className="text-ink-soft">Earliest date:</dt>
                      <dd className="font-bold text-ink">{formatDate(earliest)}</dd>
                    </div>
                  ) : null}
                  {r.recommendedOn || r.targetOn ? (
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-ink">
                      <dt className="text-ink-soft">Recommended target:</dt>
                      <dd className="font-bold text-ink">{formatDate(r.recommendedOn ?? r.targetOn)}</dd>
                    </div>
                  ) : null}
                  {r.windowStart || r.windowEnd ? (
                    <div className="flex flex-wrap items-baseline gap-x-1.5 text-ink sm:col-span-2">
                      <dt className="text-ink-soft">Due window:</dt>
                      <dd className="font-semibold text-ink">{windowText(r.windowStart, r.windowEnd)}</dd>
                    </div>
                  ) : null}
                </>
              )}
            </dl>

            {showInternals && first ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-ink-soft">
                <Info className="size-3.5 text-ink-soft shrink-0" />
                <span>{REASON_TEXT[first.code] ?? first.code}{first.on ? ` (${formatDate(first.on)})` : ""}</span>
              </p>
            ) : null}
            {familyReason ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-sm text-ink">
                <Info aria-hidden className="size-4 shrink-0 text-ink-soft" />
                <span>{familyReason}</span>
              </p>
            ) : null}
            {!showInternals && r.status === "staff_review_needed" ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs text-review">
                <ShieldAlert className="size-3.5 text-review shrink-0" />
                <span>Clinic staff will verify this record during your next visit.</span>
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
