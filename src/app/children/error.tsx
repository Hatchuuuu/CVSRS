"use client";
import Link from "next/link";
import { Button, Notice, PageTitle } from "@/components/ui";

/** Guardian area: no technical detail or record data; a way back to the family's list; the digest for the clinic. */
export default function ChildrenError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div>
      <PageTitle title="This page could not be loaded" />
      <Notice tone="danger" role="alert" title="This page could not load">
        If you were sending something to the clinic, check before sending it again. Try again, or tell the clinic this reference if the problem continues:{" "}
        <span className="tnum font-semibold">{error.digest ?? "not available"}</span>
      </Notice>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href="/children" className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-primary-strong hover:bg-primary-soft">
          Back to My Children
        </Link>
      </div>
    </div>
  );
}
