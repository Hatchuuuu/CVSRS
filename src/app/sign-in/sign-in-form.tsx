"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, Lock, Mail, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui";
/** Which account a sign-in or sign-up form is for: the family portal or the clinic workspace. */
export type AccountType = "family" | "staff";

/**
 * The link under a form ("New to the family portal? Create a family account"). The server page supplies it, so a staff address
 * reaches the browser only on a staff page and never ships in the code of the public family pages.
 */
export interface AlternateLink {
  text: string;
  href: string;
  link: string;
}

const COPY = {
  family: {
    placeholder: "parent.guardian@example.ph",
    busy: "Signing in to your portal…",
    next: "/children",
  },
  staff: {
    placeholder: "your.work.email@example.ph",
    busy: "Signing in to the clinic workspace…",
    next: "/clinic",
  },
} as const;

export function SignInForm({ initialError, notice, defaultEmail, audience = "family", alternate }: {
  initialError?: string;
  notice?: string;
  defaultEmail?: string;
  audience?: AccountType;
  alternate: AlternateLink;
}) {
  const copy = COPY[audience];
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const pending = useRef(false);
  const [email, setEmail] = useState(defaultEmail ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError ?? "");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, next: copy.next }),
        signal: AbortSignal.timeout(15_000),
      });
      const data = await response.json().catch(() => null) as { error?: string; redirect?: string } | null;
      if (!response.ok || !data?.redirect) {
        setError(data?.error || "Sign-in did not complete. Please check your credentials and try again.");
        return;
      }
      window.location.href = data.redirect;
      return;
    } catch {
      setError("The sign-in service could not be reached. Try again in a moment.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5" aria-busy={busy}>
      {notice ? (
        <p role="status" className="rounded-card bg-info-bg p-4 text-sm text-info font-medium border border-info/20">
          {notice}
        </p>
      ) : null}
      {error ? (
        <div role="alert" className="flex items-start gap-3 rounded-card bg-danger-bg p-4 text-sm text-danger border border-danger/20">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p className="font-medium">{error}</p>
        </div>
      ) : null}

      <form onSubmit={submit} className="space-y-4">
        <noscript><p className="text-sm text-ink-soft">Enable JavaScript to use this account form, then reload the page.</p></noscript>
        <fieldset disabled={!hydrated} aria-label="Sign-in details" className="min-w-0 space-y-4 border-0 p-0">
        <div>
          <label htmlFor="signin-email" className="mb-1.5 block text-sm font-semibold text-ink">
            Email address
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-soft">
              <Mail className="size-4" />
            </div>
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={copy.placeholder}
              className="min-h-11 w-full rounded-control border border-line-strong bg-surface py-2.5 pl-10 pr-3 text-base text-ink placeholder:text-ink-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
          </div>
        </div>

        <div>
          <div className="mb-2">
            <label htmlFor="signin-password" className="text-sm font-semibold text-ink">
              Password
            </label>
          </div>
          <div className="relative">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-soft">
              <Lock className="size-4" />
            </div>
            <input
              id="signin-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              disabled={busy}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              className="min-h-11 w-full rounded-control border border-line-strong bg-surface py-2.5 pl-10 pr-12 text-base text-ink placeholder:text-ink-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
            />
            <button
              type="button"
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              onClick={() => setShowPassword((value) => !value)}
              className="focus-inset absolute inset-y-0 right-0 inline-flex min-h-11 min-w-11 items-center justify-center rounded-control text-ink-soft hover:text-ink"
            >
              {showPassword ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
            </button>
          </div>
          <div className="mt-1 flex justify-end">
            <Link
              href="/account/forgot-password"
              className="inline-flex min-h-11 items-center text-sm font-bold text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
        </div>

        <Button type="submit" pending={busy} className="mt-2 w-full">
          {busy ? copy.busy : <>Sign in <ArrowRight aria-hidden className="size-4" /></>}
        </Button>
        </fieldset>
      </form>

      <div className="border-t border-line pt-4 text-center">
        <p className="text-sm text-ink-soft">
          {alternate.text}{" "}
          <Link href={alternate.href} className="font-bold text-primary hover:underline">
            {alternate.link}
          </Link>
        </p>
      </div>
    </div>
  );
}
