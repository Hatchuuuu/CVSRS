"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { useConfirmStep } from "@/components/confirm-step";
import { announceOutcome } from "@/components/outcome-notice";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation, type MutationState } from "@/lib/client/api";

function Outcome<T>({ state, okTitle }: { state: MutationState<T>; okTitle: string }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : (state.error.code === "conflict" ? "Record changed" : "Not saved")}>
          {state.error.message}
          {state.error.requestId ? <span className="block text-sm text-ink-soft">Reference: {state.error.requestId}</span> : null}
        </Notice>
      ) : null}
      {state.phase === "success" && okTitle ? <Notice tone="success" role="status" title={okTitle} /> : null}
    </ResultRegion>
  );
}

/**
 * Shown while the record is provisional. It stays mounted afterwards (rendering only its outcome), so the success notice is
 * still there after the refresh that confirms the record.
 */
export function ConfirmIdentity({ clinicId, childId, version, provisional }: { clinicId: string; childId: string; version: number; provisional: boolean }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}/confirm-identity`);
  if (!provisional) return state.phase === "success" ? <Outcome state={state} okTitle="Identity confirmed" /> : null;
  return (
    <div>
      <p className="mb-2">Confirm this child&apos;s identity only after checking the details against a document or the accompanying adult.</p>
      <Outcome state={state} okTitle="Identity confirmed" />
      <Button
        onClick={async () => {
          const r = await run({ expectedVersion: version });
          if (r?.ok) router.refresh();
        }}
        disabled={state.phase === "pending"}
      >
        {state.phase === "pending" ? "Saving…" : "Confirm child identity"}
      </Button>
    </div>
  );
}

export function GuardianActions({ clinicId, childId, guardianName, relationshipId, status }: { clinicId: string; childId: string; guardianName: string; relationshipId: string; status: string }) {
  const router = useRouter();
  const verify = useMutation(`/api/v1/clinics/${clinicId}/relationships/${relationshipId}/verify`);
  const change = useMutation(`/api/v1/clinics/${clinicId}/relationships/${relationshipId}/status`);
  const [open, setOpen] = useState(false);

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const method = String(new FormData(e.currentTarget).get("method"));
    const r = await verify.run({ method });
    if (r?.ok) router.refresh();
  }
  async function onChange(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const next = String(f.get("status"));
    const r = await change.run({ status: next, reason: String(f.get("reason") ?? "") });
    if (r?.ok) {
      setOpen(false);
      // Announced above the list: a removed guardian's row (and these controls) leave the page on refresh.
      announceOutcome(`guardians:${childId}`, next === "revoked"
        ? { title: `Access removed for ${guardianName}`, message: "The child's record and other guardians are not affected." }
        : next === "suspended"
          ? { title: `Access paused for ${guardianName}`, message: "They no longer see the child's history until access is restored." }
          : { title: `Access restored for ${guardianName}` });
      router.refresh();
    }
  }
  return (
    <div className="mt-2">
      {status === "provisional" ? (
        <form onSubmit={onVerify} className="mb-2">
          <SelectField id={`m-${relationshipId}`} name="method" label="Verified by" defaultValue="in_person_id">
            <option value="in_person_id">In person, with ID</option>
            <option value="clinic_record">Existing clinic record</option>
            <option value="invitation">Clinic invitation</option>
            <option value="court_document">Court document</option>
          </SelectField>
          <Button type="submit" disabled={verify.state.phase === "pending"}>
            Verify this guardian
          </Button>
        </form>
      ) : null}
      {/* Outside the form: the form disappears once the guardian is verified, the outcome must not. */}
      <Outcome state={verify.state} okTitle="Guardian verified" />
      {status === "active" || status === "provisional" || status === "suspended" ? (
        <>
          <Button variant="quiet" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            Pause or remove access
          </Button>
          {open ? (
            <form onSubmit={onChange} className="mt-2 rounded-control border border-line p-3">
              <SelectField id={`s-${relationshipId}`} name="status" label="Action" defaultValue="suspended">
                <option value="suspended">Pause access (dispute or review)</option>
                <option value="revoked">Remove access</option>
                {status === "suspended" ? <option value="active">Restore access</option> : null}
              </SelectField>
              <TextField id={`r-${relationshipId}`} name="reason" label="Reason (recorded in the audit trail)" required minLength={3} />
              <Button type="submit" variant="danger" disabled={change.state.phase === "pending"}>
                Save
              </Button>
              <p className="mt-2 text-sm text-ink-soft">The child&apos;s record and other guardians are not affected.</p>
            </form>
          ) : null}
        </>
      ) : null}
      {/* Errors only: a success is announced above the guardian list. */}
      {change.state.phase === "error" ? <Outcome state={change.state} okTitle="" /> : null}
    </div>
  );
}

export function StaffQr({ clinicId, childId, childName }: { clinicId: string; childId: string; childName: string }) {
  const { state, run } = useMutation<{ token: string }>(`/api/v1/clinics/${clinicId}/children/${childId}/qr`);
  const [img, setImg] = useState<string | null>(null);
  // Issuing revokes every earlier pass for this child (including one the family printed), so it is confirmed first.
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(confirming, state.phase === "pending");
  async function issue() {
    const r = await run();
    if (r?.ok) {
      setConfirming(false);
      setImg(await QRCode.toDataURL(r.data.token, { margin: 2, width: 220, errorCorrectionLevel: "M" }));
    }
  }
  return (
    <div>
      {img ? (
        <div className="mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={`QR pass for ${childName}; contains no health information`} width={220} height={220} />
          <p className="text-sm text-ink-soft">Print for the family. This replaced any earlier pass.</p>
        </div>
      ) : null}
      <Outcome state={state} okTitle="" />
      {confirming ? (
        <div {...groupProps} className="rounded-control border border-attention bg-attention-bg p-3" aria-label="Confirm new QR pass">
          <p {...textProps} className="mb-3 text-sm font-semibold text-attention">Issue a new QR pass for {childName}? Any earlier pass, including one the family printed, stops working right away. Give the family the new one before they leave.</p>
          <div className="flex flex-wrap gap-2">
            <Button pending={state.phase === "pending"} onClick={issue}>
              Yes, issue a new pass
            </Button>
            <Button {...cancelProps} variant="secondary" disabled={state.phase === "pending"} onClick={() => setConfirming(false)}>
              Keep the current pass
            </Button>
          </div>
        </div>
      ) : (
        <Button ref={triggerRef} variant="secondary" disabled={state.phase === "pending"} onClick={() => setConfirming(true)}>
          {img ? "Issue a replacement QR pass" : "Issue QR pass"}
        </Button>
      )}
    </div>
  );
}

export function EditIdentity({ clinicId, childId, version, initial }: { clinicId: string; childId: string; version: number; initial: { displayName: string; dob: string; addressText: string; precision: string } }) {
  const router = useRouter();
  const { state, run, reset } = useMutation(`/api/v1/clinics/${clinicId}/children/${childId}`, "PATCH");
  const [unchanged, setUnchanged] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUnchanged(false);
    const f = new FormData(e.currentTarget);
    const patch: Record<string, string | null> = {};
    const name = String(f.get("displayName") ?? "").trim();
    const dob = String(f.get("dob") ?? "");
    const addr = String(f.get("addressText") ?? "").trim();
    if (name && name !== initial.displayName) patch.displayName = name;
    if (f.get("clearDob") === "on") {
      patch.dobPrecision = "unknown";
      patch.dob = null;
    } else if (dob && dob !== initial.dob) {
      patch.dob = dob;
      patch.dobPrecision = "exact";
    }
    if (addr !== initial.addressText) patch.addressText = addr || null;
    if (Object.keys(patch).length === 0) {
      reset();
      setUnchanged(true);
      return;
    }
    const r = await run({ expectedVersion: version, patch, reason: String(f.get("reason") ?? "") });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit}>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <TextField id="e-name" name="displayName" label="Full name" defaultValue={initial.displayName} error={fe["patch.displayName"]} />
        <TextField id="e-dob" name="dob" type="date" label="Date of birth" defaultValue={initial.dob} error={fe["patch.dob"]} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="clearDob" className="size-5" /> Mark birth date as unknown</label>
        <TextField id="e-addr" name="addressText" label="Address" defaultValue={initial.addressText} />
        <TextField id="e-reason" name="reason" label="Reason for the change" hint="Required for name or date-of-birth changes; kept in the audit trail." />
      </div>
      <Outcome state={state} okTitle="Details updated" />
      {unchanged ? <Notice tone="info" role="status" title="Nothing to save">Change a detail above first; the record was not touched.</Notice> : null}
      <Button type="submit" disabled={state.phase === "pending"}>
        {state.phase === "pending" ? "Saving…" : "Save corrections"}
      </Button>
    </form>
  );
}
