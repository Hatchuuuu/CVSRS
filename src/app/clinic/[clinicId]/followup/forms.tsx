"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { announceOutcome } from "@/components/outcome-notice";

export function RefreshButton({ clinicId, stale }: { clinicId: string; stale: number }) {
  const router = useRouter();
  const { state, run } = useMutation<{ refreshed: number; remaining: number }>(`/api/v1/clinics/${clinicId}/followup/refresh`);
  return (
    <div>
      <Button
        variant={stale > 0 ? "primary" : "secondary"}
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run();
          if (r?.ok) router.refresh();
        }}
      >
        {state.phase === "pending" ? "Checking children…" : stale > 0 ? `Update the list (${stale} to check)` : "Check again now"}
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Could not update"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? (
          <Notice tone="success" role="status" title={`Checked ${state.data.refreshed} ${state.data.refreshed === 1 ? "child" : "children"}`}>
            {state.data.remaining > 0 ? `${state.data.remaining} more still need checking. Press the button again.` : "The list is up to date."}
          </Notice>
        ) : null}
      </ResultRegion>
    </div>
  );
}

const OUTCOMES = [
  ["reached", "Spoke to the family"],
  ["no_answer", "No answer"],
  ["wrong_number", "Wrong or unreachable number"],
  ["will_visit", "Family will come to the clinic"],
  ["refused", "Family does not want to continue"],
  ["moved_away", "Family has moved away"],
  ["other", "Other"],
] as const;

export function AttemptForm({ clinicId, childId, childName }: { clinicId: string; childId: string; childName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}/followup-attempts`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const note = String(f.get("note") ?? "").trim();
    const next = String(f.get("nextTryOn") ?? "");
    const r = await run({ outcome: String(f.get("outcome")), note: note || undefined, nextTryOn: next || undefined });
    if (r?.ok) {
      announceOutcome(`followup:${clinicId}`, { title: `Contact attempt recorded for ${childName}` });
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <div className="mt-2">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Record a contact attempt
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4" aria-label={`Contact attempt for ${childName}`}>
          <SelectField id={`fo-${childId}`} name="outcome" label="What happened?" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {OUTCOMES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </SelectField>
          <TextField id={`fn-${childId}`} name="note" label="Note (optional)" maxLength={300} />
          <TextField id={`fd-${childId}`} name="nextTryOn" type="date" label="Try again on (optional)" hint="The child leaves your list until this date." error={fe?.nextTryOn} />
          <Button type="submit" disabled={state.phase === "pending"}>
            Save attempt
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
  );
}
