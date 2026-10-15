"use client";
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { Button, EmptyState, Notice, ResultRegion, StatusChip, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

export interface PlanItem {
  id: string;
  seq: number;
  label: string;
  productId: string | null;
  targetDate: string | null;
  note: string | null;
  status: "planned" | "done" | "dropped";
  statusNote?: string | null;
}
export interface CatchupPlan {
  id: string;
  status: "draft" | "submitted" | "approved" | "rejected" | "superseded" | "cancelled";
  rationale: string;
  policyReference: string;
  authoredBy: string | null;
  authoredById: string;
  reviewedBy: string | null;
  reviewNote: string | null;
  items: PlanItem[];
}

const STATUS: Record<CatchupPlan["status"], { tone: "neutral" | "attention" | "success" | "danger" | "review"; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  submitted: { tone: "review", label: "Waiting for review" },
  approved: { tone: "success", label: "Approved" },
  rejected: { tone: "danger", label: "Rejected" },
  superseded: { tone: "neutral", label: "Replaced by a newer plan" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

function Outcome<T>({ state }: { state: MutationState<T> }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
    </ResultRegion>
  );
}

function PlanForm({ clinicId, childId, plan, onDone }: { clinicId: string; childId: string; plan?: CatchupPlan; onDone: () => void }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}/catchup-plans`);
  const [rows, setRows] = useState(plan ? plan.items.map((i) => ({ label: i.label, targetDate: i.targetDate ?? "", note: i.note ?? "" })) : [{ label: "", targetDate: "", note: "" }]);
  const set = (i: number, k: "label" | "targetDate" | "note", v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({
      planId: plan?.id,
      rationale: String(f.get("rationale") ?? "").trim(),
      policyReference: String(f.get("policyReference") ?? "").trim(),
      items: rows.filter((x) => x.label.trim()).map((x) => ({ label: x.label.trim(), targetDate: x.targetDate || undefined, note: x.note.trim() || undefined })),
    });
    if (r?.ok) {
      onDone();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
      <TextField id="cu-why" name="rationale" label="Why this plan is needed" hint="A short clinical reason, in your own words." defaultValue={plan?.rationale} required minLength={10} maxLength={1000} error={fe?.rationale} />
      <TextField id="cu-ref" name="policyReference" label="Policy or advice it follows" hint="The document, version or clinician advice this comes from. Reviewers check the plan against it." defaultValue={plan?.policyReference} required minLength={3} maxLength={300} error={fe?.policyReference} />
      <fieldset className="mb-4">
        <legend className="mb-2 font-semibold">Planned items</legend>
        <p className="mb-2 text-sm text-ink-soft">Write each item exactly as the clinician decided. The system does not suggest vaccines or dates.</p>
        {rows.map((row, i) => (
          <div key={i} className="mb-3 grid gap-x-3 sm:grid-cols-[2fr_1fr_2fr_auto]">
            <TextField id={`cu-l-${i}`} label={`Item ${i + 1}`} value={row.label} onChange={(e) => set(i, "label", e.target.value)} maxLength={200} />
            <TextField id={`cu-d-${i}`} label="Target date (optional)" type="date" value={row.targetDate} onChange={(e) => set(i, "targetDate", e.target.value)} />
            <TextField id={`cu-n-${i}`} label="Note (optional)" value={row.note} onChange={(e) => set(i, "note", e.target.value)} maxLength={300} />
            {rows.length > 1 ? (
              <div className="mb-4 flex items-end">
                <Button variant="quiet" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} aria-label={`Remove item ${i + 1}`}>
                  Remove
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {fe?.items ? <p className="text-sm font-semibold text-danger">{fe.items}</p> : null}
        <Button variant="secondary" onClick={() => setRows((r) => [...r, { label: "", targetDate: "", note: "" }])}>
          Add another item
        </Button>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={state.phase === "pending"}>
          {state.phase === "pending" ? "Saving…" : "Save draft"}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Close
        </Button>
      </div>
      <Outcome state={state} />
    </form>
  );
}

function Simple({ label, path, variant = "secondary", body }: { label: string; path: string; variant?: "primary" | "secondary" | "danger"; body?: unknown }) {
  const router = useRouter();
  const { state, run } = useMutation(path);
  return (
    <div>
      <Button
        variant={variant}
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run(body);
          if (r?.ok) router.refresh();
        }}
      >
        {label}
      </Button>
      <Outcome state={state} />
    </div>
  );
}

function WithNote({ label, path, buildBody, noteLabel, variant = "secondary", required = true }: { label: string; path: string; buildBody: (note: string) => unknown; noteLabel: string; variant?: "primary" | "secondary" | "danger"; required?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const noteId = useId();
  const { state, run } = useMutation(path);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run(buildBody(String(new FormData(e.currentTarget).get("note") ?? "").trim()));
    if (r?.ok) router.refresh();
  }
  return (
    <div>
      <Button variant={variant} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {label}
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-2 rounded-control border border-line bg-canvas p-3">
          <TextField id={noteId} name="note" label={noteLabel} required={required} maxLength={300} />
          <Button type="submit" variant={variant} disabled={state.phase === "pending"}>
            Confirm
          </Button>
          <Outcome state={state} />
        </form>
      ) : null}
    </div>
  );
}

export function CatchupPanel({ clinicId, childId, plans, me, canAuthor, canReview }: { clinicId: string; childId: string; plans: CatchupPlan[]; me: string; canAuthor: boolean; canReview: boolean }) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const base = `/api/v1/clinics/${clinicId}`;
  const inPrep = plans.some((p) => p.status === "draft" || p.status === "submitted");
  const row = (children: ReactNode) => <div className="flex flex-wrap items-start gap-3">{children}</div>;
  return (
    <div className="space-y-4">
      <Notice tone="info" title="Written by people, checked by a second person">
        The system has no catch-up rules and never books or credits anything from a plan. A clinician writes the plan and a different clinical lead approves it. Approved plans are shown to the family in plain words.
      </Notice>
      {plans.length === 0 ? (
        <EmptyState title="No catch-up plan">Only create one when a clinician has decided the child needs it.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface">
          {plans.map((p) => {
            const s = STATUS[p.status];
            const mine = p.authoredById === me;
            return (
              <li key={p.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-ink-soft">
                    Written by {p.authoredBy ?? "staff"}
                    {p.reviewedBy ? ` · reviewed by ${p.reviewedBy}` : ""}
                  </p>
                  <StatusChip tone={s.tone}>{s.label}</StatusChip>
                </div>
                <p>
                  <span className="font-semibold">Why: </span>
                  {p.rationale}
                </p>
                <p className="text-sm text-ink-soft">Follows: {p.policyReference}</p>
                {p.reviewNote ? <p className="text-sm text-ink-soft">Reviewer&apos;s note: {p.reviewNote}</p> : null}
                <ol className="space-y-2">
                  {p.items.map((i) => (
                    <li key={i.id} className="rounded-control border border-line bg-canvas p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">
                          {i.label}
                          {i.targetDate ? <span className="tnum font-normal text-ink-soft"> · around {formatDate(i.targetDate)}</span> : null}
                        </span>
                        {i.status === "done" ? <StatusChip tone="success">Done</StatusChip> : i.status === "dropped" ? <StatusChip tone="neutral">Dropped</StatusChip> : <StatusChip tone="attention">Planned</StatusChip>}
                      </div>
                      {i.note ? <p className="text-sm text-ink-soft">{i.note}</p> : null}
                      {i.statusNote ? <p className="text-sm text-ink-soft">{i.statusNote}</p> : null}
                      {p.status === "approved" && i.status === "planned" && canAuthor
                        ? row(
                            <>
                              <WithNote label="Mark done" path={`${base}/catchup-items/${i.id}/status`} buildBody={(n) => ({ status: "done", note: n })} noteLabel="What was given, and where" />
                              <WithNote label="Drop this item" path={`${base}/catchup-items/${i.id}/status`} buildBody={(n) => ({ status: "dropped", note: n })} noteLabel="Why it is no longer planned" variant="danger" />
                            </>,
                          )
                        : null}
                    </li>
                  ))}
                </ol>
                {p.status === "draft" && mine && canAuthor
                  ? row(
                      <>
                        <Button variant="secondary" onClick={() => setEditing(editing === p.id ? null : p.id)} aria-expanded={editing === p.id}>
                          Edit draft
                        </Button>
                        <Simple label="Submit for review" variant="primary" path={`${base}/catchup-plans/${p.id}/submit`} />
                        <WithNote label="Cancel" path={`${base}/catchup-plans/${p.id}/cancel`} buildBody={(n) => ({ reason: n })} noteLabel="Why" variant="danger" />
                      </>,
                    )
                  : null}
                {p.status === "draft" && editing === p.id ? <PlanForm clinicId={clinicId} childId={childId} plan={p} onDone={() => setEditing(null)} /> : null}
                {p.status === "submitted" && canReview && !mine
                  ? row(
                      <>
                        <WithNote label="Approve" variant="primary" path={`${base}/catchup-plans/${p.id}/review`} buildBody={(n) => ({ decision: "approve", note: n || undefined })} noteLabel="Note (optional)" required={false} />
                        <WithNote label="Reject" variant="danger" path={`${base}/catchup-plans/${p.id}/review`} buildBody={(n) => ({ decision: "reject", note: n })} noteLabel="Why is it rejected?" />
                      </>,
                    )
                  : null}
                {p.status === "submitted" && mine ? <p className="text-sm text-ink-soft">A different clinical lead has to review this plan.</p> : null}
                {(p.status === "submitted" && (mine || canReview)) || (p.status === "approved" && (mine || canReview))
                  ? row(<WithNote label="Withdraw plan" path={`${base}/catchup-plans/${p.id}/cancel`} buildBody={(n) => ({ reason: n })} noteLabel="Why" variant="danger" />)
                  : null}
              </li>
            );
          })}
        </ul>
      )}
      {canAuthor && !inPrep ? (
        editing === "new" ? (
          <PlanForm clinicId={clinicId} childId={childId} onDone={() => setEditing(null)} />
        ) : (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            Start a catch-up plan
          </Button>
        )
      ) : null}
    </div>
  );
}
