import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/ui";

// The same screen is used for "does not exist" and "you may not see it", so a page never confirms that a record exists.
export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl">
      <PageTitle title="Page unavailable" />
      <EmptyState title="This page is unavailable to your account">
        The address may be wrong, or the record may belong to someone else.{" "}
        <Link href="/" className="font-semibold text-primary">
          Go to the start page
        </Link>
      </EmptyState>
    </div>
  );
}
