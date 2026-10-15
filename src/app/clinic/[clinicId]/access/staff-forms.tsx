"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Card, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { announceOutcome } from "@/components/outcome-notice";
import { useMutation, type MutationState } from "@/lib/client/api";
import { STAFF_ROLES } from "@/lib/staff-roles";

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

/** Approving or removing access can drop the row from its list on refresh, so success is announced to the page's `staff-access:<clinic>` notice. */
export function StaffRowActions({ clinicId, row, canApprove, canRevoke }: { clinicId: string; row: { id: string; version: number; name: string }; canApprove: boolean; canRevoke: boolean }) {
  const router = useRouter();
  const approve = useMutation(`/api/v1/clinics/${clinicId}/staff/${row.id}/approve`);
  const revoke = useMutation(`/api/v1/clinics/${clinicId}/staff/${row.id}/revoke`);
  const [open, setOpen] = useState(false);
  async function onRevoke(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await revoke.run({ reason: String(new FormData(e.currentTarget).get("reason") ?? "") });
    if (r?.ok) {
      announceOutcome(`staff-access:${clinicId}`, { title: `Access removed for ${row.name || "this person"}`, message: "They lose access to this clinic on their next page load." });
      router.refresh();
    }
  }
  return (
    <div className="mt-2 flex flex-wrap items-start gap-3">
      {canApprove ? (
        <Button
          disabled={approve.state.phase === "pending"}
          onClick={async () => {
            const r = await approve.run({ expectedVersion: row.version });
            if (r?.ok) {
              announceOutcome(`staff-access:${clinicId}`, { title: `Access approved for ${row.name || "this person"}` });
              router.refresh();
            }
          }}
          aria-label={`Approve access for ${row.name}`}
        >
          Approve
        </Button>
      ) : null}
      {canRevoke ? (
        <>
          <Button variant="quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Remove access
          </Button>
          {open ? (
            <form onSubmit={onRevoke} className="w-full rounded-control border border-line p-3">
              <TextField id={`rv-${row.id}`} name="reason" label="Reason (recorded in the audit trail)" required minLength={3} />
              <Button type="submit" variant="danger" disabled={revoke.state.phase === "pending"}>
                Remove access
              </Button>
            </form>
          ) : null}
        </>
      ) : null}
      <div className="w-full">
        <Outcome state={approve.state} />
        <Outcome state={revoke.state} />
      </div>
    </div>
  );
}

const EXTRA = [
  ["evidence.verify", "Verify outside vaccination evidence (clinical)"],
  ["certificate.issue", "Issue certificates (clinical)"],
  ["inventory.manage", "Manage vaccine stock"],
  ["report.run", "Run reports"],
] as const;

/** `staffSignUpUrl` is where a new staff member creates the account this form looks up by email. */
export function RequestStaffForm({ clinicId, staffSignUpUrl }: { clinicId: string; staffSignUpUrl: string }) {
  const router = useRouter();
  const { state, run } = useMutation<{ requiresClinicalApproval: boolean }>(`/api/v1/clinics/${clinicId}/staff`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ email: String(f.get("email") ?? "").trim(), role: String(f.get("role")), capabilities: f.getAll("cap").map(String) });
    if (r?.ok) {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <Card aria-labelledby="req-h">
      <h2 id="req-h" className="mb-1 text-xl font-bold">
        Request access for a person
      </h2>
      <p className="mb-4 text-sm leading-relaxed text-ink-soft">
        New staff first create their own account at <strong className="break-all font-semibold text-ink">{staffSignUpUrl}</strong>, then give you the email
        address they used. Your request waits until a second person approves it.
      </p>
      <form onSubmit={submit}>
        <TextField id="st-email" name="email" type="email" label="Their account email" hint="The email address of their eVacTrack account." required error={fe.email} />
        <SelectField id="st-role" name="role" label="Role" defaultValue="assistant">
          {STAFF_ROLES.map((r) => (
            <option key={r.role} value={r.role}>
              {r.label}
            </option>
          ))}
        </SelectField>
        <fieldset className="mb-4">
          <legend className="mb-1 font-semibold">Extra permissions (optional)</legend>
          {EXTRA.map(([v, l]) => (
            <label key={v} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" name="cap" value={v} className="size-5" /> {l}
            </label>
          ))}
        </fieldset>
        <Outcome state={state} ok="Request created and waiting for a second person to approve" />
        <Button type="submit" disabled={state.phase === "pending"}>
          Request access
        </Button>
      </form>
    </Card>
  );
}
