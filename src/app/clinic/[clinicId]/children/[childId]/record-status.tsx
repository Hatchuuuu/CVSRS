"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { useConfirmStep } from "@/components/confirm-step";
import { useMutation } from "@/lib/client/api";

const REASONS = [
  { value: "moved", label: "The family moved away" },
  { value: "deceased", label: "The child has died" },
  { value: "other", label: "Another reason" },
] as const;
type Reason = (typeof REASONS)[number]["value"];

/**
 * A clinical lead marks a record inactive when the child no longer comes to this clinic. Inactive records keep their history,
 * leave follow-up lists, get no booking and no message to the family, and any future booking is cancelled quietly.
 */
export function RecordStatus({ clinicId, childId, childName, recordStatus }: { clinicId: string; childId: string; childName: string; recordStatus: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}/record-status`);
  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const pending = state.phase === "pending";
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(confirming, pending);
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};

  const failure = (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
    </ResultRegion>
  );

  if (recordStatus === "inactive") {
    return (
      <div className="space-y-3">
        <p className="text-sm">This record is inactive. Its history stays readable; the family gets no messages and it cannot be booked.</p>
        {failure}
        {confirming ? (
          <div {...groupProps} aria-label="Confirm making the record active" className="flex flex-wrap items-center gap-3">
            <p {...textProps} className="w-full text-sm">The record returns to follow-up lists and can be booked again.</p>
            <Button pending={pending} onClick={async () => { const r = await run({ status: "active" }); if (r?.ok) { setConfirming(false); router.refresh(); } }}>Yes, make it active</Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)} {...cancelProps}>Keep it inactive</Button>
          </div>
        ) : (
          <Button ref={triggerRef} variant="secondary" onClick={() => setConfirming(true)}>Make the record active again…</Button>
        )}
      </div>
    );
  }
  if (recordStatus !== "active") return null;

  return (
    <details className="rounded-control border border-line bg-surface">
      <summary className="flex min-h-11 cursor-pointer items-center px-4 font-semibold">Mark this record inactive</summary>
      <div className="space-y-3 border-t border-line p-4">
        <fieldset>
          <legend className="mb-1.5 text-sm font-bold">Why is {childName} no longer seen here?</legend>
          {REASONS.map((r) => (
            <label key={r.value} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="radio" name={`inactive-${childId}`} value={r.value} checked={reason === r.value} onChange={() => { setReason(r.value); setConfirming(false); }} className="size-5" />
              {r.label}
            </label>
          ))}
        </fieldset>
        <TextField id={`inactive-note-${childId}`} label={reason === "other" ? "Reason" : "Note (optional)"} value={note} onChange={(e) => { setNote(e.target.value); setConfirming(false); }} maxLength={300} required={reason === "other"} error={fe.note} />
        {reason === "deceased" ? <p className="text-sm text-ink-soft">No message is sent to the family about this change, and future bookings are cancelled without notice.</p> : null}
        {failure}
        {confirming ? (
          <div {...groupProps} aria-label="Confirm marking the record inactive" className="flex flex-wrap items-center gap-3">
            <p {...textProps} className="w-full text-sm">{childName}&apos;s record leaves follow-up lists and reminders, and upcoming bookings are cancelled. You can make it active again later.</p>
            <Button variant="danger" pending={pending} onClick={async () => {
              const r = await run({ status: "inactive", reason: reason!, note: note.trim() || undefined });
              if (r?.ok) { setConfirming(false); router.refresh(); }
            }}>Yes, mark it inactive</Button>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)} {...cancelProps}>Keep it active</Button>
          </div>
        ) : (
          <Button ref={triggerRef} variant="danger" disabled={!reason || (reason === "other" && note.trim().length < 3)} onClick={() => setConfirming(true)}>
            Mark inactive…
          </Button>
        )}
      </div>
    </details>
  );
}
