"use client";
import Link from "next/link";
import "./globals.css";

/** Replaces the root layout when it fails, so it carries its own document. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="font-sans">
      <body className="flex min-h-screen items-center justify-center bg-canvas px-4 text-ink">
        <main className="w-full max-w-xl rounded-card border border-danger bg-danger-bg p-6 text-danger" role="alert">
          <h1 className="text-lg font-bold">eVacTrack could not load</h1>
          <p className="mt-2 text-sm leading-relaxed">
            If you were saving a change, check the record before repeating it. Try again, or tell the clinic this reference if the problem continues:{" "}
            <span className="tnum font-semibold">{error.digest ?? "not available"}</span>
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => retry()} className="inline-flex min-h-11 items-center rounded-control border border-primary bg-primary px-4 text-sm font-semibold text-on-primary">
              Try again
            </button>
            <Link href="/" className="inline-flex min-h-11 items-center px-3 text-sm font-semibold text-primary-strong">
              Go to the start page
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
