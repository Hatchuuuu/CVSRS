"use client";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useConfirmStep } from "@/components/confirm-step";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";
import { SelectedClinicPrivacy, useClinicPrivacy } from "./privacy-notice";

interface Clinic {
  id: string;
  name: string;
}

const REL = [
  ["mother", "Mother"],
  ["father", "Father"],
  ["grandparent", "Grandparent"],
  ["aunt_uncle", "Aunt or uncle"],
  ["sibling", "Older sibling"],
  ["legal_guardian", "Legal guardian"],
  ["other", "Other"],
] as const;

function ErrorNotice({ error }: { error: { message: string; requestId?: string; unknown?: boolean } }) {
  return (
    <Notice tone={error.unknown ? "attention" : "danger"} role="alert" title={error.unknown ? "Not confirmed yet" : "Could not save"}>
      {error.message}
      {error.requestId ? <span className="mt-1 block text-sm text-ink-soft">Reference: {error.requestId}</span> : null}
    </Notice>
  );
}

export function AddChildForm({ clinics }: { clinics: Clinic[] }) {
  const router = useRouter();
  const { state, run } = useMutation<{ childId: string; localRecordNo: string }>("/api/v1/children");
  const [precision, setPrecision] = useState<"exact" | "estimated" | "unknown">("exact");
  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? "");
  const privacy = useClinicPrivacy(clinicId);
  const fieldErrors = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const res = await run({
      clinicId: v("clinicId"),
      relationship: v("relationship"),
      child: {
        givenNames: v("givenNames"),
        familyName: v("familyName"),
        dobPrecision: precision,
        dob: precision === "exact" ? v("dob") : undefined,
        estimatedBirthStart: precision === "estimated" ? v("estStart") : undefined,
        estimatedBirthEnd: precision === "estimated" ? v("estEnd") : undefined,
      },
    });
    if (res?.ok) {
      toast.success(`Child record ${res.data.localRecordNo} created successfully!`, {
        description: "Waiting for clinic verification.",
      });
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }

  return (
    <form onSubmit={submit} className="card-elevated p-5 sm:p-6 shadow-xs">
      <SelectField id="clinicId" name="clinicId" label="Clinic" required error={fieldErrors.clinicId} value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <SelectedClinicPrivacy clinicId={clinicId} clinicName={clinics.find((c) => c.id === clinicId)?.name ?? ""} privacy={privacy} />
      <TextField id="givenNames" name="givenNames" label="Child's given name(s)" autoComplete="off" required error={fieldErrors["child.displayName"]} />
      <TextField id="familyName" name="familyName" label="Child's family name" autoComplete="off" />
      <SelectField id="precision" label="How well do you know the birth date?" value={precision} onChange={(e) => setPrecision(e.target.value as typeof precision)} hint="No birth certificate? Choose “estimated” or “unknown”; the clinic can help.">
        <option value="exact">I know the exact date</option>
        <option value="estimated">I know roughly when</option>
        <option value="unknown">I don&apos;t know</option>
      </SelectField>
      {precision === "exact" ? <TextField id="dob" name="dob" type="date" label="Date of birth" required error={fieldErrors["child.dob"]} /> : null}
      {precision === "estimated" ? (
        <>
          <TextField id="estStart" name="estStart" type="date" label="Earliest possible birth date" required error={fieldErrors["child.estimatedBirthStart"]} />
          <TextField id="estEnd" name="estEnd" type="date" label="Latest possible birth date" required />
        </>
      ) : null}
      <SelectField id="relationship" name="relationship" label="Your relationship to the child" defaultValue="mother">
        {REL.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      <ResultRegion>
        {state.phase === "error" ? <ErrorNotice error={state.error} /> : null}
        {state.phase === "success" ? (
          <Notice tone="success" role="status" title="Saved — waiting for clinic verification">
            Record {state.data.localRecordNo} was created. The clinic will confirm your child&apos;s details and your identity before showing health information.
          </Notice>
        ) : null}
      </ResultRegion>
      <Button type="submit" pending={state.phase === "pending"} disabled={clinics.length === 0 || !privacy.ready}>
        {state.phase === "pending" ? "Saving…" : state.phase === "error" && state.error.unknown ? "Try again (safe to repeat)" : "Add child"}
      </Button>
    </form>
  );
}

export function LinkRequestForm({ clinics }: { clinics: Clinic[] }) {
  const { state, run } = useMutation<{ caseId: string; status: string }>("/api/v1/guardian-links");
  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? "");
  const privacy = useClinicPrivacy(clinicId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim() || undefined;
    const res = await run({ clinicId: v("clinicId"), childName: v("childName"), dob: v("dob"), relationship: v("relationship"), note: v("note") });
    if (res?.ok) {
      toast.success("Request sent to the clinic!", {
        description: "Clinic staff will review and verify your identity.",
      });
      (e.target as HTMLFormElement).reset();
    }
  }
  const fieldErrors = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit} className="card-elevated p-5 sm:p-6 shadow-xs">
      <SelectField id="link-clinic" name="clinicId" label="Clinic" required value={clinicId} onChange={(e) => setClinicId(e.target.value)}>
        {clinics.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </SelectField>
      <SelectedClinicPrivacy clinicId={clinicId} clinicName={clinics.find((c) => c.id === clinicId)?.name ?? ""} privacy={privacy} />
      <TextField id="link-name" name="childName" label="Child's name as the clinic knows it" required error={fieldErrors.childName} />
      <TextField id="link-dob" name="dob" type="date" label="Child's date of birth (if known)" />
      <SelectField id="link-rel" name="relationship" label="Your relationship to the child" defaultValue="mother">
        {REL.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </SelectField>
      <TextField id="link-note" name="note" label="Anything that helps staff find the record (optional)" />
      <ResultRegion>
        {state.phase === "error" ? <ErrorNotice error={state.error} /> : null}
        {state.phase === "success" ? (
          <Notice tone="success" role="status" title="Request sent to the clinic">
            Staff will check who you are. You will see the child here once they approve. This does not tell you whether a record exists.
          </Notice>
        ) : null}
      </ResultRegion>
      <Button type="submit" variant="secondary" pending={state.phase === "pending"} disabled={clinics.length === 0 || !privacy.ready}>
        {state.phase === "pending" ? "Sending…" : "Send request"}
      </Button>
    </form>
  );
}

/** QR pass: the token is shown only in the issuing response and rendered locally; it is never stored by the server in readable form. */
export function QrPanel({ childId, childName }: { childId: string; childName: string }) {
  const { state, run } = useMutation<{ token: string }>(`/api/v1/children/${childId}/qr`);
  const [img, setImg] = useState<string | null>(null);
  // A new pass switches off every earlier one, including a printed copy, so it is confirmed first.
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(confirming, state.phase === "pending");
  async function issue() {
    const res = await run();
    if (res?.ok) {
      setConfirming(false);
      setImg(await QRCode.toDataURL(res.data.token, { margin: 2, width: 240, errorCorrectionLevel: "M" }));
      toast.success("New QR pass ready.");
    }
  }
  return (
    <div>
      {img ? (
        <div>
          {/* Local data URL: no third-party request; the QR carries an opaque token, never child data. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={`QR pass for ${childName}. It contains no health information.`} width={240} height={240} className="mx-auto" />
          <p className="mt-2 text-sm text-ink-soft">Show this at the clinic. Making a new pass switches off this one. It contains no health details.</p>
        </div>
      ) : null}
      <ResultRegion>{state.phase === "error" ? <ErrorNotice error={state.error} /> : null}</ResultRegion>
      {!img ? <p className="mb-2 text-sm text-ink-soft">For safety a pass is shown only once. Getting one switches off any earlier pass, including a printed one.</p> : null}
      {confirming ? (
        <div {...groupProps} className="rounded-control border border-attention bg-attention-bg p-3" aria-label="Confirm new QR pass">
          <p {...textProps} className="mb-3 text-sm font-semibold text-attention">
            {img ? "Make a new pass? The pass shown above, and any copy you printed or saved, stops working right away." : `Get a new pass for ${childName}? Any pass made earlier, including a printed one, stops working right away.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={issue} pending={state.phase === "pending"}>
              Yes, make a new pass
            </Button>
            <Button {...cancelProps} variant="secondary" disabled={state.phase === "pending"} onClick={() => setConfirming(false)}>
              Keep the current pass
            </Button>
          </div>
        </div>
      ) : (
        <Button ref={triggerRef} variant="secondary" onClick={() => setConfirming(true)} pending={state.phase === "pending"}>
          {img ? "Make a new QR pass" : "Get a QR pass"}
        </Button>
      )}
    </div>
  );
}
