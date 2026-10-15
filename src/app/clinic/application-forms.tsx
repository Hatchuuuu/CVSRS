"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { STAFF_ROLES } from "@/lib/staff-roles";

/** Apply to a health center from the clinic workspace (for an existing account, or after a declined application). */
export function StaffApplicationForm({ clinics }: { clinics: { id: string; name: string }[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ applicationId: string }>("/api/v1/me/staff-applications");
  const [noteLength, setNoteLength] = useState(0);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({
      clinicId: String(f.get("clinicId") ?? ""),
      role: String(f.get("role") ?? ""),
      positionTitle: String(f.get("positionTitle") ?? "").trim() || undefined,
      note: String(f.get("note") ?? "").trim() || undefined,
    });
    if (r?.ok) router.refresh();
  }
  if (clinics.length === 0) {
    return <p className="mt-2">No health center is accepting staff applications yet.</p>;
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-sunken/50 p-4" aria-label="Apply for clinic access">
      <SelectField id="app-clinic" name="clinicId" label="Health center" required defaultValue={clinics.length === 1 ? clinics[0]!.id : ""} error={fe.clinicId}>
        <option value="" disabled>
          Choose your health center
        </option>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <SelectField id="app-role" name="role" label="Role you are applying for" required defaultValue="clinical_staff" error={fe.role}>
        {STAFF_ROLES.map((r) => (
          <option key={r.role} value={r.role}>
            {r.label}
          </option>
        ))}
      </SelectField>
      <TextField id="app-title" name="positionTitle" label="Job title (optional)" maxLength={80} placeholder="e.g. Public health nurse" error={fe.positionTitle} />
      <TextField
        id="app-note"
        name="note"
        label="Note to the administrator (optional)"
        maxLength={500}
        hint={noteLength ? `${noteLength} of 500 characters` : undefined}
        onChange={(e) => setNoteLength(e.currentTarget.value.length)}
        error={fe.note}
      />
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not sent"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Application sent" /> : null}
      </ResultRegion>
      <Button type="submit" pending={state.phase === "pending"}>
        Send application
      </Button>
    </form>
  );
}

export function WithdrawApplicationButton({ applicationId, clinicName }: { applicationId: string; clinicName: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/me/staff-applications/${applicationId}/withdraw`);
  const [confirming, setConfirming] = useState(false);
  return (
    <span className="mt-1 flex flex-wrap items-center gap-2">
      {confirming ? (
        <>
          <Button
            variant="danger"
            pending={state.phase === "pending"}
            onClick={async () => {
              const r = await run();
              if (r?.ok) router.refresh();
            }}
          >
            Yes, withdraw
          </Button>
          <Button variant="secondary" disabled={state.phase === "pending"} onClick={() => setConfirming(false)}>
            Keep application
          </Button>
        </>
      ) : (
        <Button variant="quiet" onClick={() => setConfirming(true)} aria-label={`Withdraw application to ${clinicName}`}>
          Withdraw
        </Button>
      )}
      {state.phase === "error" ? (
        <span role="alert" className="w-full text-sm text-danger">
          {state.error.message}
        </span>
      ) : null}
    </span>
  );
}
