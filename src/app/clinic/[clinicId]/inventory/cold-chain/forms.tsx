"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";
import { clinicLocalToInstant, instantToClinicLocal } from "@/lib/format";

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok?: string }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" && ok ? <Notice tone="success" role="status" title={ok} /> : null}
    </ResultRegion>
  );
}
const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(",", "."));

/** datetime-local has no zone: read it as CLINIC wall time (never the device's) and send an absolute time. Unreadable input is sent as missing so the server's message shows. */
const toIso = (local: string, clinicTimezone: string) => clinicLocalToInstant(local, clinicTimezone) ?? undefined;

export function LimitsForm({ clinicId, current }: { clinicId: string; current: { minC: string; maxC: string; policyReference: string } | null }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/temperature/limits`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ minC: num(f, "minC"), maxC: num(f, "maxC"), policyReference: String(f.get("policyReference") ?? "").trim() });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-xl">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="lim-min" name="minC" type="number" step="any" label="Lowest allowed (°C)" defaultValue={current?.minC} required error={fe?.minC} />
        <TextField id="lim-max" name="maxC" type="number" step="any" label="Highest allowed (°C)" defaultValue={current?.maxC} required error={fe?.maxC} />
      </div>
      <TextField id="lim-pol" name="policyReference" label="Policy these limits come from" hint="For example the document and version your cold-chain lead approved. The system never chooses limits for you." defaultValue={current?.policyReference} required minLength={3} maxLength={200} error={fe?.policyReference} />
      <Button type="submit" disabled={state.phase === "pending"}>
        Save limits
      </Button>
      <Outcome state={state} ok="Limits saved. They apply to new readings; earlier readings keep the limits in force when they were taken." />
    </form>
  );
}

export function ReadingForm({ clinicId, clinicTimezone, locations }: { clinicId: string; clinicTimezone: string; locations: { id: string; label: string }[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ status: string }>(`/api/v1/clinics/${clinicId}/stock/temperature`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const note = String(f.get("note") ?? "").trim();
    const r = await run({ locationId: String(f.get("locationId")), observedAt: toIso(String(f.get("observedAt") ?? ""), clinicTimezone), minC: num(f, "minC"), maxC: num(f, "maxC"), note: note || undefined });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-xl">
      <SelectField id="rd-loc" name="locationId" label="Fridge or store" required defaultValue="" error={fe?.locationId}>
        <option value="" disabled>
          Choose…
        </option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </SelectField>
      <div className="grid gap-x-4 sm:grid-cols-3">
        <TextField id="rd-when" name="observedAt" type="datetime-local" label="When read" defaultValue={instantToClinicLocal(new Date(), clinicTimezone)} required hint={`Clinic time (${clinicTimezone}).`} error={fe?.observedAt} />
        <TextField id="rd-min" name="minC" type="number" step="any" label="Lowest (°C)" required error={fe?.minC} />
        <TextField id="rd-max" name="maxC" type="number" step="any" label="Highest (°C)" required error={fe?.maxC} />
      </div>
      <TextField id="rd-note" name="note" label="Note (optional)" maxLength={300} />
      <Button type="submit" disabled={state.phase === "pending"}>
        Save reading
      </Button>
      <Outcome state={state} />
      {state.phase === "success" ? (
        state.data.status === "excursion" ? (
          <Notice tone="danger" role="alert" title="Outside the approved limits">
            This reading is flagged. A clinical approver must record what was done. Do not use the stock until they decide.
          </Notice>
        ) : state.data.status === "no_limits" ? (
          <Notice tone="info" role="status" title="Saved, not judged">
            No approved limits exist yet, so this reading was kept but not compared to anything.
          </Notice>
        ) : (
          <Notice tone="success" role="status" title="Within the approved limits" />
        )
      ) : null}
    </form>
  );
}

export function ReviewExcursion({ clinicId, readingId }: { clinicId: string; readingId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/temperature/${readingId}/review`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ action: String(f.get("action")), note: String(f.get("note") ?? "").trim() });
    if (r?.ok) router.refresh();
  }
  return (
    <div className="mt-2">
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Record what was done
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
          <SelectField id={`ra-${readingId}`} name="action" label="Action taken" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            <option value="no_action">No action needed (explain why)</option>
            <option value="lots_quarantined">Affected lots quarantined</option>
            <option value="stock_discarded">Affected stock discarded</option>
            <option value="other">Something else</option>
          </SelectField>
          <TextField id={`rn-${readingId}`} name="note" label="Details" required minLength={3} maxLength={300} hint="Quarantine lots from the Lots page. This record does not move stock." />
          <Button type="submit" disabled={state.phase === "pending"}>
            Save
          </Button>
          <Outcome state={state} />
        </form>
      ) : null}
    </div>
  );
}
