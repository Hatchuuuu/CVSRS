"use client";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Button, Notice, ResultRegion } from "@/components/ui";
import { callApi, useMutation } from "@/lib/client/api";

export interface ClinicNotice {
  clinicId: string;
  clinicName: string;
  version: string;
  text: string;
}

function One({ n, onAccepted }: { n: ClinicNotice; onAccepted?: () => void }) {
  const router = useRouter();
  const headingId = useId();
  const { state, run } = useMutation(`/api/v1/clinics/${n.clinicId}/privacy-notice/acknowledge`);
  return (
    <section aria-labelledby={headingId} className="rounded-card border-2 border-attention/50 bg-attention-bg p-5">
      <h2 id={headingId} className="text-lg font-bold">
        Privacy notice from {n.clinicName}
      </h2>
      <p className="mb-2 text-sm text-ink-soft">Please read this before adding a child. Version {n.version}.</p>
      <div className="mb-4 max-h-72 overflow-y-auto whitespace-pre-line rounded-control border border-line bg-surface p-4" tabIndex={0} role="region" aria-label={`Privacy notice text from ${n.clinicName}`}>
        {n.text}
      </div>
      <Button
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run({ version: n.version, text: n.text });
          if (r?.ok) {
            onAccepted?.();
            window.dispatchEvent(new CustomEvent("clinic-privacy-accepted", { detail: n.clinicId }));
            router.refresh();
          }
        }}
      >
        I have read this and I accept
      </Button>
      <ResultRegion>
        {state.phase === "error" ? (
          <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not saved"}>
            {state.error.message}
          </Notice>
        ) : null}
      </ResultRegion>
    </section>
  );
}

interface SelectedNotice { configured: boolean; acknowledged: boolean; version?: string; text?: string }

/** Fetch the chosen clinic directly: it may be beyond the bounded pending-notice list. */
export function useClinicPrivacy(clinicId: string) {
  const [loaded, setLoaded] = useState<{ clinicId: string; notice?: SelectedNotice; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    const onAccepted = (event: Event) => {
      if ((event as CustomEvent<string>).detail === clinicId) {
        current = false;
        setLoaded(null);
        setAttempt((value) => value + 1);
      }
    };
    window.addEventListener("clinic-privacy-accepted", onAccepted);
    if (clinicId) {
      void callApi<SelectedNotice>(`/api/v1/clinics/${clinicId}/privacy-notice`).then((result) => {
        if (current) setLoaded(result.ok ? { clinicId, notice: result.data } : { clinicId, error: result.message });
      });
    }
    return () => { current = false; window.removeEventListener("clinic-privacy-accepted", onAccepted); };
  }, [clinicId, attempt]);
  const selected = loaded?.clinicId === clinicId ? loaded : null;
  return {
    notice: selected?.notice,
    error: selected?.error,
    ready: Boolean(selected?.notice && (!selected.notice.configured || selected.notice.acknowledged)),
    reload: () => { setLoaded(null); setAttempt(attempt + 1); },
  };
}

export function SelectedClinicPrivacy({ clinicId, clinicName, privacy }: { clinicId: string; clinicName: string; privacy: ReturnType<typeof useClinicPrivacy> }) {
  if (!clinicId) return null;
  if (privacy.error) return <Notice tone="danger" role="alert" title="Privacy notice could not be loaded">{privacy.error} <Button variant="secondary" onClick={privacy.reload}>Try again</Button></Notice>;
  if (!privacy.notice) return <p role="status" className="mb-4 text-sm text-ink-soft">Checking the clinic&apos;s privacy notice...</p>;
  if (privacy.ready) return null;
  return <One key={`${clinicId}:${privacy.notice.version}`} n={{ clinicId, clinicName, version: privacy.notice.version ?? "", text: privacy.notice.text ?? "" }} />;
}

/** Shows only notices the guardian has not accepted yet (the database refuses adding or linking a child until they have). */
export function PrivacyNotices({ notices }: { notices: ClinicNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="mb-8 space-y-4">
      {notices.map((n) => (
        <One key={n.clinicId} n={n} />
      ))}
    </div>
  );
}
