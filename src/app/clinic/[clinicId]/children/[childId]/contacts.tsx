"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, StatusChip, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";

export interface GuardianContact {
  relationshipId: string;
  guardianId: string;
  phoneMasked: string | null;
  hasPhone: boolean;
  phoneChecked: boolean;
  smsOptIn: boolean;
  /** 'invalid' when staff found the number does not reach the guardian (0037). */
  contactStatus?: "unverified" | "verified" | "invalid";
}

function Failure<T>({ state }: { state: MutationState<T> }) {
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

/** A number that rings someone else or never connects. Text messages stop until the guardian gives a new number. */
function NumberNotWorking({ clinicId, contact }: { clinicId: string; contact: GuardianContact }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/guardians/${contact.guardianId}/contact-invalid`);
  const [open, setOpen] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = String(new FormData(e.currentTarget).get("note") ?? "").trim();
    const r = await run({ note });
    if (r?.ok) router.refresh();
  }
  if (!open) {
    return (
      <Button variant="quiet" className="px-0" onClick={() => setOpen(true)}>
        The number does not work
      </Button>
    );
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit} className="mt-2 rounded-control border border-line bg-sunken p-3">
      <TextField id={`bad-${contact.guardianId}`} name="note" label="What happened when you called" required minLength={3} maxLength={300} error={fe.note} />
      <Failure state={state} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" pending={state.phase === "pending"}>Mark the number as not working</Button>
        <Button variant="secondary" disabled={state.phase === "pending"} onClick={() => setOpen(false)}>Keep it</Button>
      </div>
    </form>
  );
}

/** Staff confirm in person that the number on file is the guardian's. Only then can the guardian choose text messages. */
export function VerifyContact({ clinicId, contact }: { clinicId: string; contact: GuardianContact }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/guardians/${contact.guardianId}/verify-contact`);
  if (!contact.hasPhone) return <p className="text-sm text-ink-soft">No phone number on file.</p>;
  const invalid = contact.contactStatus === "invalid";
  return (
    <div className="mt-1">
      <p className="tnum text-sm">
        Phone {contact.phoneMasked}{" "}
        {invalid ? (
          <StatusChip tone="danger">Number not working</StatusChip>
        ) : contact.phoneChecked ? (
          <StatusChip tone="success">Checked in person</StatusChip>
        ) : (
          <StatusChip tone="attention">Not checked yet</StatusChip>
        )}
        {contact.smsOptIn ? <span className="ml-2 text-ink-soft">Text messages on</span> : null}
      </p>
      {invalid ? <p className="mt-1 text-sm text-ink-soft">Ask the guardian for a new number; they can change it in the app under Messages.</p> : null}
      {!contact.phoneChecked && !invalid ? (
        <div className="mt-1">
          <Button
            variant="secondary"
            disabled={state.phase === "pending"}
            onClick={async () => {
              const r = await run();
              if (r?.ok) router.refresh();
            }}
          >
            I checked this number with the guardian
          </Button>
          <Failure state={state} />
        </div>
      ) : null}
      {!invalid ? <NumberNotWorking clinicId={clinicId} contact={contact} /> : null}
    </div>
  );
}
