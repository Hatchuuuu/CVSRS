"use client";
import { useRouter } from "next/navigation";
import { useSyncExternalStore, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { useMutation } from "@/lib/client/api";

export interface ContactPrefs {
  guardianId: string;
  language: "en" | "fil";
  phoneMasked: string | null;
  hasPhone: boolean;
  phoneChecked: boolean;
  smsOptIn: boolean;
}

export function TextSettings({ prefs }: { prefs: ContactPrefs }) {
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const router = useRouter();
  const save = useMutation<ContactPrefs>("/api/v1/me/contact-preferences");
  const toggle = useMutation<ContactPrefs>("/api/v1/me/contact-preferences");

  async function savePhone(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const phone = String(f.get("phone") ?? "").trim();
    const r = await save.run({ ...(phone ? { phone } : {}), language: String(f.get("language")) });
    if (r?.ok) router.refresh();
  }
  const fe = save.state.phase === "error" ? save.state.error.fieldErrors : undefined;

  return (
    <div className="space-y-6">
      <p className="text-ink-soft">
        The clinic can use your phone number to contact you. Clinic updates remain available in Messages.
      </p>
      <form method="post" onSubmit={savePhone} className="max-w-lg">
        <fieldset disabled={!hydrated} className="min-w-0">
        <legend className="sr-only">Contact preferences</legend>
        <TextField
          id="ph"
          name="phone"
          type="tel"
          inputMode="tel"
          label="Mobile number"
          hint={prefs.hasPhone ? `On file: ${prefs.phoneMasked}. Enter a new number to replace it (the clinic will need to check it again). Leave blank to keep it.` : "Digits only, for example 0917 123 4567."}
          error={fe?.phone}
          autoComplete="tel"
        />
        <SelectField id="lang" name="language" label="Clinic message language" defaultValue={prefs.language} hint="Filipino wording is not available yet; messages are sent in English.">
          <option value="en">English</option>
          <option value="fil">Filipino</option>
        </SelectField>
        <Button type="submit" variant="secondary" disabled={!hydrated || save.state.phase === "pending"}>
          Save contact preferences
        </Button>
        <ResultRegion>
          {save.state.phase === "error" ? (
            <Notice tone={save.state.error.unknown ? "attention" : "danger"} role="alert" title={save.state.error.unknown ? "Not confirmed yet" : "Not saved"}>
              {save.state.error.message}
            </Notice>
          ) : null}
          {save.state.phase === "success" ? <Notice tone="success" role="status" title="Saved" /> : null}
        </ResultRegion>
        </fieldset>
      </form>

      {/* Only none and sandbox providers are implemented; neither delivers real texts. */}
      <Notice tone="info" title="Text delivery is unavailable">Keep checking Messages for clinic updates. Your phone number can still be used for clinic contact.</Notice>
      {!prefs.smsOptIn ? null : (
        <div>
          <p className="mb-2 font-semibold">Your account has text messages enabled.</p>
          <Button
            variant="secondary"
            disabled={!hydrated || toggle.state.phase === "pending"}
            onClick={async () => {
              const r = await toggle.run({ smsOptIn: false });
              if (r?.ok) router.refresh();
            }}
          >
            Turn text messages off
          </Button>
          <ResultRegion>
            {toggle.state.phase === "error" ? (
              <Notice tone={toggle.state.error.unknown ? "attention" : "danger"} role="alert" title={toggle.state.error.unknown ? "Not confirmed yet" : "Not changed"}>
                {toggle.state.error.message}
              </Notice>
            ) : null}
          </ResultRegion>
        </div>
      )}
    </div>
  );
}
