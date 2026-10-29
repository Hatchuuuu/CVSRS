"use client";
import Link from "next/link";
import { Button, Notice, PageTitle } from "@/components/ui";

/**
 * A failed clinic page keeps the clinic layout (staff menu and clinic name), so staff keep their place.
 * No technical detail or record data is shown; the digest lets support find the server log line.
 */
export default function ClinicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="max-w-xl">
      <PageTitle title="This page could not be loaded" />
      <Notice tone="danger" role="alert" title="This clinic page could not load">
        If you were saving a change, check the record before repeating it. Try again, or tell your clinic administrator this reference if the problem continues:{" "}
        <span className="tnum font-semibold">{error.digest ?? "not available"}</span>
      </Notice>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/clinic" className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-primary-strong hover:bg-primary-soft">
          Back to clinic workspaces
        </Link>
      </div>
    </div>
  );
}
