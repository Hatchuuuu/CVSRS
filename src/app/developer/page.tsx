import Link from "next/link";
import { EmptyState, PageTitle } from "@/components/ui";
import { requireViewer } from "@/lib/server/viewer";
import { activeClinicAccess } from "@/lib/auth/clinic-access";
export const metadata = { title: "Developer Console" };
export default async function DeveloperClinics() {
  const { ctx } = await requireViewer();
  const clinics = activeClinicAccess(ctx.memberships).filter((m) => m.roles.includes("tech_admin"));
  return <>
    <PageTitle title="Developer Console" lead="Manage technical access and operations for your assigned clinics." />
    {clinics.length ? <ul className="grid gap-3">{clinics.map((clinic) => <li key={clinic.clinicId}><Link className="block min-h-11 rounded-card border border-line bg-surface p-4 font-bold" href={`/developer/${clinic.clinicId}`}>{clinic.clinicName}</Link></li>)}</ul> : <EmptyState title="No assigned technical clinics">An active technical administrator membership is required.</EmptyState>}
  </>;
}
