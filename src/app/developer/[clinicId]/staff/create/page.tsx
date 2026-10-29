import Link from "next/link";
import { notFound } from "next/navigation";
import { PageTitle, Section } from "@/components/ui";
import { CreateStaffAccount } from "@/components/technical/create-staff-account";
import { requireDeveloper } from "@/lib/server/developer";

export const metadata = { title: "Create staff account · Developer Console" };

export default async function CreateStaff({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { membership } = await requireDeveloper(clinicId);
  if (!membership.capabilities.includes("admin.users")) notFound();
  return <div className="max-w-3xl">
    <Link className="mb-4 inline-flex min-h-11 items-center font-semibold" href={`/developer/${clinicId}/staff`}>Back to staff accounts</Link>
    <PageTitle title="Create staff account" lead="Create the identity, then return to Staff accounts to follow the independent access approval." />
    <Section id="create-staff-h" title="Create staff account" className="border-t-0 pt-0"><CreateStaffAccount clinicId={clinicId} /></Section>
  </div>;
}
