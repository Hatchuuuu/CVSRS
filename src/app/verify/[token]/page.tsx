import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { CheckCircle2, CircleHelp, Clock, ShieldAlert } from "lucide-react";
import { getRpcClient } from "@/lib/db";
import { clientAddress, limitRequest } from "@/lib/security/rate-limit";
import { verifyTokenParam } from "@/lib/validation/certificates";

export const metadata: Metadata = { title: "Certificate check", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Result {
  status: "valid" | "revoked" | "under_review";
  certificateNo: string;
  clinicName: string;
  issuedOn: string;
}

const view = {
  valid: { Icon: CheckCircle2, box: "border-success/40 bg-success-bg text-success", title: "This certificate is valid", text: "The clinic named below issued it and has not withdrawn it." },
  under_review: { Icon: Clock, box: "border-attention/40 bg-attention-bg text-attention", title: "This certificate is being reviewed", text: "The clinic is checking a record shown on it. Please ask the family to contact the clinic before relying on it." },
  revoked: { Icon: ShieldAlert, box: "border-danger/40 bg-danger-bg text-danger", title: "This certificate is no longer valid", text: "The clinic withdrew it. It should not be accepted." },
} as const;

/** Public page opened from the QR code. Shows authenticity only: no child name, birth date or vaccine list. */
export default async function VerifyCertificate({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const requestHeaders = await headers();
  let result: Result | null = null;
  let unavailable = false;
  if (verifyTokenParam.safeParse(token).success) {
      try {
        // Per client address; without one (explicit shared-bucket opt-in or development) a larger shared allowance applies.
        const client = clientAddress(requestHeaders);
        if (!(await limitRequest(`verify-page|${client.key}`, client.shared ? 600 : 30, 60_000, { onStoreFailure: "closed" })).ok) unavailable = true;
        else {
        result = await (await getRpcClient(randomUUID())).rpc<Result>("verify_certificate", { p_token: token });
        }
      } catch {
        unavailable = true;
      }
  }
  const v = result ? view[result.status] : null;
  return (
    <div className="mx-auto w-full max-w-xl">
      <h1 className="mb-4 text-3xl font-bold leading-tight">Certificate check</h1>
      {v && result ? (
        <div role="status" className={`rounded-card border-2 p-5 ${v.box}`}>
          <p className="flex items-center gap-2 text-xl font-bold">
            <v.Icon aria-hidden className="size-6 shrink-0" />
            {v.title}
          </p>
          <p className="mt-2 text-ink">{v.text}</p>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-ink">
            <dt className="font-semibold">Certificate</dt>
            <dd className="tnum">{result.certificateNo}</dd>
            <dt className="font-semibold">Issued by</dt>
            <dd>{result.clinicName}</dd>
            <dt className="font-semibold">Issued on</dt>
            <dd>{new Date(result.issuedOn + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}</dd>
          </dl>
        </div>
      ) : (
        <div role="status" className="rounded-card border-2 border-line-strong bg-sunken p-5">
          <p className="flex items-center gap-2 text-xl font-bold">
            <CircleHelp aria-hidden className="size-6 shrink-0" />
            {unavailable ? "Cannot check right now" : "Certificate not found"}
          </p>
          <p className="mt-2">{unavailable ? "Please try again in a few minutes." : "This code does not match a certificate issued by a clinic on this system. Check that the whole code was scanned."}</p>
        </div>
      )}
      <p className="mt-5 text-sm text-ink-soft">
        This check confirms only that a clinic issued the certificate and whether it is still valid. It does not show the child&apos;s details. To compare the contents, ask the family for the printed certificate and ask the clinic.
      </p>
    </div>
  );
}
