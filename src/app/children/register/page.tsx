import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageTitle, Section } from "@/components/ui";
import { requireViewer } from "@/lib/server/viewer";
import { AddChildForm } from "../forms";
import { PrivacyNotices, type ClinicNotice } from "../privacy-notice";

export const metadata: Metadata = { title: "Register a child" };

export default async function ChildTask() {
  const { rpc } = await requireViewer();
  const [clinics, notices] = await Promise.all([
    rpc.rpc<{ id: string; name: string }[]>("list_public_clinics"),
    rpc.rpc<ClinicNotice[]>("get_pending_privacy_notices"),
  ]);
  if (!notices) throw new Error("Privacy notices could not be loaded. Please try again.");
  if (!clinics) throw new Error("Clinics could not be loaded. Please try again.");
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <Link href="/children" className="inline-flex min-h-11 items-center font-semibold text-primary">Back to My Children</Link>
      <PageTitle title="Register a child" lead="Create a record for a child who is not registered at the clinic. Staff will verify the details and your guardian identity." />
      <PrivacyNotices notices={notices} />
      {clinics.length ? <Section id="add-h" title="Register a new child record" className="border-t-0 pt-0"><AddChildForm clinics={clinics} /></Section> : <EmptyState title="No clinics available">Contact your health center before registering or linking a child.</EmptyState>}
      <Link href="/children" className="inline-flex min-h-11 items-center font-semibold text-primary">Cancel and return to My Children</Link>
    </div>
  );
}
