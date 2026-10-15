"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { announceOutcome, OutcomeNoticeView } from "@/components/outcome-notice";
import { Button, EmptyState, Notice, ResultRegion, StatusChip, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { formatClinicDate, formatDate } from "@/lib/format";

export interface Hold {
  id: string;
  status: "active" | "resolved";
  reason: string;
  note: string | null;
  reviewOn: string | null;
  startsAt: string;
  ruleRequirement: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  placedBy: string | null;
}

const noticeKey = (childId: string) => `holds:${childId}`;

function Release({ clinicId, childId, holdId }: { clinicId: string; childId: string; holdId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/holds/${holdId}/release`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run({ note: String(new FormData(e.currentTarget).get("note") ?? "").trim() });
    if (r?.ok) {
      // Announced beside the list: this control disappears once the hold is released.
      announceOutcome(noticeKey(childId), { title: "Hold released", message: "This hold no longer blocks recording a vaccine." });
      router.refresh();
    }
  }
  return (
    <div className="mt-2">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Release hold
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
          <TextField id={`rl-${holdId}`} name="note" label="Why is it safe to release?" required minLength={3} maxLength={500} />
          <Button type="submit" disabled={state.phase === "pending"}>
            Confirm release
          </Button>
          <ResultRegion>
            {state.phase === "error" ? (
              <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not released"}>
                {state.error.message}
              </Notice>
            ) : null}
          </ResultRegion>
        </form>
      ) : null}
    </div>
  );
}

export function HoldsPanel({ clinicId, clinicTimezone, childId, holds, canPlace, canRelease }: { clinicId: string; clinicTimezone: string; childId: string; holds: Hold[]; canPlace: boolean; canRelease: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}/holds`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const note = String(f.get("note") ?? "").trim();
    const on = String(f.get("reviewOn") ?? "");
    const r = await run({ reason: String(f.get("reason") ?? "").trim(), restrictedNote: note || undefined, reviewOn: on || undefined });
    if (r?.ok) {
      setOpen(false);
      announceOutcome(noticeKey(childId), { title: "Hold placed", message: "Recording a vaccine is blocked until a clinical lead releases it." });
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  const active = holds.filter((h) => h.status === "active");
  return (
    <div className="space-y-4">
      <OutcomeNoticeView noticeKey={noticeKey(childId)} />
      {active.length > 0 ? (
        <Notice tone="attention" title="A clinical hold is active">
          Every schedule item shows “staff review needed” and recording a vaccine is blocked until the hold is released.
        </Notice>
      ) : null}
      {holds.length === 0 ? (
        <EmptyState title="No holds">Use a hold when a clinician decides vaccination must wait for a review.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface">
          {holds.map((h) => (
            <li key={h.id} className="space-y-1 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">{h.reason}</p>
                {h.status === "active" ? <StatusChip tone="attention">Active</StatusChip> : <StatusChip tone="neutral">Released</StatusChip>}
              </div>
              <p className="text-sm text-ink-soft">
                Placed {formatClinicDate(h.startsAt, clinicTimezone)}
                {h.placedBy ? ` by ${h.placedBy}` : ""}
                {h.reviewOn ? ` · review by ${formatDate(h.reviewOn)}` : ""}
                {h.ruleRequirement ? ` · applies to ${h.ruleRequirement}` : " · applies to everything"}
              </p>
              {h.note ? <p className="text-sm">Restricted note (clinical staff only): {h.note}</p> : null}
              {h.status === "resolved" ? <p className="text-sm text-ink-soft">Released: {h.resolutionNote}</p> : null}
              {h.status === "active" && canRelease ? <Release clinicId={clinicId} childId={childId} holdId={h.id} /> : null}
              {h.status === "active" && !canRelease ? <p className="text-sm text-ink-soft">Only a clinical lead can release a hold.</p> : null}
            </li>
          ))}
        </ul>
      )}
      {canPlace ? (
        <div>
          <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Place a hold
          </Button>
          {open ? (
            <form onSubmit={submit} className="mt-3 max-w-xl rounded-control border border-line bg-canvas p-4">
              <TextField id="hold-reason" name="reason" label="Reason" hint="Short, for staff. Families are not shown this text." required minLength={3} maxLength={80} error={fe?.reason} />
              <TextField id="hold-note" name="note" label="Restricted note (optional)" hint="Visible to clinical staff only." maxLength={500} />
              <TextField id="hold-review" name="reviewOn" type="date" label="Review by (optional)" error={fe?.reviewOn} />
              <Button type="submit" disabled={state.phase === "pending"}>
                Place hold
              </Button>
              <ResultRegion>
                {state.phase === "error" ? (
                  <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
                    {state.error.message}
                  </Notice>
                ) : null}
              </ResultRegion>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
