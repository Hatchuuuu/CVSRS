"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { announceOutcome } from "@/components/outcome-notice";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";

export interface ProductOption {
  id: string;
  code: string;
  name: string;
  antigens: string[];
}

function Outcome<T>({ state, ok }: { state: MutationState<T>; ok: string }) {
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

const productOptions = (products: ProductOption[]) =>
  products.map((p) => (
    <option key={p.id} value={p.id}>
      {p.name} ({p.antigens.join(", ")})
    </option>
  ));

/** Staff entry of a dose given elsewhere. "Verified" is only allowed with an approved product and an exact date (enforced by the database too). */
export function OutsideDoseForm({ clinicId, childId, products }: { clinicId: string; childId: string; products: ProductOption[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ verificationStatus: string }>(`/api/v1/clinics/${clinicId}/children/${childId}/outside-doses`);
  const [precision, setPrecision] = useState("exact");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const verified = f.get("verified") === "on";
    const res = await run({
      dose: { productText: v("productText"), precision, administeredOn: precision === "unknown" ? undefined : v("administeredOn"), provider: v("provider"), lotText: v("lotText") },
      productId: verified ? v("productId") : undefined,
      verified,
    });
    if (res?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="od-text" name="productText" label="Vaccine as written / reported" required error={fe["dose.productText"]} />
        <TextField id="od-provider" name="provider" label="Provider (optional)" />
        <SelectField id="od-prec" label="Date certainty" value={precision} onChange={(e) => setPrecision(e.target.value)}>
          <option value="exact">Exact date</option>
          <option value="month">Month only</option>
          <option value="year">Year only</option>
          <option value="unknown">Unknown</option>
        </SelectField>
        <TextField id="od-date" name="administeredOn" type="date" label="Date" />
        <TextField id="od-lot" name="lotText" label="Lot (optional)" autoComplete="off" />
      </div>
      <fieldset className="mb-4 rounded-control border border-line p-4">
        <legend className="px-1 font-bold">Verification</legend>
        <label className="mb-3 flex min-h-11 items-center gap-2">
          <input type="checkbox" name="verified" className="size-5" /> I have seen documentary evidence and confirm this dose
        </label>
        <SelectField id="od-product" name="productId" label="Approved product (required to confirm)" defaultValue="">
          <option value="">— choose —</option>
          {productOptions(products)}
        </SelectField>
        <p className="text-sm text-ink-soft">Without confirmation the entry stays “waiting for check” and earns no credit.</p>
      </fieldset>
      <Outcome state={state} ok="Saved" />
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Saving…" : "Save outside dose"}
      </Button>
    </form>
  );
}

export function VerifyEvidence({ clinicId, childId, eventId, products, defaultDate }: { clinicId: string; childId: string; eventId: string; products: ProductOption[]; defaultDate: string | null }) {
  const router = useRouter();
  const { state, run } = useMutation<{ verificationStatus: string }>(`/api/v1/clinics/${clinicId}/evidence/${eventId}/verify`);
  async function decide(decision: "verify" | "reject", form: HTMLFormElement) {
    const f = new FormData(form);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const res = await run({ decision, productId: decision === "verify" ? v("productId") : undefined, administeredOn: decision === "verify" ? v("date") : undefined, note: v("note") });
    if (res?.ok) {
      // Announced above the history: this form is shown only while the report waits for a decision.
      announceOutcome(`history:${childId}`, decision === "verify"
        ? { title: "Reported dose confirmed", message: "It now counts toward the schedule. The family has been told." }
        : { title: "Reported dose declined", message: "It earns no credit. The family has been told." });
      router.refresh();
    }
  }
  return (
    <form onSubmit={(e) => e.preventDefault()} className="mt-2 rounded-control border border-line p-3">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField id={`vp-${eventId}`} name="productId" label="Map to approved product" defaultValue="">
          <option value="">— choose —</option>
          {productOptions(products)}
        </SelectField>
        <TextField id={`vd-${eventId}`} name="date" type="date" label="Confirmed exact date" defaultValue={defaultDate ?? ""} />
        <TextField id={`vn-${eventId}`} name="note" label="Note (required to reject)" />
      </div>
      <Outcome state={state} ok="" />
      <div className="flex flex-wrap gap-3">
        <Button onClick={(e) => decide("verify", e.currentTarget.form!)} disabled={state.phase === "pending"}>
          Confirm dose
        </Button>
        <Button variant="danger" onClick={(e) => decide("reject", e.currentTarget.form!)} disabled={state.phase === "pending"}>
          Do not accept
        </Button>
      </div>
    </form>
  );
}
