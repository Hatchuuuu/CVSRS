"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, SelectField, TextField } from "@/components/ui";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password-policy";
import { useMutation } from "@/lib/client/api";
import { changePassword } from "@/lib/client/password";

/** Name and language (update_my_profile). The name is what clinic staff see when they verify you. */
export function ProfileForm({ displayName, locale, needsName }: { displayName: string; locale: string; needsName: boolean }) {
  const router = useRouter();
  const { state, run } = useMutation<{ displayName: string }>("/api/v1/me/profile");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await run({ displayName: String(f.get("displayName") ?? "").trim(), locale: String(f.get("locale")) });
    if (r?.ok) router.refresh();
  }
  const fe = state.phase === "error" ? (state.error.fieldErrors ?? {}) : {};
  return (
    <form onSubmit={submit} className="max-w-md">
      <TextField
        id="acct-name"
        name="displayName"
        label="Full name"
        autoComplete="name"
        defaultValue={needsName ? "" : displayName}
        required
        maxLength={120}
        hint="Use the name on your ID. Clinic staff see it when they confirm you are the child's guardian."
        error={fe.displayName}
      />
      <SelectField id="acct-locale" name="locale" label="Language" defaultValue={locale === "fil" ? "fil" : "en"} error={fe.locale}>
        <option value="en">English</option>
        <option value="fil">Filipino</option>
      </SelectField>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
        {state.phase === "success" ? <Notice tone="success" role="status" title="Saved" /> : null}
      </ResultRegion>
      <Button type="submit" pending={state.phase === "pending"}>Save</Button>
    </form>
  );
}

/**
 * Password change for accounts on the sign-in service. It runs on the current session (signing in again here would drop a staff
 * session's second sign-in step). The Supabase project must enable "Secure password change", so a session that is not recent
 * is asked to sign in again first (docs/engineering/manual-setup.md).
 */
export function PasswordForm() {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "attention" | "success"; text: string } | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    const form = e.currentTarget;
    const f = new FormData(form);
    const next = String(f.get("next") ?? "");
    const weak = passwordProblem(next);
    if (weak) return setMessage({ tone: "danger", text: weak });
    if (next !== String(f.get("confirm") ?? "")) return setMessage({ tone: "danger", text: "The new passwords do not match." });
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await changePassword(next);
      if (!result.ok) setMessage({ tone: result.unknown ? "attention" : "danger", text: result.message });
      else {
        form.reset();
        setMessage({ tone: "success", text: "Your password has been changed." });
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="max-w-md" aria-busy={busy}>
      <fieldset disabled={busy}>
        <TextField id="pw-next" name="next" type="password" label="New password" hint={PASSWORD_HINT} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
        <TextField id="pw-confirm" name="confirm" type="password" label="Type the new password again" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
        <ResultRegion>{message ? <Notice tone={message.tone} role={message.tone === "success" ? "status" : "alert"}>{message.text}</Notice> : null}</ResultRegion>
        <Button type="submit" pending={busy}>Change password</Button>
      </fieldset>
    </form>
  );
}
