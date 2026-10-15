"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Notice, ResultRegion, TextField } from "@/components/ui";
import { browserSupabase } from "@/lib/client/supabase-browser";

type Phase = "loading" | "enroll" | "challenge" | "done" | "error";

/**
 * TOTP two-step sign-in via Supabase Auth MFA. Exercised against the local Supabase stack by tests/e2e (enrolment at first staff
 * sign-in and the challenge at every later one); not yet verified on a hosted project.
 */
/** `returnTo` is a clinic path already validated by the server page (clinicReturnPath); navigation goes there after verification. */
export function MfaPanel({ returnTo = null }: { returnTo?: string | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    setMessage(null);
    try {
      const supabase = browserSupabase();
      const [{ data: factors, error: factorsError }, { data: aal, error: aalError }] = await Promise.all([supabase.auth.mfa.listFactors(), supabase.auth.mfa.getAuthenticatorAssuranceLevel()]);
      if (factorsError || aalError || !factors || !aal) throw new Error("MFA state unavailable");
      const verified = factors?.totp?.find((f) => f.status === "verified");
      if (aal?.currentLevel === "aal2") return setPhase("done");
      if (verified) {
        setFactorId(verified.id);
        return setPhase("challenge");
      }
      setPhase("enroll");
    } catch {
      setMessage("We could not check two-step sign-in. Try again.");
      setPhase("error");
    }
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial load of external auth state
    void refresh();
  }, [refresh]);

  async function startEnroll() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = browserSupabase();
      // An abandoned setup leaves an unverified factor behind; remove it so setup can always start again.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const stale of existing?.all.filter((f) => f.factor_type === "totp" && f.status === "unverified") ?? []) {
        await supabase.auth.mfa.unenroll({ factorId: stale.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `eVacTrack ${new Date().toISOString().slice(0, 10)} ${crypto.randomUUID().slice(0, 4)}` });
      if (error || !data?.totp?.qr_code) return setMessage("We could not start setup. Try again.");
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    } catch {
      setMessage("We could not start setup. Try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function verify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!factorId || pending.current) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "").trim();
    pending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const supabase = browserSupabase();
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) return setMessage("That code did not work. Check your authenticator app and try the newest code.");
      setPhase("done");
      // The session level just changed. A soft navigation would keep the root layout rendered for the old level (its "clinic access
      // is paused" banner) and any prefetched pages, so go to the clinic with a full load; staying here refreshes the whole tree.
      if (returnTo) window.location.replace(returnTo);
      else router.refresh();
    } catch {
      setMessage("We could not verify your code. Try again shortly.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (phase === "loading") return <p role="status">Checking your sign-in security…</p>;
  if (phase === "error") return <div><Notice tone="danger" role="alert">{message}</Notice><Button onClick={() => { setPhase("loading"); void refresh(); }}>Retry</Button></div>;
  if (phase === "done") return <>
    <Notice tone="success" role="status" title="Two-step sign-in is complete for this session" />
    {returnTo ? <Link href={returnTo} className="inline-flex min-h-11 items-center font-semibold text-primary-strong underline">Continue to the clinic workspace</Link> : null}
  </>;

  return (
    <div className="max-w-md">
      {phase === "enroll" && !qr ? (
        <>
          <p className="mb-3">Use an authenticator app on your phone (for example, any app that supports time-based codes).</p>
          <Button onClick={startEnroll} disabled={busy}>
            {busy ? "Please wait…" : "Set up two-step sign-in"}
          </Button>
        </>
      ) : null}
      {qr ? (
        <div className="mb-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="QR code to add this account to your authenticator app" width={200} height={200} />
          <p className="mt-2 text-sm">Cannot scan? Enter this key in your app: <code className="break-all">{secret}</code></p>
        </div>
      ) : null}
      {factorId && (qr || phase === "challenge") ? (
        <form onSubmit={verify}>
          <TextField id="code" name="code" label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required />
          <ResultRegion>{message ? <Notice tone="danger" role="alert">{message}</Notice> : null}</ResultRegion>
          <Button type="submit" disabled={busy}>
            {busy ? "Please wait…" : "Verify"}
          </Button>
        </form>
      ) : (
        <ResultRegion>{message ? <Notice tone="danger" role="alert">{message}</Notice> : null}</ResultRegion>
      )}
    </div>
  );
}
