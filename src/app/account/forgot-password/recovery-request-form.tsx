"use client";
import { useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { browserSupabase } from "@/lib/client/supabase-browser";

export function RecoveryRequestForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!email) return;
    setBusy(true);
    setMessage(null);
    try {
      // Never claim a link is on its way unless the request reached the sign-in service (audit F06).
      const { error } = await browserSupabase().auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/callback?next=/account/reset-password`,
      });
      if (error && (error.status === 0 || (error.status ?? 0) >= 500)) {
        setMessage({ tone: "danger", text: "The service is unavailable. Try again shortly." });
        return;
      }
      // Other errors (unknown address, rate limit per address) get the same answer, so the form never reveals who has an account.
      setMessage({ tone: "success", text: "If that address has an account, a password reset link will arrive shortly. Check your spam folder too." });
    } catch {
      setMessage({ tone: "danger", text: "The reset link could not be requested. Check the connection and try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-md space-y-4">
      <TextField id="email" name="email" type="email" label="Email address" autoComplete="email" required placeholder="name@example.com" />
      <ResultRegion>{message ? <Notice tone={message.tone} role={message.tone === "danger" ? "alert" : "status"}>{message.text}</Notice> : null}</ResultRegion>
      <Button type="submit" disabled={busy}>{busy ? "Please wait…" : "Send reset link"}</Button>
    </form>
  );
}
