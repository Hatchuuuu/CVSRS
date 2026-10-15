"use client";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export interface ProductOption {
  id: string;
  code: string;
  name: string;
}

export function PaperTallyForm({ clinicId, products, defaultDate }: { clinicId: string; products: ProductOption[]; defaultDate: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/paper-tallies`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const note = String(f.get("note") ?? "").trim();
    const r = await run({ serviceDate: String(f.get("serviceDate")), productId: String(f.get("productId")), paperCount: Number(f.get("paperCount")), note: note || undefined });
    if (r?.ok) {
      toast.success("Paper tally saved successfully!");
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-xl">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="pt-date" name="serviceDate" type="date" label="Date of the paper log" defaultValue={defaultDate} required error={fe?.serviceDate} />
        <TextField id="pt-count" name="paperCount" type="number" inputMode="numeric" min={0} max={10000} label="Doses on the paper log" required error={fe?.paperCount} />
      </div>
      <SelectField id="pt-product" name="productId" label="Vaccine" required defaultValue="" error={fe?.productId}>
        <option value="" disabled>
          Choose…
        </option>
        {products.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.code})
          </option>
        ))}
      </SelectField>
      <TextField id="pt-note" name="note" label="Note (optional)" hint="For example the page of the paper log." maxLength={300} />
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Saving…" : "Save tally"}
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Tally saved" /> : null}
      </ResultRegion>
    </form>
  );
}
