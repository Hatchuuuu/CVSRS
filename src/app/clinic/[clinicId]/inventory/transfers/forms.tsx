"use client";
import { useRouter } from "next/navigation";
import { announceOutcome } from "@/components/outcome-notice";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";

export interface Option {
  id: string;
  label: string;
}

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok?: ReactNode }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
      {state.phase === "success" && ok ? <Notice tone="success" role="status" title="Saved">{ok}</Notice> : null}
    </ResultRegion>
  );
}
const opts = (list: Option[]) => list.map((o) => (
  <option key={o.id} value={o.id}>
    {o.label}
  </option>
));
const num = (f: FormData, k: string) => Number(String(f.get(k) ?? "").replace(",", "."));

export function SendForm({ clinicId, clinics, lots, locations }: { clinicId: string; clinics: Option[]; lots: Option[]; locations: Option[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ reference: string }>(`/api/v1/clinics/${clinicId}/stock/transfers`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const note = String(f.get("note") ?? "").trim();
    const r = await run({ toClinicId: String(f.get("toClinicId")), fromLocationId: String(f.get("fromLocationId")), lotId: String(f.get("lotId")), quantity: num(f, "quantity"), note: note || undefined });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-2xl">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField id="tr-to" name="toClinicId" label="Send to" required defaultValue="" error={fe?.toClinicId}>
          <option value="" disabled>
            Choose a clinic…
          </option>
          {opts(clinics)}
        </SelectField>
        <SelectField id="tr-from" name="fromLocationId" label="Take from" required defaultValue="" error={fe?.fromLocationId}>
          <option value="" disabled>
            Choose a location…
          </option>
          {opts(locations)}
        </SelectField>
        <SelectField id="tr-lot" name="lotId" label="Vaccine and lot" required defaultValue="" error={fe?.lotId}>
          <option value="" disabled>
            Choose a lot…
          </option>
          {opts(lots)}
        </SelectField>
        <TextField id="tr-qty" name="quantity" type="number" inputMode="decimal" min="0" step="any" label="Quantity (stock units)" required error={fe?.quantity} />
      </div>
      <TextField id="tr-note" name="note" label="Note (optional)" maxLength={300} />
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Sending…" : "Send transfer"}
      </Button>
      <Outcome state={state} ok={state.phase === "success" ? `Sent as ${state.data.reference}. The stock is now in transit.` : undefined} />
    </form>
  );
}

export function ReceiveTransfer({ clinicId, transferId, sent, unit, locations }: { clinicId: string; transferId: string; sent: string; unit: string; locations: Option[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ status: string }>(`/api/v1/clinics/${clinicId}/stock/transfers/${transferId}/receive`);
  const [accepted, setAccepted] = useState(true);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ locationId: String(f.get("locationId")), receivedQuantity: num(f, "receivedQuantity"), accepted });
    if (r?.ok) {
      announceOutcome(`stock-transfers:${clinicId}`, { title: "Transfer receipt recorded", message: r.data.status === "received_short" ? "The shortfall remains in transit for another approver to review." : accepted ? "The received stock is now on the books." : "The received stock was placed in quarantine." });
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id={`rq-${transferId}`} name="receivedQuantity" type="number" inputMode="decimal" min="0" step="any" max={sent} defaultValue={sent} label={`Count what arrived (${unit})`} hint={`${sent} were sent. If fewer arrived, enter what you counted: the rest stays in transit for review.`} required />
        <SelectField id={`rl-${transferId}`} name="locationId" label="Store in" required defaultValue="">
          <option value="" disabled>
            Choose a location…
          </option>
          {opts(locations)}
        </SelectField>
      </div>
      <label className="mb-4 flex min-h-11 items-center gap-2">
        <input type="checkbox" className="size-5" checked={!accepted} onChange={(e) => setAccepted(!e.target.checked)} />
        <span>Do not accept: damaged or suspect (goes to quarantine)</span>
      </label>
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Saving…" : "Confirm receipt"}
      </Button>
      <Outcome state={state} />
    </form>
  );
}

export function CancelTransfer({ clinicId, transferId }: { clinicId: string; transferId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/transfers/${transferId}/cancel`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "").trim() });
    if (r?.ok) {
      announceOutcome(`stock-transfers:${clinicId}`, { title: "Transfer cancelled", message: "The stock was returned to the sending location." });
      router.refresh();
    }
  }
  return (
    <div>
      <Button variant="danger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Cancel transfer
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
          <TextField id={`cx-${transferId}`} name="reason" label="Why is it being cancelled?" required minLength={3} maxLength={300} />
          <Button type="submit" variant="danger" disabled={state.phase === "pending"}>
            Cancel and put stock back
          </Button>
          <Outcome state={state} />
        </form>
      ) : null}
    </div>
  );
}

export function ResolveShortfall({ clinicId, transferId, shortfall, unit, locations }: { clinicId: string; transferId: string; shortfall: string; unit: string; locations: Option[] }) {
  const router = useRouter();
  const [decision, setDecision] = useState("write_off");
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/stock/transfers/${transferId}/resolve`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const loc = String(f.get("returnLocationId") ?? "");
    const r = await run({ decision, note: String(f.get("note") ?? "").trim(), returnLocationId: decision === "return" && loc ? loc : undefined });
    if (r?.ok) {
      announceOutcome(`stock-transfers:${clinicId}`, { title: "Shortfall decision recorded", message: decision === "return" ? "The missing quantity was returned to stock." : "The missing quantity was written off." });
      router.refresh();
    }
  }
  return (
    <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
      <p className="mb-3 font-semibold">
        {shortfall} {unit} did not arrive. Someone other than the sender decides what happens to them.
      </p>
      <SelectField id={`sd-${transferId}`} label="Decision" value={decision} onChange={(e) => setDecision(e.target.value)}>
        <option value="write_off">Write off as lost or spoiled</option>
        <option value="return">Take back into stock (found or returned)</option>
      </SelectField>
      {decision === "return" ? (
        <SelectField id={`sl-${transferId}`} name="returnLocationId" label="Return to" required defaultValue="">
          <option value="" disabled>
            Choose a location…
          </option>
          {opts(locations)}
        </SelectField>
      ) : null}
      <TextField id={`sn-${transferId}`} name="note" label="Note" required minLength={3} maxLength={300} />
      <Button type="submit" disabled={state.phase === "pending"}>
        Record decision
      </Button>
      <Outcome state={state} />
    </form>
  );
}
