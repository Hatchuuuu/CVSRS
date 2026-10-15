"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmStep } from "@/components/confirm-step";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

function Result({ state }: { state: ReturnType<typeof useMutation>["state"] }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not done"}>
          {state.error.message}
        </Notice>
      ) : null}
    </ResultRegion>
  );
}

/** `confirm`: the consequence to restate before running (inline second step, never window.confirm). */
export function TransferButton({ label, path, variant = "primary", confirm }: { label: string; path: string; variant?: "primary" | "secondary"; confirm?: { text: string; yes: string; no: string } }) {
  const router = useRouter();
  const { state, run } = useMutation(path);
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(Boolean(confirm) && confirming, state.phase === "pending");
  async function go() {
    const r = await run();
    if (r?.ok) {
      setConfirming(false);
      router.refresh();
    }
  }
  return (
    <div>
      {confirm && confirming ? (
        <div {...groupProps} className="rounded-control border border-attention bg-attention-bg p-3" aria-label={label}>
          <p {...textProps} className="mb-3 text-sm font-semibold text-attention">{confirm.text}</p>
          <div className="flex flex-wrap gap-2">
            <Button pending={state.phase === "pending"} onClick={go}>
              {confirm.yes}
            </Button>
            <Button {...cancelProps} variant="secondary" disabled={state.phase === "pending"} onClick={() => setConfirming(false)}>
              {confirm.no}
            </Button>
          </div>
        </div>
      ) : (
        <Button ref={triggerRef} variant={variant} disabled={state.phase === "pending"} onClick={confirm ? () => setConfirming(true) : go}>
          {state.phase === "pending" ? "Working…" : label}
        </Button>
      )}
      <Result state={state} />
    </div>
  );
}

export function DeclineTransfer({ path }: { path: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(path);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
    if (r?.ok) router.refresh();
  }
  return (
    <div>
      <Button variant="danger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Decline
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-2 rounded-control border border-line bg-canvas p-3">
          <TextField id={`dc-${path}`} name="reason" label="Reason" required minLength={3} maxLength={300} />
          <Button type="submit" variant="danger" disabled={state.phase === "pending"}>
            Confirm
          </Button>
          <Result state={state} />
        </form>
      ) : null}
    </div>
  );
}

/** From the child's page: the family asked in person to move the record to another clinic. */
export function StartTransfer({ clinicId, childId, clinics }: { clinicId: string; childId: string; clinics: { id: string; name: string }[] }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}/record-transfer`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const reason = String(f.get("reason") ?? "").trim();
    const r = await run({ toClinicId: String(f.get("toClinicId")), reason: reason || undefined });
    if (r?.ok) router.push(`/clinic/${clinicId}/transfers`);
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-xl">
      <p className="mb-3 text-sm text-ink-soft">Only after the guardian has asked you in person and you have checked who they are. The record does not move until a clinical lead here releases it and the other clinic accepts.</p>
      <SelectField id="tt-to" name="toClinicId" label="Move to" required defaultValue="" error={fe?.toClinicId}>
        <option value="" disabled>
          Choose a clinic…
        </option>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <TextField id="tt-why" name="reason" label="Note (optional)" maxLength={300} />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        Record the family&apos;s request
      </Button>
      <Result state={state} />
    </form>
  );
}
