"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { announceOutcome } from "@/components/outcome-notice";
import { useMutation, type MutationState } from "@/lib/client/api";
import { STAFF_ROLES } from "@/lib/staff-roles";

const CLINICAL_ROLES = new Set(["clinical_staff", "clinical_lead"]);

function Outcome<T>({ state }: { state: MutationState<T> }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
          {state.error.message}
        </Notice>
      ) : null}
    </ResultRegion>
  );
}

/**
 * Accept or decline one staff application. Accepting files the access request for the chosen role; a second person approves it before
 * access starts (the database enforces this). Declining needs a reason, which the applicant sees. A decided application leaves the
 * waiting list on refresh, so success is announced to the section's `staff-applications:<clinic>` notice.
 */
export function ApplicationDecision({ clinicId, application }: {
  clinicId: string;
  application: { id: string; version: number; name: string; requestedRole: string };
}) {
  const router = useRouter();
  const base = `/api/v1/clinics/${clinicId}/staff-applications/${application.id}`;
  const accept = useMutation<{ requiresClinicalApproval: boolean }>(`${base}/accept`);
  const reject = useMutation(`${base}/reject`);
  const [mode, setMode] = useState<"idle" | "accept" | "decline">("idle");
  const [role, setRole] = useState(application.requestedRole);
  const busy = accept.state.phase === "pending" || reject.state.phase === "pending";

  async function onAccept(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await accept.run({ expectedVersion: application.version, role });
    if (r?.ok) {
      announceOutcome(`staff-applications:${clinicId}`, {
        title: `Accepted ${application.name}. Waiting for a second person to approve.`,
        message: "Their access starts after that approval, under Access waiting for approval.",
      });
      router.refresh();
    }
  }
  async function onDecline(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const r = await reject.run({ expectedVersion: application.version, reason: String(new FormData(e.currentTarget).get("reason") ?? "") });
    if (r?.ok) {
      announceOutcome(`staff-applications:${clinicId}`, { title: `Application from ${application.name} declined`, message: "They see your reason when they sign in." });
      router.refresh();
    }
  }

  return (
    <div className="mt-3">
      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("accept")} aria-label={`Accept application from ${application.name}`}>
            Accept
          </Button>
          <Button variant="secondary" onClick={() => setMode("decline")} aria-label={`Decline application from ${application.name}`}>
            Decline
          </Button>
        </div>
      ) : null}

      {mode === "accept" ? (
        <form onSubmit={onAccept} className="rounded-control border border-primary/30 bg-primary-soft/40 p-4" aria-label={`Accept application from ${application.name}`}>
          <SelectField id={`acc-role-${application.id}`} name="role" label="Role to request" value={role} onChange={(e) => setRole(e.target.value)}>
            {STAFF_ROLES.map((r) => (
              <option key={r.role} value={r.role}>
                {r.label}
                {r.role === application.requestedRole ? " (applied for)" : ""}
              </option>
            ))}
          </SelectField>
          <p className="mb-3 text-sm text-ink-soft">
            Accepting sends this request to a second person for approval; access starts only after they approve.{" "}
            {CLINICAL_ROLES.has(role) ? "A clinical role is approved by a clinical lead." : "Another access administrator approves it."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" pending={accept.state.phase === "pending"}>
              Accept and send for approval
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "decline" ? (
        <form onSubmit={onDecline} className="rounded-control border border-danger/40 bg-danger-bg p-4" aria-label={`Decline application from ${application.name}`}>
          <TextField id={`dec-reason-${application.id}`} name="reason" label="Reason (the applicant sees this)" required minLength={3} maxLength={500} />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="danger" pending={reject.state.phase === "pending"}>
              Decline application
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <Outcome state={accept.state} />
      <Outcome state={reject.state} />
    </div>
  );
}
