"use client";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
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
        Text messages are optional and short. They never contain your child&apos;s name, vaccines or health details: they only tell you to open the app. You will always get the same information here in Messages.
      </p>
      <form onSubmit={savePhone} className="max-w-lg">
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
        <SelectField id="lang" name="language" label="Language" defaultValue={prefs.language} hint="Filipino wording is not available yet; messages are sent in English.">
          <option value="en">English</option>
          <option value="fil">Filipino</option>
        </SelectField>
        <Button type="submit" variant="secondary" disabled={save.state.phase === "pending"}>
          Save
        </Button>
        <ResultRegion>
          {save.state.phase === "error" ? (
            <Notice tone={save.state.error.unknown ? "attention" : "danger"} role="alert" title={save.state.error.unknown ? "Not confirmed yet" : "Not saved"}>
              {save.state.error.message}
            </Notice>
          ) : null}
          {save.state.phase === "success" ? <Notice tone="success" role="status" title="Saved" /> : null}
        </ResultRegion>
      </form>

      {!prefs.hasPhone ? null : !prefs.phoneChecked ? (
        <Notice tone="review" title="The clinic still has to check your number">
          Show your phone to clinic staff on your next visit. After they confirm it is yours you can turn text messages on here.
        </Notice>
      ) : (
        <div>
          <p className="mb-2 font-semibold">Text messages are {prefs.smsOptIn ? "on" : "off"}.</p>
          <Button
            variant={prefs.smsOptIn ? "secondary" : "primary"}
            disabled={toggle.state.phase === "pending"}
            onClick={async () => {
              const r = await toggle.run({ smsOptIn: !prefs.smsOptIn });
              if (r?.ok) router.refresh();
            }}
          >
            {prefs.smsOptIn ? "Turn text messages off" : "Turn text messages on"}
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
