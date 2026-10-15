"use client";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirmStep } from "@/components/confirm-step";
import { Button, EmptyState, Notice, ResultRegion, StatusChip, TextField } from "@/components/ui";
import { DownloadCertificateButton } from "@/components/download-button";
import { announceOutcome, OutcomeNoticeView } from "@/components/outcome-notice";
import { useMutation } from "@/lib/client/api";
import { formatClinicDate } from "@/lib/format";

export interface StaffCertificate {
  id: string;
  certificateNo: string;
  status: "pending" | "issued" | "revoked";
  reviewNeeded: boolean;
  issuedAt: string | null;
  replacesNo: string | null;
  entryCount: number;
  hasDocument: boolean;
  revokedAt: string | null;
  revocationReason: string | null;
}

const STAFF_DOWNLOAD_FAILURE = "The PDF could not be downloaded. Check the connection and try again; if it keeps failing, use “Generate document again” or issue a replacement.";


function Outcome({ state }: { state: ReturnType<typeof useMutation>["state"] }) {
  return (
    <ResultRegion>
      {state.phase === "error" ? (
        <Notice tone={state.error.unknown ? "attention" : "danger"} role="alert" title={state.error.unknown ? "Not confirmed yet" : "Not done"}>
          {state.error.message}
        </Notice>
      ) : null}
    </ResultRegion>
  );
}

const noticeKey = (childId: string) => `certificates:${childId}`;

/** Prepares a certificate (or a replacement). The document is generated right away; if that fails the record is kept and can be retried. */
function IssueButton({ clinicId, childId, replacesId, label }: { clinicId: string; childId: string; replacesId?: string; label: string }) {
  const router = useRouter();
  const { state, run } = useMutation<{ status: string; needsRetry?: boolean }>(`/api/v1/clinics/${clinicId}/children/${childId}/certificates`);
  const [confirming, setConfirming] = useState(false);
  const { triggerRef, groupProps, textProps, cancelProps } = useConfirmStep(Boolean(replacesId) && confirming, state.phase === "pending");
  async function go() {
    const r = await run(replacesId ? { replacesId } : {});
    if (r?.ok) {
      setConfirming(false);
      // Announced beside the list: this button disappears once a valid certificate exists.
      announceOutcome(noticeKey(childId), r.data.needsRetry
        ? { tone: "attention", title: "Saved, but the document is not ready", message: "The certificate record was saved. Use “Generate document again” in the list below." }
        : replacesId
          ? { title: "Replacement issued", message: "The previous certificate is revoked; anyone who checks it sees that it is no longer valid." }
          : { title: "Certificate prepared", message: "It lists only the doses the clinic has verified." });
      router.refresh();
    }
  }
  return (
    <div>
      {replacesId && confirming ? (
        <div {...groupProps} className="rounded-control border border-attention bg-attention-bg p-3" aria-label="Confirm replacement certificate">
          <p {...textProps} className="mb-3 text-sm font-semibold text-attention">Issue a replacement? The current certificate is revoked, and anyone who checks it will see that it is no longer valid.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={go} pending={state.phase === "pending"}>
              {state.phase === "pending" ? "Preparing…" : "Yes, issue replacement"}
            </Button>
            <Button {...cancelProps} variant="secondary" disabled={state.phase === "pending"} onClick={() => setConfirming(false)}>
              Keep current certificate
            </Button>
          </div>
        </div>
      ) : (
        <Button ref={triggerRef} onClick={replacesId ? () => setConfirming(true) : go} disabled={state.phase === "pending"} variant={replacesId ? "secondary" : "primary"}>
          {state.phase === "pending" ? "Preparing…" : label}
        </Button>
      )}
      <Outcome state={state} />
    </div>
  );
}

function RetryButton({ clinicId, childId, certificateId }: { clinicId: string; childId: string; certificateId: string }) {
  const router = useRouter();
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/certificates/${certificateId}/retry`);
  return (
    <div>
      <Button
        variant="secondary"
        disabled={state.phase === "pending"}
        onClick={async () => {
          const r = await run();
          if (r?.ok) {
            announceOutcome(noticeKey(childId), { title: "Document generated", message: "The certificate can now be downloaded." });
            router.refresh();
          }
        }}
      >
        {state.phase === "pending" ? "Generating…" : "Generate document again"}
      </Button>
      <Outcome state={state} />
    </div>
  );
}

function RevokeForm({ clinicId, childId, certificateId, unfinished = false }: { clinicId: string; childId: string; certificateId: string; unfinished?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, run } = useMutation(`/api/v1/clinics/${clinicId}/certificates/${certificateId}/revoke`);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
    const r = await run({ reason });
    if (r?.ok) {
      setOpen(false);
      announceOutcome(noticeKey(childId), unfinished
        ? { title: "Unfinished certificate discarded", message: "Correct the record if needed, then prepare a new certificate." }
        : { title: "Certificate revoked", message: "The family and anyone who checks it now see that it is no longer valid." });
      router.refresh();
    }
  }
  return (
    <div>
      <Button variant="danger" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {unfinished ? "Discard unfinished certificate" : "Revoke"}
      </Button>
      {open ? (
        <form onSubmit={submit} className="mt-3 rounded-control border border-line bg-canvas p-4">
          <TextField id={`rv-${certificateId}`} name="reason" label={unfinished ? "Reason for discarding" : "Reason for revoking"} hint={unfinished ? "It was never issued or shown to the family. Correct the record if needed, then prepare a new certificate." : "The family sees that it is no longer valid, not this reason."} required minLength={3} maxLength={300} error={state.phase === "error" ? state.error.fieldErrors?.reason : undefined} />
          <Button type="submit" variant="danger" disabled={state.phase === "pending"}>
            {state.phase === "pending" ? (unfinished ? "Discarding…" : "Revoking…") : unfinished ? "Discard certificate" : "Revoke certificate"}
          </Button>
          <Outcome state={state} />
        </form>
      ) : null}
    </div>
  );
}

export function CertificatesPanel({ clinicId, childId, certificates, canIssue, clinicTimezone }: { clinicId: string; childId: string; certificates: StaffCertificate[]; canIssue: boolean; clinicTimezone: string }) {
  const live = certificates.some((c) => c.status !== "revoked");
  return (
    <div className="space-y-4">
      <OutcomeNoticeView noticeKey={noticeKey(childId)} />
      {certificates.length === 0 ? (
        <EmptyState title="No certificate issued">A certificate lists only doses the clinic has verified. Doses waiting for verification are left out.</EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-control border border-line bg-surface">
          {certificates.map((c) => (
            <li key={c.id} className="space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="tnum block font-bold">{c.certificateNo}</span>
                  <span className="text-sm text-ink-soft">
                    {c.entryCount} {c.entryCount === 1 ? "vaccination" : "vaccinations"}
                    {c.issuedAt ? ` · issued ${formatClinicDate(c.issuedAt, clinicTimezone)}` : ""}
                    {c.replacesNo ? ` · replaces ${c.replacesNo}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {c.status === "issued" ? <StatusChip tone="success">Valid</StatusChip> : c.status === "pending" ? <StatusChip tone="attention">Document not ready</StatusChip> : <StatusChip tone="neutral">Revoked</StatusChip>}
                  {c.reviewNeeded && c.status === "issued" ? <StatusChip tone="review">Under review</StatusChip> : null}
                </span>
              </div>
              {c.status === "revoked" && c.revocationReason ? <p className="text-sm text-ink-soft">Reason: {c.revocationReason}</p> : null}
              {c.reviewNeeded && c.status === "issued" ? (
                <Notice tone="review" title="A record shown on this certificate was corrected">
                  Anyone who checks it will see “under review”. Issue a replacement (this one is then revoked) or revoke it.
                </Notice>
              ) : null}
              <div className="flex flex-wrap items-start gap-3">
                {c.hasDocument ? <DownloadCertificateButton certificateId={c.id} failureText={STAFF_DOWNLOAD_FAILURE} /> : null}
                {canIssue && c.status === "pending" ? <RetryButton clinicId={clinicId} childId={childId} certificateId={c.id} /> : null}
                {canIssue && c.status === "pending" ? <RevokeForm clinicId={clinicId} childId={childId} certificateId={c.id} unfinished /> : null}
                {canIssue && c.status === "issued" ? <IssueButton clinicId={clinicId} childId={childId} replacesId={c.id} label="Issue replacement" /> : null}
                {canIssue && c.status === "issued" ? <RevokeForm clinicId={clinicId} childId={childId} certificateId={c.id} /> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canIssue && !live ? <IssueButton clinicId={clinicId} childId={childId} label="Prepare certificate" /> : null}
    </div>
  );
}
