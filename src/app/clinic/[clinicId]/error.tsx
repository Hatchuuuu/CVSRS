"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button, Notice } from "@/components/ui";

/**
 * A failed clinic page keeps the clinic layout (staff menu and clinic name), so staff keep their place.
 * No technical detail or record data is shown; the digest lets support find the server log line.
 */
export default function ClinicError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const { clinicId } = useParams<{ clinicId: string }>();
  return (
    <div className="max-w-xl">
      <Notice tone="danger" role="alert" title="This clinic page could not load">
        If you were saving a change, check the record before repeating it. Try again, or tell your clinic administrator this reference if the problem continues:{" "}
        <span className="tnum font-semibold">{error.digest ?? "not available"}</span>
      </Notice>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => retry()}>Try again</Button>
        <Link href={`/clinic/${clinicId}`} className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-primary-strong hover:bg-primary-soft">
          Go to the clinic home
        </Link>
      </div>
    </div>
  );
}
