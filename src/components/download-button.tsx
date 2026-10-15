"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Notice, ResultRegion } from "@/components/ui";

/** The file name the server chose (Content-Disposition), or the fallback. */
export function filenameFromDisposition(header: string | null | undefined, fallback: string): string {
  const m = header ? /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header) : null;
  const name = m?.[1]?.trim();
  return name ? name.replace(/[\\/]/g, "_") : fallback;
}

/** What to tell the person when a download fails: the API's own safe message when there is one, otherwise `fallback`. */
export async function downloadFailureMessage(res: { status?: number; json?: () => Promise<unknown> } | null, fallback: string): Promise<string> {
  let message: string | null = null;
  let requestId: string | null = null;
  try {
    const body = (await res?.json?.()) as { error?: { message?: unknown }; requestId?: unknown } | undefined;
    message = typeof body?.error?.message === "string" && body.error.message.trim() ? body.error.message.trim() : null;
    requestId = typeof body?.requestId === "string" ? body.requestId : null;
  } catch {
    // Not JSON (or no body): fall back to the generic text.
  }
  const text = message ? `${message} ${fallback}` : fallback;
  return requestId ? `${text} Reference: ${requestId}` : text;
}

type DownloadState = { downloading: boolean; error: string | null; start: () => Promise<void> };

/**
 * Fetches the file and saves it from a blob, so a failure (401, 404, 429, 500) shows an inline alert and the page stays,
 * instead of the tab navigating to a JSON error.
 */
function useDownload(href: string, fallbackName: string, failureText: string): DownloadState {
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function start() {
    if (downloading) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch(href, { credentials: "same-origin", signal: AbortSignal.timeout(15_000) });
      if (!res.ok) {
        setError(await downloadFailureMessage(res, failureText));
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFromDisposition(res.headers?.get("content-disposition"), fallbackName);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoking synchronously can cancel the download in some browsers; release the blob once it has started.
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(failureText);
    } finally {
      setDownloading(false);
    }
  }
  return { downloading, error, start };
}

function view({ downloading, error, start }: DownloadState, label: string, errorTitle: string) {
  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={downloading}
        aria-busy={downloading ? "true" : undefined}
        className="inline-flex min-h-11 items-center gap-2 rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-primary hover:bg-primary-soft disabled:opacity-60"
      >
        {downloading ? (
          <>
            <Loader2 aria-hidden className="size-4 animate-spin text-primary" />
            <span>Downloading…</span>
          </>
        ) : (
          <>
            <Download aria-hidden className="size-4" />
            <span>{label}</span>
          </>
        )}
      </button>
      <ResultRegion>
        {error ? (
          <Notice tone="danger" role="alert" title={errorTitle}>
            {error}
          </Notice>
        ) : null}
      </ResultRegion>
    </div>
  );
}

export function DownloadButton({ href, filename, label, failureText, errorTitle = "Download failed" }: { href: string; filename: string; label: string; failureText: string; errorTitle?: string }) {
  return view(useDownload(href, filename, failureText), label, errorTitle);
}

const CERTIFICATE_FAILURE = "Could not download the certificate. Check your connection and try again. If it still fails, ask the clinic to check the certificate.";

export function DownloadCertificateButton({ certificateId, failureText = CERTIFICATE_FAILURE }: { certificateId: string; failureText?: string }) {
  return view(useDownload(`/api/v1/certificates/${certificateId}/download`, `vaccination-certificate-${certificateId.slice(0, 8)}.pdf`, failureText), "Download PDF", "Download failed");
}
