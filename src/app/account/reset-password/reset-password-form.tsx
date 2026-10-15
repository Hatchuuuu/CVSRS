"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password-policy";
import { browserSupabase } from "@/lib/client/supabase-browser";
import { changePassword } from "@/lib/client/password";

export function ResetPasswordForm() {
  const pending = useRef(false);
  const [link, setLink] = useState<"checking" | "valid" | "invalid">("checking");
  const [updated, setUpdated] = useState(false);
  const verified = link === "valid";
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "attention" | "success"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    browserSupabase().auth.getUser().then(({ data, error }) => {
      if (!active) return;
      setLink(!error && data.user ? "valid" : "invalid");
      if (error || !data.user) setMessage({ tone: "danger", text: "This reset link is invalid or expired. Request a new link." });
    }).catch(() => {
      if (!active) return;
      setLink("invalid");
      setMessage({ tone: "danger", text: "We could not check this link. Try again shortly." });
    });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verified || pending.current || updated) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const password = String(form.get("password") ?? "");
    const weak = passwordProblem(password);
    if (weak) {
      setMessage({ tone: "danger", text: weak });
      return;
    }
    if (password !== String(form.get("confirm") ?? "")) {
      setMessage({ tone: "danger", text: "The passwords do not match." });
      return;
    }
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await changePassword(password);
      if (!result.ok) setMessage({ tone: result.unknown ? "attention" : "danger", text: result.message });
      else {
        element.reset();
        setUpdated(true);
        setMessage({ tone: "success", text: "Your password has been updated." });
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="max-w-md" aria-busy={busy}>
    <fieldset disabled={busy || updated}>
      <TextField id="password" name="password" type="password" label="New password" hint={PASSWORD_HINT} autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
      <TextField id="confirm" name="confirm" type="password" label="Confirm new password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required />
    </fieldset>
    <ResultRegion>{message ? <Notice tone={message.tone} role={message.tone === "success" ? "status" : "alert"}>{message.text}</Notice> : null}</ResultRegion>
    {link === "checking" ? <p role="status" className="text-ink-soft">Checking your reset link…</p> : updated ? <Link href="/children" className="font-semibold text-primary-strong underline">Continue to your account</Link> : verified ? <Button type="submit" disabled={busy}>{busy ? "Please wait…" : "Update password"}</Button> : <Link href="/account/forgot-password" className="text-primary-strong underline">Request a new link</Link>}
  </form>;
}
