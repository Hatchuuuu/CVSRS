import { redirect } from "next/navigation";
import Link from "next/link";
import { requireClinicStaff } from "@/lib/server/viewer";
import { StaffConsole } from "@/components/technical/staff-console";

export const metadata = { title: "Admin console" };
export default async function AdminConsole({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  const { membership } = await requireClinicStaff(clinicId);
  const technical = membership.roles.includes("tech_admin");
  if (technical && membership.roles.every((role) => role === "tech_admin")) redirect(`/developer/${clinicId}/staff`);
  return <>
    {technical ? <p className="mb-4"><Link href={`/developer/${clinicId}/staff`}>Open Developer Console</Link></p> : null}
    <StaffConsole clinicId={clinicId} />
  </>;
}
