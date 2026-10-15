"use client";
import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Briefcase, Building2, Info, Lock, Mail, Phone, ShieldAlert, User } from "lucide-react";
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordProblem } from "@/lib/auth/password-policy";
import { LEGAL_VERSION } from "@/lib/legal";
import { STAFF_ROLES } from "@/lib/staff-roles";
import { Button } from "@/components/ui";
import type { AccountType, AlternateLink } from "@/app/sign-in/sign-in-form";

const COPY = {
  family: {
    next: "/children",
    nameLabel: "Full name of parent or legal guardian",
    namePlaceholder: "e.g. Maria Clara Santos",
    phoneLabel: "Philippine mobile number",
    phoneRequired: true,
    emailLabel: "Email address (used to sign in)",
    emailPlaceholder: "parent.guardian@example.ph",
    consent: "I understand that clinic staff must verify my guardian relationship before I can access a child's clinical history. I will review the clinic's privacy notice before adding a child.",
    consentMissing: "Agree to the Terms of Use, and confirm that you understand guardian access must be verified, before continuing.",
    submit: "Create family account",
    busy: "Creating your family portal…",
  },
  staff: {
    next: "/clinic",
    nameLabel: "Full name (as your clinic knows you)",
    namePlaceholder: "e.g. Ana Reyes",
    phoneLabel: "Work mobile number (optional)",
    phoneRequired: false,
    emailLabel: "Work email address (used to sign in)",
    emailPlaceholder: "your.work.email@example.ph",
    consent: "I understand that this account opens no clinic records until an administrator at my health center accepts my application and a second person approves my access, and that I must set up two-step sign-in.",
    consentMissing: "Agree to the Terms of Use, and confirm that you understand how clinic access is granted, before continuing.",
    submit: "Create staff account and apply",
    busy: "Creating your account and sending your application…",
  },
} as const;

const consentLink = "font-semibold text-primary-strong underline hover:text-primary-dark";

const inputClass =
  "min-h-11 w-full rounded-control border border-line-strong bg-surface py-2.5 pl-10 pr-3 text-base text-ink placeholder:text-ink-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors";

/** A labelled field with a leading icon; `children` is the control. */
function IconField({ id, label, icon, hint, className, children }: { id: string; label: string; icon: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-ink">
        {label}
      </label>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-ink-soft">{icon}</div>
        {children}
      </div>
      {hint ? <p id={`${id}-hint`} className="mt-1.5 text-sm text-ink-soft">{hint}</p> : null}
    </div>
  );
}

/** Family or staff account form. A staff sign-up also files an application to one health center (`clinics` comes from the server). */
export function SignUpForm({ audience = "family", alternate, clinics = [] }: {
  audience?: AccountType;
  alternate: AlternateLink;
  clinics?: { id: string; name: string }[];
}) {
  const copy = COPY[audience];
  const hydrated = useSyncExternalStore(() => () => {}, () => true, () => false);
  const staff = audience === "staff";
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [clinicId, setClinicId] = useState(clinics.length === 1 ? clinics[0]!.id : "");
  const [role, setRole] = useState<string>("clinical_staff");
  const [positionTitle, setPositionTitle] = useState("");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current) return;
    setErrorMsg(null);

    const weak = passwordProblem(password);
    if (weak) {
      setErrorMsg(weak);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("The two passwords do not match. Type the same password in both fields.");
      return;
    }
    if (staff && !clinicId) {
      setErrorMsg("Choose your health center.");
      return;
    }
    if (!consent) {
      setErrorMsg(copy.consentMissing);
      return;
    }

    pending.current = true;
    setBusy(true);
    try {
      const res = await fetch("/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName,
          email,
          phone,
          password,
          preferredLanguage: "en",
          termsVersion: LEGAL_VERSION,
          next: copy.next,
          ...(staff ? { clinicId, role, positionTitle, note } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data.error || "Failed to create account. Please verify your details.");
        return;
      }

      // A full navigation refreshes the cookie-backed server viewer after Auth changes.
      window.location.href = data.redirect || copy.next;
      return;
    } catch {
      setErrorMsg("Unable to connect to the registration service. Please try again.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (staff && clinics.length === 0) {
    return (
      <div role="status" className="flex items-start gap-3 rounded-card border border-info/20 bg-info-bg p-4 text-sm text-info">
        <Info aria-hidden className="mt-0.5 size-5 shrink-0" />
        <p>No health center is accepting staff applications yet. Ask your clinic&apos;s administrator to set up the health center in eVacTrack first.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <noscript><p className="text-sm text-ink-soft">Enable JavaScript to use this account form, then reload the page.</p></noscript>
      <fieldset disabled={!hydrated} aria-label="Account creation details" className="min-w-0 space-y-4 border-0 p-0">
      {errorMsg ? (
        <div role="alert" className="flex items-start gap-3 rounded-card border border-danger bg-danger-bg p-3.5 text-sm text-danger">
          <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p className="flex-1 font-medium">{errorMsg}</p>
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <IconField id="reg-name" label={copy.nameLabel} icon={<User className="size-4" />} className="sm:col-span-2">
          <input id="reg-name" type="text" required maxLength={120} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder={copy.namePlaceholder} className={inputClass} />
        </IconField>

        <IconField id="reg-phone" label={copy.phoneLabel} icon={<Phone className="size-4" />} className="sm:col-span-2">
          <input id="reg-phone" type="tel" required={copy.phoneRequired} maxLength={40} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0917-123-4567" className={inputClass} />
        </IconField>

        <IconField id="reg-email" label={copy.emailLabel} icon={<Mail className="size-4" />} className="sm:col-span-2">
          <input
            id="reg-email"
            type="email"
            required
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={copy.emailPlaceholder}
            className={inputClass}
          />
        </IconField>

        <IconField id="reg-pass" label="Create a password" icon={<Lock className="size-4" />}>
          <input
            id="reg-pass"
            type="password"
            required
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            aria-describedby="reg-pass-hint"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`}
            className={inputClass}
          />
        </IconField>
        <IconField id="reg-pass-confirm" label="Type the password again" icon={<Lock className="size-4" />}>
          <input
            id="reg-pass-confirm"
            type="password"
            required
            autoComplete="new-password"
            minLength={PASSWORD_MIN_LENGTH}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Repeat password"
            className={inputClass}
          />
        </IconField>
        <p id="reg-pass-hint" className="-mt-1 text-sm text-ink-soft sm:col-span-2">{PASSWORD_HINT}</p>
      </div>

      {staff ? (
        <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
          <legend className="sr-only">Your application</legend>
          <div className="sm:col-span-2">
            <p className="text-sm font-bold text-ink" aria-hidden>
              Your application
            </p>
            <p className="mt-0.5 text-sm text-ink-soft">An administrator at the health center you choose accepts or declines it.</p>
          </div>
          <IconField id="reg-clinic" label="Health center" icon={<Building2 className="size-4" />} className="sm:col-span-2">
            <select id="reg-clinic" required value={clinicId} onChange={(e) => setClinicId(e.target.value)} className={`${inputClass} appearance-auto`}>
              <option value="" disabled>
                Choose your health center
              </option>
              {clinics.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </IconField>
          <IconField id="reg-role" label="Role you are applying for" icon={<User className="size-4" />} className="sm:col-span-2">
            <select id="reg-role" required value={role} onChange={(e) => setRole(e.target.value)} className={`${inputClass} appearance-auto`}>
              {STAFF_ROLES.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
          </IconField>
          <IconField id="reg-title" label="Job title (optional)" icon={<Briefcase className="size-4" />} className="sm:col-span-2">
            <input id="reg-title" type="text" maxLength={80} value={positionTitle} onChange={(e) => setPositionTitle(e.target.value)} placeholder="e.g. Public health nurse" className={inputClass} />
          </IconField>
          <div className="sm:col-span-2">
            <label htmlFor="reg-note" className="mb-1.5 block text-sm font-semibold text-ink">
              Note to the administrator (optional)
            </label>
            <textarea
              id="reg-note"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. I start at the health center on Monday."
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-soft focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
        </fieldset>
      ) : null}

      <div className="border-t border-line pt-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 size-4 shrink-0 rounded text-primary focus:ring-primary" />
          <span className="text-sm leading-relaxed text-ink-soft">
            I agree to the{" "}
            <Link href="/terms" target="_blank" rel="noopener" className={consentLink}>
              Terms of Use<span className="sr-only"> (opens in a new tab)</span>
            </Link>{" "}
            and have read the{" "}
            <Link href="/privacy" target="_blank" rel="noopener" className={consentLink}>
              Privacy Policy<span className="sr-only"> (opens in a new tab)</span>
            </Link>
            . {copy.consent}
          </span>
        </label>
      </div>

      <Button type="submit" pending={busy} className="w-full">
        {busy ? copy.busy : <>{copy.submit} <ArrowRight aria-hidden className="size-4" /></>}
      </Button>

      <div className="border-t border-line/80 pt-4 text-center">
        <p className="text-sm text-ink-soft">
          {alternate.text}{" "}
          <Link href={alternate.href} className="font-bold text-primary hover:underline">
            {alternate.link}
          </Link>
        </p>
      </div>
      </fieldset>
    </form>
  );
}
