"use client";
import Link from "next/link";
import { Button, Notice } from "@/components/ui";

/** Last-resort error screen: no technical detail, no record data. The digest lets support find the server log line. */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-xl">
      <Notice tone="danger" role="alert" title="Something went wrong on our side">
        We could not load this page. If you were saving a change, check the record before repeating it. Try again, or tell the clinic this reference if the problem continues:{" "}
        <span className="tnum font-semibold">{error.digest ?? "not available"}</span>
      </Notice>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/" className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-primary-strong hover:bg-primary-soft">
          Go to the start page
        </Link>
      </div>
    </div>
  );
}
