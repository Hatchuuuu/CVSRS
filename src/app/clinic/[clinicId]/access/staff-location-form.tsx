"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Notice, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export function StaffLocationForm({ clinicId, row }: { clinicId: string; row: { membershipId: string; displayName: string; version: number; barangay: string | null; cityMunicipality: string | null } }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/staff/${row.membershipId}/location`);
  const pending = state.phase === "pending";
  const errors = state.phase === "error" ? state.error.fieldErrors ?? {} : {};
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const result = await run({ expectedVersion: row.version, barangay: String(data.get("barangay") ?? ""), cityMunicipality: String(data.get("cityMunicipality") ?? "") });
    if (result?.ok) { setOpen(false); router.refresh(); }
  }
  return (
    <div className="mt-2">
      <Button variant="quiet" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={`location-${row.membershipId}`} disabled={pending}>
        {row.barangay ? "Edit assignment" : "Add assignment"}
      </Button>
      {open ? <form id={`location-${row.membershipId}`} aria-label={`Assignment for ${row.displayName}`} onSubmit={submit} className="mt-2 max-w-2xl rounded-control border border-line p-4">
        <fieldset disabled={pending}>
          <legend className="mb-2 font-semibold">Assigned work location</legend>
          <p className="mb-3 text-sm text-ink-soft">Enter the staff member’s assigned barangay and city or municipality. Clear both fields to remove the assignment.</p>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <TextField id={`barangay-${row.membershipId}`} name="barangay" label="Barangay" defaultValue={row.barangay ?? ""} maxLength={120} placeholder="e.g. Bunao" error={errors.barangay} />
            <TextField id={`city-${row.membershipId}`} name="cityMunicipality" label="City / municipality" defaultValue={row.cityMunicipality ?? ""} maxLength={120} placeholder="e.g. Dumaguete City" error={errors.cityMunicipality} />
          </div>
          <div className="flex gap-3"><Button type="submit" pending={pending}>{pending ? "Saving…" : "Save assignment"}</Button><Button variant="secondary" type="button" onClick={() => setOpen(false)}>Cancel</Button></div>
        </fieldset>
      </form> : null}
      {state.phase === "error" ? <Notice tone="danger" role="alert" title="Assignment not saved">{state.error.message}</Notice> : null}
      {state.phase === "success" ? <p role="status" className="mt-2 text-sm text-ink-soft">Assignment saved.</p> : null}
    </div>
  );
}
