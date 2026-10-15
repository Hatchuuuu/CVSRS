"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmStep } from "@/components/confirm-step";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export interface Profile {
  name: string;
  address: string;
  contact: string | null;
  hours: string | null;
  timezone: string;
}

const ZONES = ["Asia/Manila", "Asia/Singapore", "Asia/Jakarta", "Asia/Bangkok", "Asia/Kuala_Lumpur", "Asia/Tokyo", "UTC"];

interface ProfileValues {
  name: string;
  address?: string;
  contact?: string;
  hours?: string;
  timezone: string;
}

/** A different zone changes which calendar day everything at the clinic falls on, so it is confirmed before saving. */
export const timezoneChangeNeedsConfirm = (current: string, next: string) => next !== "" && next !== current;

export function ProfileForm({ clinicId, profile }: { clinicId: string; profile: Profile }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/profile`);
  const [pendingTz, setPendingTz] = useState<ProfileValues | null>(null);
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(pendingTz !== null, state.phase === "pending");
  async function save(values: ProfileValues) {
    const r = await run(values);
    if (r?.ok) {
      setPendingTz(null);
      router.refresh();
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const v = (k: string) => String(f.get(k) ?? "").trim();
    const values: ProfileValues = { name: v("name"), address: v("address") || undefined, contact: v("contact") || undefined, hours: v("hours") || undefined, timezone: v("timezone") };
    if (timezoneChangeNeedsConfirm(profile.timezone, values.timezone)) {
      setPendingTz(values);
      return;
    }
    await save(values);
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  const zones = ZONES.includes(profile.timezone) ? ZONES : [profile.timezone, ...ZONES];
  return (
    <form onSubmit={submit} onChange={() => setPendingTz(null)} className="max-w-xl">
      <TextField id="cp-name" name="name" label="Clinic name" defaultValue={profile.name} required maxLength={120} error={fe?.name} />
      <TextField id="cp-addr" name="address" label="Address" defaultValue={profile.address} maxLength={300} error={fe?.address} />
      <TextField id="cp-contact" name="contact" label="Phone or other contact" hint="Shown to families exactly as typed. Leave empty if there is none: nothing is invented." defaultValue={profile.contact ?? ""} maxLength={300} error={fe?.contact} />
      <TextField id="cp-hours" name="hours" label="Opening hours" hint="For example: Monday to Friday, 8:00 to 16:00. Shown to families exactly as typed." defaultValue={profile.hours ?? ""} maxLength={500} error={fe?.hours} />
      <SelectField id="cp-tz" name="timezone" label="Time zone" hint="Decides which calendar day a session, a dose or a report belongs to." defaultValue={profile.timezone} error={fe?.timezone}>
        {zones.map((z) => (
          <option key={z} value={z}>
            {z}
          </option>
        ))}
      </SelectField>
      {pendingTz ? (
        <div {...groupProps} className="mb-4 rounded-control border border-attention bg-attention-bg p-3" aria-label="Confirm time zone change">
          <p {...textProps} className="mb-3 text-sm font-semibold text-attention">
            Change the clinic time zone from {profile.timezone} to {pendingTz.timezone}? Sessions, doses, follow-up and reports are then counted by the {pendingTz.timezone} calendar day, and every time shown for this clinic changes. Only change it if the clinic is really in that zone.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button pending={state.phase === "pending"} onClick={() => save(pendingTz)}>
              Yes, change to {pendingTz.timezone}
            </Button>
            <Button {...cancelProps} variant="secondary" disabled={state.phase === "pending"} onClick={() => setPendingTz(null)}>
              Keep {profile.timezone}
            </Button>
          </div>
        </div>
      ) : (
        <Button ref={triggerRef} type="submit" disabled={state.phase === "pending"}>
          {state.phase === "pending" ? "Saving…" : "Save"}
        </Button>
      )}
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Saved" /> : null}
      </ResultRegion>
    </form>
  );
}

export function OpsCheckForm({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/ops`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ kind: String(f.get("kind")), result: String(f.get("result")), performedOn: String(f.get("performedOn")), evidence: String(f.get("evidence") ?? "").trim() });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? state.error.fieldErrors : undefined;
  return (
    <form onSubmit={submit} className="max-w-xl">
      <div className="grid gap-x-4 sm:grid-cols-2">
        <SelectField id="oc-kind" name="kind" label="What was checked" required defaultValue="restore_drill">
          <option value="restore_drill">Restore drill (backup restored and verified)</option>
          <option value="database_backup">Database backup completed</option>
          <option value="file_backup">File backup completed</option>
        </SelectField>
        <SelectField id="oc-res" name="result" label="Result" required defaultValue="passed">
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </SelectField>
      </div>
      <TextField id="oc-date" name="performedOn" type="date" label="Date it was done" required error={fe?.performedOn} />
      <TextField id="oc-ev" name="evidence" label="Where the evidence is" hint="A ticket, log or document reference. Not the evidence itself." required minLength={5} maxLength={300} error={fe?.evidence} />
      <Button type="submit" variant="secondary" disabled={state.phase === "pending"}>
        Record this check
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
    </form>
  );
}
