"use client";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { formatDate } from "@/lib/format";

/** A guardian never edits the record directly: they ask, staff check what they say against the child's papers and decide. */
export function EditRequestForm({ childId, current }: { childId: string; current: { displayName: string; dob: string | null } }) {
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/children/${childId}/edit-requests`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const patch = {
      displayName: v("displayName"),
      dob: f.get("clearDob") === "on" ? null : v("dob"),
      dobPrecision: f.get("clearDob") === "on" ? "unknown" : v("dob") ? "exact" : undefined,
      addressText: f.get("clearAddress") === "on" ? null : v("address"),
    };
    const r = await run({ patch, reason: v("reason") });
    if (r?.ok) setOpen(false);
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        Ask the clinic to correct a detail
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-3 max-w-xl rounded-control border border-line bg-canvas p-4">
          <p className="mb-3 text-sm text-ink-soft">Fill in only what is wrong. Clinic staff will check it against your child&apos;s papers before anything changes.</p>
          <TextField id="er-name" name="displayName" label="Correct full name" hint={`On file: ${current.displayName}`} error={fe?.["patch.displayName"]} />
          <TextField id="er-dob" name="dob" type="date" label="Correct birth date" hint={current.dob ? `A birth date is on file: ${formatDate(current.dob)}.` : "No birth date is on file."} error={fe?.["patch.dob"]} />
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="clearDob" className="size-5" /> Ask to mark the birth date as unknown</label>
          <TextField id="er-addr" name="address" label="Correct address" error={fe?.["patch.addressText"]} />
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="clearAddress" className="size-5" /> Ask to remove the address</label>
          <TextField id="er-why" name="reason" label="What is wrong, and how do you know?" required minLength={3} maxLength={500} error={fe?.reason} />
          <Button type="submit" disabled={state.phase === "pending"}>
            Send to the clinic
          </Button>
        </form>
      ) : null}
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not sent"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? (
          <Notice tone="success" role="status" title="Sent to the clinic">
            Nothing changes until staff have checked it.
          </Notice>
        ) : null}
      </ResultRegion>
    </div>
  );
}
