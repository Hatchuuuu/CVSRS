"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmStep } from "@/components/confirm-step";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok: string }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not done"}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" ? <Notice tone="success" role="status" title={ok} /> : null}
    </ResultRegion>
  );
}

export function ScheduleActions({ clinicId, versionId, status, canPropose, canApprove, isProposer }: { clinicId: string; versionId: string; status: string; canPropose: boolean; canApprove: boolean; isProposer: boolean }) {
  const router = useRouter();
  const base = `/api/v1/clinics/${clinicId}/schedules/${versionId}`;
  const submit = useMutation(`${base}/submit`);
  const approve = useMutation(`${base}/approve`);
  const activate = useMutation(`${base}/activate`);
  const retire = useMutation(`${base}/retire`);
  const discard = useMutation(`${base}/discard`);
  const sendBack = useMutation(`${base}/return`);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Retiring is immediate and cannot be undone, so the typed reason is held until the lead confirms.
  const [retireReason, setRetireReason] = useState<string | null>(null);
  const { triggerRef: retireTriggerRef, groupProps: retireGroupProps, textProps: retireTextProps, cancelProps: retireCancelProps } = useConfirmStep(retireReason !== null, retire.state.phase === "pending");

  // A reviewer sends the schedule back with a reason; the person who submitted it can withdraw it the same way.
  const canSendBack = status === "clinical_review" && (isProposer || canApprove);
  async function onSendBack(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await sendBack.run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
    if (r?.ok) router.refresh();
  }

  async function onActivate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await activate.run({ effectiveFrom: String(new FormData(e.currentTarget).get("effectiveFrom") ?? "") });
    if (r?.ok) router.refresh();
  }
  function onRetire(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setRetireReason(String(new FormData(e.currentTarget).get("reason") ?? "").trim());
  }
  async function confirmRetire(reason: string) {
    const r = await retire.run({ reason });
    if (r?.ok) {
      setRetireReason(null);
      router.refresh();
    }
  }

  return (
    <div className="space-y-4">
      {status === "draft" && canPropose ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-3">
            <Button
              pending={submit.state.phase === "pending"}
              disabled={discard.state.phase === "pending"}
              onClick={async () => {
                const r = await submit.run();
                if (r?.ok) router.refresh();
              }}
            >
              Submit for clinical review
            </Button>
            <Button variant="danger" disabled={discard.state.phase === "pending" || submit.state.phase === "pending"} onClick={() => setConfirmDiscard((c) => !c)} aria-expanded={confirmDiscard}>
              Discard draft
            </Button>
          </div>
          {confirmDiscard ? (
            <div className="rounded-control border border-danger bg-danger-bg p-3">
              <p className="mb-3 text-sm font-semibold text-danger">Discard this draft schedule? Its imported rules and test cases cannot be recovered.</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="danger"
                  pending={discard.state.phase === "pending"}
                  onClick={async () => {
                    const r = await discard.run();
                    if (r?.ok) router.push(`/clinic/${clinicId}/clinical`);
                  }}
                >
                  Yes, discard draft
                </Button>
                <Button variant="secondary" disabled={discard.state.phase === "pending"} onClick={() => setConfirmDiscard(false)}>
                  Keep draft
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {status === "clinical_review" && canApprove ? (
        isProposer ? (
          <Notice tone="info">You prepared this schedule, so a different clinical lead must approve it.</Notice>
        ) : (
          <Button
            pending={approve.state.phase === "pending"}
            onClick={async () => {
              const r = await approve.run({});
              if (r?.ok) router.refresh();
            }}
          >
            Approve this schedule
          </Button>
        )
      ) : null}
      {canSendBack ? (
        <form onSubmit={onSendBack} className="border-t border-line pt-4">
          <TextField
            id="sendback"
            name="reason"
            label={isProposer ? "Why are you withdrawing it? (recorded in the audit trail)" : "What needs to change? (recorded in the audit trail)"}
            hint="The schedule returns to draft. Import a corrected file as a new draft, or submit this one again."
            required
            minLength={3}
            maxLength={500}
          />
          <Button type="submit" variant="secondary" pending={sendBack.state.phase === "pending"}>
            {isProposer ? "Withdraw from review" : "Send back to draft"}
          </Button>
        </form>
      ) : null}
      {status === "approved" && canApprove ? (
        <form onSubmit={onActivate}>
          <TextField id="eff" name="effectiveFrom" type="date" label="Takes effect on (today or later)" required />
          <Button type="submit" pending={activate.state.phase === "pending"}>
            Activate schedule
          </Button>
        </form>
      ) : null}
      {(status === "active" || status === "approved") && canApprove ? (
        <form onSubmit={onRetire} onChange={() => setRetireReason(null)} className="border-t border-line pt-4">
          <TextField id="ret" name="reason" label="Reason for retiring (recorded in the audit trail)" required minLength={3} />
          {retireReason !== null ? (
            <div {...retireGroupProps} className="rounded-control border border-danger bg-danger-bg p-3" aria-label="Confirm retirement">
              <p {...retireTextProps} className="mb-3 text-sm font-semibold text-danger">
                {status === "active"
                  ? "Retire the active schedule now? It stops being used from today: due dates, the follow-up list and catch-up checks have no approved schedule here until another one is activated. A retired schedule cannot be activated again."
                  : "Retire this approved schedule? It cannot be activated again."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" pending={retire.state.phase === "pending"} onClick={() => confirmRetire(retireReason)}>
                  Yes, retire schedule
                </Button>
                <Button {...retireCancelProps} variant="secondary" disabled={retire.state.phase === "pending"} onClick={() => setRetireReason(null)}>
                  Keep schedule
                </Button>
              </div>
            </div>
          ) : (
            <Button ref={retireTriggerRef} type="submit" variant="danger" pending={retire.state.phase === "pending"}>
              Retire schedule now
            </Button>
          )}
        </form>
      ) : null}
      {status === "draft" && !canPropose ? <p className="text-ink-soft">Only staff who prepare schedules can submit this draft.</p> : null}
      <Outcome state={submit.state} ok="Submitted for review" />
      <Outcome state={approve.state} ok="Approved" />
      <Outcome state={activate.state} ok="Activated" />
      <Outcome state={retire.state} ok="Retired" />
      <Outcome state={discard.state} ok="Discarded" />
      <Outcome state={sendBack.state} ok="Returned to draft" />
    </div>
  );
}
