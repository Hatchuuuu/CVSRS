"use client";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { toast } from "sonner";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export function ReportDoseForm({ childId }: { childId: string }) {
  const router = useRouter();
  const { state, run } = useMutation<{ eventId: string }>(`/api/v1/children/${childId}/outside-doses`);
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const precision = v("precision") ?? "exact";
    const res = await run({
      dose: {
        productText: v("productText"),
        precision,
        administeredOn: precision === "unknown" ? undefined : v("administeredOn"),
        provider: v("provider"),
        lotText: v("lotText"),
      },
    });
    if (res?.ok) {
      toast.success("Outside dose reported successfully!", {
        description: "Sent to the clinic for verification.",
      });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="card-elevated p-5 sm:p-6 shadow-xs">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="rd-product" name="productText" label="Which vaccine?" hint="As written on the card, or your best description." required error={fe["dose.productText"]} />
        <TextField id="rd-provider" name="provider" label="Where was it given? (optional)" />
        <SelectField id="rd-prec" name="precision" label="How sure are you of the date?" defaultValue="exact">
          <option value="exact">I know the exact date</option>
          <option value="month">I know the month</option>
          <option value="year">I know the year</option>
          <option value="unknown">I don&apos;t know</option>
        </SelectField>
        <TextField id="rd-date" name="administeredOn" type="date" label="Date (or a date in that month or year)" error={fe["dose.administeredOn"]} />
        <TextField id="rd-lot" name="lotText" label="Batch / lot number (optional)" autoComplete="off" />
      </div>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? (
          <Notice tone="success" role="status" title="Sent to the clinic">
            It is marked “waiting for clinic check”. It does not count toward the schedule until staff confirm it.
          </Notice>
        ) : null}
      </ResultRegion>
      <Button type="submit" pending={state.phase === "pending"}>
        {state.phase === "pending" ? "Sending…" : "Send to the clinic"}
      </Button>
    </form>
  );
}
